import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CSEC = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const INBOX = process.env.GDRIVE_INBOX_FOLDER_ID;
const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
const DRIVE_Q = "supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives";
const INVOICE_CATS = ["it", "lodging", "office", "telecom", "insurance", "rent", "maintenance", "material", "marketing", "training"];
const DIA = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss", "ă": "a", "â": "a", "î": "i", "ș": "s", "ț": "t", "Ș": "S", "Ț": "T", "Â": "A", "Î": "I", "Ă": "A" };

function indexVendor(s) {
  let v = String(s || "").trim();
  if (!v) return "";
  v = v.split("").map((c) => DIA[c] ?? c).join("");
  v = v.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  v = v.split("_").map((seg) => (!seg ? "" : seg === seg.toUpperCase() ? seg.charAt(0) + seg.slice(1).toLowerCase() : seg.charAt(0).toUpperCase() + seg.slice(1))).filter(Boolean).join("_");
  return v.slice(0, 50);
}
const isoDate = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date().toISOString().slice(0, 10));
function seedName(r, ext) {
  const typ = INVOICE_CATS.includes(r.category) ? "Invoice" : "Receipt";
  const vendor = indexVendor(r.source === "cash" ? "Barauslage" : (r.merchant || ""));
  const ref = indexVendor(r.invoice_no || "");
  const parts = [isoDate(r.doc_date), typ]; if (vendor) parts.push(vendor); if (ref) parts.push(ref);
  return parts.join("_") + (ext || "").toLowerCase();
}
function userFolderName(fullName, email, uid) {
  const n = (fullName || "").trim();
  if (n) { const parts = n.split(/\s+/); if (parts.length >= 2) return `${parts[parts.length - 1]}_${parts.slice(0, -1).join(" ")}`; return n; }
  return (email || uid || "Unbekannt").toString();
}
function monthFolderName(docDate) {
  const d = docDate ? new Date(docDate) : new Date();
  if (isNaN(d.getTime())) return "ohne-datum";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
async function getToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Token-Refresh fehlgeschlagen");
  return j.access_token;
}
async function ensureFolder(token, name, parentId, cache) {
  const ck = `${parentId}/${name}`;
  if (cache.has(ck)) return cache.get(ck);
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&${DRIVE_Q}`, { headers: { authorization: `Bearer ${token}` } })).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await (await fetch(`https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    })).json();
    id = created.id;
  }
  if (id) cache.set(ck, id);
  return id;
}
async function resolveInbox(s) {
  try { const { data } = await s.from("app_settings").select("value").eq("key", "gdrive_inbox_folder_id").maybeSingle(); if (data?.value?.trim()) return data.value.trim(); } catch {}
  return INBOX;
}
async function requireAdmin(req, s) {
  if (!SERVICE) return { error: "SUPABASE_SERVICE_ROLE_KEY fehlt", status: 501 };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Nicht angemeldet", status: 401 };
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return { error: "Ungültige Sitzung", status: 401 };
  const { data: prof } = await s.from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "admin") return { error: "Nur Administratoren.", status: 403 };
  return { ok: true };
}

export async function POST(req) {
  const s = svc();
  const gate = await requireAdmin(req, s);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!CID || !CSEC) return NextResponse.json({ error: "OAuth nicht konfiguriert" }, { status: 400 });
  const inbox = await resolveInbox(s);
  if (!inbox) return NextResponse.json({ error: "Kein Inbox-Ordner gesetzt" }, { status: 400 });
  const { data: conn } = await s.from("google_connection").select("refresh_token").eq("id", 1).maybeSingle();
  if (!conn?.refresh_token) return NextResponse.json({ error: "Google nicht verbunden" }, { status: 400 });

  const token = await getToken(conn.refresh_token);
  const folderCache = new Map();
  const canonical = new Map(); // userId -> canonical folder id

  // Profile & Belege laden.
  const { data: profs } = await s.from("profiles").select("id,full_name,drive_folder_id");
  const profById = {}; (profs || []).forEach((p) => (profById[p.id] = p));
  const { data: receipts } = await s.from("receipts").select("id,user_id,merchant,doc_date,category,source,file_path,drive_file_id,invoice_no").not("drive_file_id", "is", null);

  let moved = 0, renamed = 0, errors = 0;
  for (const r of receipts || []) {
    try {
      const prof = profById[r.user_id];
      let userFolderId = canonical.get(r.user_id) || prof?.drive_folder_id;
      if (!userFolderId) {
        userFolderId = await ensureFolder(token, userFolderName(prof?.full_name, "", r.user_id), inbox, folderCache);
        if (userFolderId) await s.from("profiles").update({ drive_folder_id: userFolderId }).eq("id", r.user_id);
      }
      if (!userFolderId) { errors++; continue; }
      canonical.set(r.user_id, userFolderId);
      const monthId = await ensureFolder(token, monthFolderName(r.doc_date), userFolderId, folderCache);
      if (!monthId) { errors++; continue; }

      // Aktuelle Eltern + Name holen.
      const meta = await (await fetch(`https://www.googleapis.com/drive/v3/files/${r.drive_file_id}?fields=parents,name&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } })).json();
      if (meta.error) { errors++; continue; }
      const curParents = meta.parents || [];
      const ext = (r.file_path?.match(/\.[a-z0-9]+$/i) || [""])[0];
      const wantName = seedName(r, ext);
      const params = new URLSearchParams({ supportsAllDrives: "true", fields: "id,webViewLink" });
      const needsMove = !curParents.includes(monthId);
      if (needsMove) { params.set("addParents", monthId); params.set("removeParents", curParents.join(",")); }
      const body = meta.name !== wantName ? { name: wantName } : {};
      if (needsMove || meta.name !== wantName) {
        const up = await (await fetch(`https://www.googleapis.com/drive/v3/files/${r.drive_file_id}?${params.toString()}`, {
          method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
        })).json();
        if (up.error) { errors++; continue; }
        if (needsMove) moved++;
        if (meta.name !== wantName) renamed++;
        if (up.webViewLink) await s.from("receipts").update({ drive_link: up.webViewLink }).eq("id", r.id);
      }
    } catch { errors++; }
  }

  // Kanonische Nutzerordner ggf. auf „Nachname_Vorname" umbenennen.
  for (const [uid, fid] of canonical) {
    try {
      const want = userFolderName(profById[uid]?.full_name, "", uid);
      const m = await (await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?fields=name&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } })).json();
      if (m.name && m.name !== want) await fetch(`https://www.googleapis.com/drive/v3/files/${fid}?supportsAllDrives=true`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: want }) });
    } catch {}
  }

  // Leere Fehlordner direkt unter der Inbox in den Papierkorb (reversibel).
  let trashed = 0;
  let foldersSeen = 0, skippedNonEmpty = 0, trashErrors = 0, sampleTrashError = null;
  try {
    const canonSet = new Set(canonical.values());
    const q = encodeURIComponent(`'${inbox}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const list = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000&${DRIVE_Q}`, { headers: { authorization: `Bearer ${token}` } })).json();
    for (const f of list.files || []) {
      if (canonSet.has(f.id)) continue;
      foldersSeen++;
      const cq = encodeURIComponent(`'${f.id}' in parents and trashed=false`);
      const kids = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${cq}&fields=files(id)&pageSize=1&${DRIVE_Q}`, { headers: { authorization: `Bearer ${token}` } })).json();
      if ((kids.files || []).length === 0) {
        const tr = await (await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) })).json();
        if (!tr.error) { trashed++; } else { trashErrors++; if (!sampleTrashError) sampleTrashError = tr.error.message || String(tr.error); }
      } else { skippedNonEmpty++; }
    }
  } catch (e) { if (!sampleTrashError) sampleTrashError = String(e?.message || e); }

  return NextResponse.json({ ok: true, moved, renamed, trashed, errors, total: (receipts || []).length, foldersSeen, skippedNonEmpty, trashErrors, sampleTrashError });
}
