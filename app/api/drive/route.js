import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CSEC = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const INBOX = process.env.GDRIVE_INBOX_FOLDER_ID; // Ordner im Shared Drive (Fallback)

const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

// Dateiname exakt im NEOS-Index-Schema: JJJJ-MM-TT_Typ[_Vendor].ext
// (siehe schema-detect.ts / RENAMED_PATTERN). Passt der Name, überspringt der
// Scanner die Datei als „bereits benannt" → spart Verarbeitungszeit.
const INVOICE_CATS = ["it", "lodging", "office", "telecom", "insurance", "rent", "maintenance", "material", "marketing", "training"];
const DIA = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss", "ă": "a", "â": "a", "î": "i", "ș": "s", "ț": "t", "Ș": "S", "Ț": "T", "Â": "A", "Î": "I", "Ă": "A" };
// Vendor-Token → nur [A-Za-z0-9_-], Segmente in Title-Case (Index-konform).
function indexVendor(s) {
  let v = String(s || "").trim();
  if (!v) return "";
  v = v.split("").map((c) => DIA[c] ?? c).join("");
  v = v.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  v = v.split("_").map((seg) => (!seg ? "" : seg === seg.toUpperCase() ? seg.charAt(0) + seg.slice(1).toLowerCase() : seg.charAt(0).toUpperCase() + seg.slice(1))).filter(Boolean).join("_");
  return v.slice(0, 50);
}
function isoDate(s) { return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date().toISOString().slice(0, 10); }
function seedName(r, ext) {
  const typ = INVOICE_CATS.includes(r.category) ? "Invoice" : "Receipt";
  const vendor = indexVendor(r.source === "cash" ? "Barauslage" : (r.merchant || ""));
  const ref = indexVendor(r.invoice_no || "");
  const parts = [isoDate(r.doc_date), typ]; if (vendor) parts.push(vendor); if (ref) parts.push(ref);
  return parts.join("_") + (ext || "").toLowerCase();
}

// Access-Token aus dem gespeicherten Refresh-Token des verbundenen Google-Kontos (Weg 2, schlüsselfrei).
async function getToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Token-Refresh fehlgeschlagen: " + (j.error_description || j.error || "unbekannt"));
  return j.access_token;
}

const DRIVE_Q = "supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives";

// Hauptordner-Name je Mitarbeiter: „Nachname_Vorname" (z. B. Förtig_Benedikt).
function userFolderName(fullName, email, uid) {
  const n = (fullName || "").trim();
  if (n) { const parts = n.split(/\s+/); if (parts.length >= 2) return `${parts[parts.length - 1]}_${parts.slice(0, -1).join(" ")}`; return n; }
  return (email || uid || "Unbekannt").toString();
}
// Monats-Unterordner nach Belegdatum: „JJJJ-MM" (sortierbar).
function monthFolderName(docDate) {
  const d = docDate ? new Date(docDate) : new Date();
  if (isNaN(d.getTime())) return "ohne-datum";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// Ordner suchen (ältesten zuerst → selbstheilend bei Alt-Duplikaten) oder anlegen.
async function ensureFolder(token, name, parentId) {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&${DRIVE_Q}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const existing = found.files?.[0]?.id;
  if (existing) return existing;
  const created = await (await fetch(`https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  })).json();
  return created.id;
}

// Inbox-Ordner: App-Einstellung (admin-setzbar) vor Env-Variable.
async function resolveInbox(s) {
  try {
    const { data } = await s.from("app_settings").select("value").eq("key", "gdrive_inbox_folder_id").maybeSingle();
    if (data?.value && data.value.trim()) return data.value.trim();
  } catch {}
  return INBOX;
}

async function requireUser(req) {
  if (!SERVICE) return { error: "SUPABASE_SERVICE_ROLE_KEY fehlt", status: 501 };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Nicht angemeldet", status: 401 };
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return { error: "Ungültige Sitzung", status: 401 };
  return { ok: true, uid: u.user.id };
}

export async function POST(req) {
  const gate = await requireUser(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!CID || !CSEC) return NextResponse.json({ skipped: true, reason: "OAuth nicht konfiguriert" });

  const { receiptId } = await req.json().catch(() => ({}));
  if (!receiptId) return NextResponse.json({ error: "receiptId fehlt" }, { status: 400 });
  const s = svc();
  const inbox = await resolveInbox(s);
  if (!inbox) return NextResponse.json({ skipped: true, reason: "Kein Inbox-Ordner gesetzt" });
  const { data: conn } = await s.from("google_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!conn?.refresh_token) return NextResponse.json({ skipped: true, reason: "Google nicht verbunden" });
  const { data: r } = await s.from("receipts").select("id,user_id,merchant,doc_date,gross,currency,category,file_path,drive_file_id,invoice_no,source").eq("id", receiptId).single();
  if (!r) return NextResponse.json({ error: "Beleg nicht gefunden" }, { status: 404 });
  if (r.drive_file_id) return NextResponse.json({ ok: true, already: true, fileId: r.drive_file_id });
  if (!r.file_path) return NextResponse.json({ error: "Kein Originalbeleg" }, { status: 400 });

  await s.from("drive_sync").upsert({ receipt_id: r.id, status: "pending", updated_at: new Date().toISOString() }, { onConflict: "receipt_id" });
  try {
    const token = await getToken(conn.refresh_token);
    const { data: prof } = await s.from("profiles").select("full_name,drive_folder_id").eq("id", r.user_id).single();
    let email = "";
    try { const { data: gu } = await s.auth.admin.getUserById(r.user_id); email = gu?.user?.email || ""; } catch {}
    // 1) Hauptordner je Mitarbeiter (aus Cache oder per Suche/Anlage), ID am Profil merken.
    let userFolderId = prof?.drive_folder_id;
    if (!userFolderId) {
      userFolderId = await ensureFolder(token, userFolderName(prof?.full_name, email, r.user_id), inbox);
      if (userFolderId) await s.from("profiles").update({ drive_folder_id: userFolderId }).eq("id", r.user_id);
    }
    if (!userFolderId) throw new Error("Nutzerordner konnte nicht angelegt werden");
    // 2) Monats-Unterordner nach Belegdatum.
    const folderId = await ensureFolder(token, monthFolderName(r.doc_date), userFolderId);
    if (!folderId) throw new Error("Monatsordner konnte nicht angelegt werden");

    const dl = await s.storage.from("receipts").download(r.file_path);
    if (dl.error) throw new Error("Download: " + dl.error.message);
    const buf = Buffer.from(await dl.data.arrayBuffer());
    const ext = (r.file_path.match(/\.[a-z0-9]+$/i) || [""])[0];
    const meta = { name: seedName(r, ext), parents: [folderId] };

    const boundary = "neosnap" + crypto.randomBytes(8).toString("hex");
    const pre = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\ncontent-type: ${dl.data.type || "application/octet-stream"}\r\n\r\n`;
    const body = Buffer.concat([Buffer.from(pre, "utf8"), buf, Buffer.from(`\r\n--${boundary}--`, "utf8")]);
    const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body,
    });
    const j = await up.json();
    if (!up.ok || !j.id) throw new Error("Upload " + up.status + ": " + (j.error?.message || ""));

    await s.from("receipts").update({ drive_file_id: j.id, drive_link: j.webViewLink || null, drive_synced_at: new Date().toISOString() }).eq("id", r.id);
    await s.from("drive_sync").update({ status: "done", drive_file_id: j.id, last_error: null, updated_at: new Date().toISOString() }).eq("receipt_id", r.id);
    return NextResponse.json({ ok: true, fileId: j.id, link: j.webViewLink || null });
  } catch (e) {
    const { data: cur } = await s.from("drive_sync").select("attempts").eq("receipt_id", r.id).single();
    await s.from("drive_sync").update({ status: "error", last_error: String(e?.message || e), attempts: (cur?.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq("receipt_id", r.id);
    console.error("[/api/drive] Error:", e?.message);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
