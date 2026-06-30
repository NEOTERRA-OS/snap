import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";

export const runtime = "nodejs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Markiert das eigene Passwort als gesetzt (must_change_password = false).
// Das eigentliche Passwort ändert der Client direkt via supabase.auth.updateUser().
export async function POST(req) {
  if (!SERVICE) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY fehlt" }, { status: 501 });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return NextResponse.json({ error: "Ungültige Sitzung" }, { status: 401 });
  const svc = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
  const { error: upErr } = await svc.from("profiles").update({ must_change_password: false }).eq("id", u.user.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
