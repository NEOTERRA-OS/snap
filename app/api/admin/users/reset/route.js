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
  return { ok: true, uid: u.user.id };
}

// Admin setzt ein neues Temp-Passwort. Wird einmalig zurückgegeben; der Nutzer
// muss es beim nächsten Login ändern (must_change_password = true).
export async function POST(req) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  const s = svc();
  const password = "Snap-" + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89);
  const { error } = await s.auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await s.from("profiles").update({ must_change_password: true }).eq("id", id);
  return NextResponse.json({ ok: true, password });
}
