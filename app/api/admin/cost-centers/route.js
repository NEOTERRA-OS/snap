import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";

export const runtime = "nodejs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

async function requireAdmin(req) {
  if (!SERVICE) return { error: "SUPABASE_SERVICE_ROLE_KEY fehlt (Vercel-Env)", status: 501 };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Nicht angemeldet", status: 401 };
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return { error: "Ungültige Sitzung", status: 401 };
  const { data: prof } = await svc().from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "admin") return { error: "Nur Administratoren.", status: 403 };
  return { ok: true };
}

export async function GET(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { data } = await svc().from("cost_centers").select("id,code,name,active").order("code");
  return NextResponse.json({ items: data || [] });
}

export async function POST(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  let code = (body.code || "").trim();
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Bezeichnung erforderlich." }, { status: 400 });
  const s = svc();
  const { data: existing } = await s.from("cost_centers").select("code");
  const used = new Set((existing || []).map((c) => (c.code || "").toLowerCase()));
  if (!code) {
    // Automatisch generieren (KST-001, KST-002 …), Buchhaltung ist hier zweitrangig.
    let n = (existing?.length || 0) + 1;
    let cand;
    do { cand = "KST-" + String(n).padStart(3, "0"); n++; } while (used.has(cand.toLowerCase()));
    code = cand;
  } else if (used.has(code.toLowerCase())) {
    return NextResponse.json({ error: "Code existiert bereits." }, { status: 409 });
  }
  const { data, error } = await s.from("cost_centers").insert({ code, name, active: true }).select("id,code,name,active").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, item: data });
}

export async function PATCH(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const patch = {};
  if (typeof body.active === "boolean") patch.active = body.active;
  if (typeof body.code === "string" && body.code.trim()) patch.code = body.code.trim();
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nichts zu ändern" }, { status: 400 });
  const { error } = await svc().from("cost_centers").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Löschen, wenn ungenutzt; sonst deaktivieren (Belege behalten ihre Zuordnung).
export async function DELETE(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const s = svc();
  const { count } = await s.from("receipts").select("id", { count: "exact", head: true }).eq("cost_center_id", body.id);
  if ((count ?? 0) > 0) {
    await s.from("cost_centers").update({ active: false }).eq("id", body.id);
    return NextResponse.json({ ok: true, deactivated: true, used: count });
  }
  const { error } = await s.from("cost_centers").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, deleted: true });
}
