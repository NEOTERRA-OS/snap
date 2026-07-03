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

// Slug aus Bezeichnung erzeugen (a-z0-9-), Umlaute vereinfachen.
function slugify(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "kategorie";
}

export async function GET(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { data } = await svc().from("categories").select("id,key,label,icon,sort,active").order("sort");
  return NextResponse.json({ items: data || [] });
}

export async function POST(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const label = (body.label || "").trim();
  const icon = (body.icon || "receipt").trim() || "receipt";
  if (!label) return NextResponse.json({ error: "Bezeichnung erforderlich." }, { status: 400 });
  const s = svc();
  const { data: existing } = await s.from("categories").select("key,sort");
  const used = new Set((existing || []).map((c) => (c.key || "").toLowerCase()));
  let base = slugify(label), key = base, n = 2;
  while (used.has(key.toLowerCase())) { key = `${base}-${n}`; n++; }
  const maxSort = (existing || []).reduce((m, c) => Math.max(m, c.sort || 0), 0);
  const { data, error } = await s.from("categories").insert({ key, label, icon, sort: maxSort + 1, active: true }).select("id,key,label,icon,sort,active").single();
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
  if (typeof body.label === "string" && body.label.trim()) patch.label = body.label.trim();
  if (typeof body.icon === "string" && body.icon.trim()) patch.icon = body.icon.trim();
  if (typeof body.sort === "number") patch.sort = body.sort;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nichts zu ändern" }, { status: 400 });
  const { error } = await svc().from("categories").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

// Löschen, wenn ungenutzt und nicht „other"; sonst deaktivieren (Belege behalten ihre Zuordnung).
export async function DELETE(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  const s = svc();
  const { data: row } = await s.from("categories").select("key").eq("id", body.id).single();
  if (!row) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (row.key === "other") return NextResponse.json({ error: "Die Kategorie „Sonstiges“ kann nicht gelöscht werden." }, { status: 400 });
  const { count } = await s.from("receipts").select("id", { count: "exact", head: true }).eq("category", row.key);
  if ((count ?? 0) > 0) {
    await s.from("categories").update({ active: false }).eq("id", body.id);
    return NextResponse.json({ ok: true, deactivated: true, used: count });
  }
  const { error } = await s.from("categories").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, deleted: true });
}
