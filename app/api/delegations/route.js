import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";

export const runtime = "nodejs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

async function requireUser(req) {
  if (!SERVICE) return { error: "SUPABASE_SERVICE_ROLE_KEY fehlt", status: 501 };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Nicht angemeldet", status: 401 };
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return { error: "Ungültige Sitzung", status: 401 };
  return { ok: true, uid: u.user.id };
}

async function resolve(s, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data: profs } = await s.from("profiles").select("id,full_name").in("id", uniq);
  const nameById = {}; (profs || []).forEach((p) => (nameById[p.id] = p.full_name));
  const out = {};
  for (const id of uniq) {
    let email = "";
    try { const { data: gu } = await s.auth.admin.getUserById(id); email = gu?.user?.email || ""; } catch {}
    out[id] = { id, name: nameById[id] || email || id, email };
  }
  return out;
}

export async function GET(req) {
  const g = await requireUser(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const s = svc();
  const { data: mine } = await s.from("submit_delegations").select("delegate_id").eq("owner_id", g.uid);
  const { data: forme } = await s.from("submit_delegations").select("owner_id").eq("delegate_id", g.uid);
  const map = await resolve(s, [...(mine || []).map((r) => r.delegate_id), ...(forme || []).map((r) => r.owner_id)]);
  return NextResponse.json({
    delegates: (mine || []).map((r) => map[r.delegate_id]).filter(Boolean),
    owners: (forme || []).map((r) => map[r.owner_id]).filter(Boolean),
  });
}

export async function POST(req) {
  const g = await requireUser(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { email } = await req.json().catch(() => ({}));
  const e = (email || "").trim().toLowerCase();
  if (!e) return NextResponse.json({ error: "E-Mail fehlt" }, { status: 400 });
  const s = svc();
  const { data: list } = await s.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = (list?.users || []).find((u) => (u.email || "").toLowerCase() === e);
  if (!found) return NextResponse.json({ error: "Kein Nutzer mit dieser E-Mail gefunden." }, { status: 404 });
  if (found.id === g.uid) return NextResponse.json({ error: "Du kannst dich nicht selbst als Vertretung hinzufügen." }, { status: 400 });
  const { error } = await s.from("submit_delegations").upsert({ owner_id: g.uid, delegate_id: found.id }, { onConflict: "owner_id,delegate_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const g = await requireUser(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { delegate_id } = await req.json().catch(() => ({}));
  if (!delegate_id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const { error } = await svc().from("submit_delegations").delete().eq("owner_id", g.uid).eq("delegate_id", delegate_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
