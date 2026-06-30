import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";

export const runtime = "nodejs";

const URL = SUPA_URL;
const ANON = SUPA_ANON;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROLES = ["employee", "approver", "accounting", "admin"];

function svc() {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

// Verify the caller's bearer token and that they are an admin. Returns {ok} or {error,status}.
async function requireAdmin(req) {
  if (!SERVICE) return { error: "SUPABASE_SERVICE_ROLE_KEY fehlt (Vercel-Env)", status: 501 };
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Nicht angemeldet", status: 401 };
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return { error: "Ungültige Sitzung", status: 401 };
  const { data: prof } = await svc().from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "admin") return { error: "Nur Administratoren.", status: 403 };
  return { ok: true, uid: u.user.id };
}

export async function GET(req) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const s = svc();
  const { data: profs } = await s.from("profiles").select("id,full_name,role,created_at").order("created_at");
  const { data: list } = await s.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emails = {}; (list?.users || []).forEach((x) => (emails[x.id] = x.email));
  const users = (profs || []).map((p) => ({ ...p, email: emails[p.id] || "" }));
  return NextResponse.json({ users });
}

export async function POST(req) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => ({}));
  const email = (body.email || "").trim().toLowerCase();
  const full_name = (body.full_name || "").trim();
  const role = ROLES.includes(body.role) ? body.role : "employee";
  if (!email) return NextResponse.json({ error: "E-Mail fehlt" }, { status: 400 });
  const password = body.password || ("Snap-" + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89));
  const s = svc();
  const { data, error } = await s.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: full_name || email },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // ensure profile + role (trigger creates the profile row); Nutzer muss Temp-Passwort beim ersten Login ändern
  await s.from("profiles").upsert({ id: data.user.id, full_name: full_name || email, role, must_change_password: true }, { onConflict: "id" });
  return NextResponse.json({ ok: true, user: { id: data.user.id, email, full_name, role }, password });
}

export async function PATCH(req) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => ({}));
  if (!body.id || !ROLES.includes(body.role)) return NextResponse.json({ error: "id/role ungültig" }, { status: 400 });
  const { error } = await svc().from("profiles").update({ role: body.role }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = await req.json().catch(() => ({}));
  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });
  if (id === gate.uid) return NextResponse.json({ error: "Du kannst dich nicht selbst löschen." }, { status: 400 });

  const s = svc();
  const { data: target } = await s.from("profiles").select("id,full_name,role").eq("id", id).single();
  if (!target) return NextResponse.json({ error: "Nutzer nicht gefunden." }, { status: 404 });

  // Letzten Administrator schützen
  if (target.role === "admin") {
    const { count } = await s.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) <= 1) return NextResponse.json({ error: "Der letzte Administrator kann nicht gelöscht werden." }, { status: 400 });
  }

  // Ersteller-Namen auf den Belegen sichern (GoBD: Belege bleiben erhalten, user_id wird via FK auf NULL gesetzt)
  let creatorName = (target.full_name || "").trim();
  if (!creatorName) {
    try { const { data: au } = await s.auth.admin.getUserById(id); creatorName = au?.user?.email || ""; } catch {}
  }
  if (creatorName) {
    await s.from("receipts").update({ creator_name: creatorName }).eq("user_id", id).or("creator_name.is.null,creator_name.eq.");
  }

  // Auth-User löschen → Profil cascadet, Belege bleiben (user_id = NULL, creator_name erhalten)
  const { error } = await s.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
