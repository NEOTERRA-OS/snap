import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

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

function mimeFromPath(p) {
  const ext = (p.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  return "image/jpeg";
}

// Trägt fehlende Rechnungsnummer/CUI per OCR aus bereits gespeicherten Belegen nach.
// Batchweise (limit), damit die Funktion nicht ins Zeitlimit läuft; die App ruft
// wiederholt auf, bis remaining = 0.
export async function POST(req) {
  const s = svc();
  const gate = await requireAdmin(req, s);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit) || 6, 1), 10);

  const { data: rows } = await s.from("receipts")
    .select("id,file_path,merchant_cui,invoice_no,source")
    .is("invoice_no", null).not("file_path", "is", null).neq("source", "cash")
    .order("created_at", { ascending: true }).limit(limit);

  let processed = 0, updated = 0, cuiAdded = 0, errors = 0;
  for (const r of rows || []) {
    processed++;
    try {
      const dl = await s.storage.from("receipts").download(r.file_path);
      if (dl.error) { errors++; continue; }
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const b64 = buf.toString("base64");
      const ocrRes = await fetch(new URL("/api/ocr", req.url), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: b64, mediaType: mimeFromPath(r.file_path), filename: r.file_path.split("/").pop() }),
      });
      const oj = await ocrRes.json().catch(() => ({}));
      const f = oj.fields || {};
      const patch = {};
      if (f.invoice_no && String(f.invoice_no).trim()) patch.invoice_no = String(f.invoice_no).trim();
      if (!r.merchant_cui && f.cui && String(f.cui).trim()) patch.merchant_cui = String(f.cui).trim();
      if (Object.keys(patch).length) {
        const { error } = await s.from("receipts").update(patch).eq("id", r.id);
        if (error) { errors++; continue; }
        if (patch.invoice_no) updated++;
        if (patch.merchant_cui) cuiAdded++;
      }
    } catch { errors++; }
  }

  const { count: remaining } = await s.from("receipts").select("id", { count: "exact", head: true })
    .is("invoice_no", null).not("file_path", "is", null).neq("source", "cash");

  return NextResponse.json({ ok: true, processed, updated, cuiAdded, errors, remaining: remaining ?? 0 });
}
