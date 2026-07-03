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

const _fx = new Map(); // "date|CUR" -> rate (EUR je 1 CUR)
async function rateFor(cur, date) {
  const c = (cur || "EUR").toUpperCase();
  if (c === "EUR") return 1;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
  const key = d + "|" + c;
  if (_fx.has(key)) return _fx.get(key);
  let rate = null;
  try {
    const r = await fetch(`https://api.frankfurter.app/${d}?from=${c}&to=EUR`);
    if (r.ok) { const j = await r.json(); rate = j?.rates?.EUR ?? null; }
  } catch {}
  _fx.set(key, rate);
  return rate;
}

// Trägt fehlende EUR-Werte (gross_eur / fx_rate) für Altbelege nach — EZB-Kurs zum Belegdatum.
export async function POST(req) {
  const s = svc();
  const gate = await requireAdmin(req, s);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { data: rows } = await s.from("receipts")
    .select("id,gross,currency,doc_date")
    .is("gross_eur", null).not("gross", "is", null)
    .order("doc_date", { ascending: false }).limit(500);

  let updated = 0, failed = 0;
  for (const r of rows || []) {
    const rate = await rateFor(r.currency, r.doc_date);
    if (rate == null) { failed++; continue; }
    const eur = Math.round(Number(r.gross) * rate * 100) / 100;
    const { error } = await s.from("receipts").update({ gross_eur: eur, fx_rate: rate }).eq("id", r.id);
    if (error) { failed++; continue; }
    updated++;
  }

  const { count: remaining } = await s.from("receipts").select("id", { count: "exact", head: true })
    .is("gross_eur", null).not("gross", "is", null);

  return NextResponse.json({ ok: true, total: (rows || []).length, updated, failed, remaining: remaining ?? 0 });
}
