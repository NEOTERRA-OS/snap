import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";
import crypto from "crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const INBOX = process.env.GDRIVE_INBOX_FOLDER_ID; // Ordner im Shared Drive

const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

// Belege bleiben unbenannt-roh; der NT Google Drive Scanner indexiert sie
// anschließend nach NEOS-Index-Schema. Wir geben nur einen lesbaren Seed-Namen
// (mit Typ-Hinweis Invoice/Receipt nach Kategorie) — bewusst KEIN _-Schema,
// damit der Scanner die Datei verarbeitet (statt als „bereits benannt" zu überspringen).
const INVOICE_CATS = ["it", "lodging", "office"];
function seedName(r, ext) {
  const typ = INVOICE_CATS.includes(r.category) ? "Invoice" : "Receipt";
  const amount = r.gross != null ? `${Number(r.gross).toFixed(2).replace(".", ",")} ${r.currency || "EUR"}` : "";
  const parts = ["Snap", r.doc_date || "", typ, (r.merchant || "Beleg").replace(/[\\/:*?"<>|]+/g, " ").trim(), amount].filter(Boolean);
  return parts.join(" ") + ext;
}

async function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signed = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: SA_EMAIL, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(signed).sign(SA_KEY).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${signed}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Drive-Auth fehlgeschlagen: " + (j.error_description || j.error || "unbekannt"));
  return j.access_token;
}

const DRIVE_Q = "supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives";

async function ensureUserFolder(token, name, cached, s, userId) {
  if (cached) return cached;
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${INBOX}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&${DRIVE_Q}`, { headers: { authorization: `Bearer ${token}` } })).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await (await fetch(`https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [INBOX] }),
    })).json();
    id = created.id;
  }
  if (id) await s.from("profiles").update({ drive_folder_id: id }).eq("id", userId);
  return id;
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
  if (!SA_EMAIL || !SA_KEY || !INBOX) return NextResponse.json({ skipped: true, reason: "Drive nicht konfiguriert" });

  const { receiptId } = await req.json().catch(() => ({}));
  if (!receiptId) return NextResponse.json({ error: "receiptId fehlt" }, { status: 400 });
  const s = svc();
  const { data: r } = await s.from("receipts").select("id,user_id,merchant,doc_date,gross,currency,category,file_path,drive_file_id").eq("id", receiptId).single();
  if (!r) return NextResponse.json({ error: "Beleg nicht gefunden" }, { status: 404 });
  if (r.drive_file_id) return NextResponse.json({ ok: true, already: true, fileId: r.drive_file_id });
  if (!r.file_path) return NextResponse.json({ error: "Kein Originalbeleg" }, { status: 400 });

  await s.from("drive_sync").upsert({ receipt_id: r.id, status: "pending", updated_at: new Date().toISOString() }, { onConflict: "receipt_id" });
  try {
    const token = await getToken();
    const { data: prof } = await s.from("profiles").select("full_name,drive_folder_id").eq("id", r.user_id).single();
    let email = "";
    try { const { data: gu } = await s.auth.admin.getUserById(r.user_id); email = gu?.user?.email || ""; } catch {}
    const folderName = (prof?.full_name || email || r.user_id).toString();
    const folderId = await ensureUserFolder(token, folderName, prof?.drive_folder_id, s, r.user_id);
    if (!folderId) throw new Error("Inbox-Ordner konnte nicht angelegt werden");

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
    await s.from("drive_sync").upsert({ receipt_id: r.id, status: "error", last_error: String(e?.message || e), updated_at: new Date().toISOString() }, { onConflict: "receipt_id" }).then(() => {});
    await s.rpc; // noop guard
    await s.from("drive_sync").update({ attempts: undefined }).eq("receipt_id", r.id).then(() => {}).catch(() => {});
    console.error("[/api/drive] Error:", e?.message);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
