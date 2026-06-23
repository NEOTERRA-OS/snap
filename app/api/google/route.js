import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "@/lib/config";
import crypto from "crypto";

export const runtime = "nodejs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const SCOPE = "openid email https://www.googleapis.com/auth/drive";
const svc = () => createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

async function requireAdmin(req) {
  if (!SERVICE) return { error: "SUPABASE_SERVICE_ROLE_KEY fehlt", status: 501 };
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Nicht angemeldet", status: 401 };
  const anon = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });
  const { data: u, error } = await anon.auth.getUser(token);
  if (error || !u?.user) return { error: "Ungültige Sitzung", status: 401 };
  const { data: prof } = await svc().from("profiles").select("role").eq("id", u.user.id).single();
  if (prof?.role !== "admin") return { error: "Nur Administratoren.", status: 403 };
  return { ok: true, uid: u.user.id };
}

const baseUrl = (req) => `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SERVICE).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function GET(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const { data } = await svc().from("google_connection").select("email,connected_at").eq("id", 1).maybeSingle();
  return NextResponse.json({ connected: !!data?.email || !!data?.connected_at, email: data?.email || null, configured: !!CID });
}

export async function POST(req) {
  const g = await requireAdmin(req);
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  if (body.action === "disconnect") {
    await svc().from("google_connection").delete().eq("id", 1);
    return NextResponse.json({ ok: true });
  }
  if (!CID) return NextResponse.json({ error: "GOOGLE_OAUTH_CLIENT_ID fehlt (Vercel-Env)" }, { status: 501 });
  const state = sign({ u: g.uid, exp: Date.now() + 600000 });
  const params = new URLSearchParams({
    client_id: CID,
    redirect_uri: `${baseUrl(req)}/api/google/callback`,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
}
