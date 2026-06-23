import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL } from "@/lib/config";
import crypto from "crypto";

export const runtime = "nodejs";

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CSEC = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const baseUrl = (req) => `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;

function verifyState(state) {
  try {
    const [data, sig] = String(state).split(".");
    const expect = crypto.createHmac("sha256", SERVICE).update(data).digest("base64url");
    if (expect !== sig) return null;
    const o = JSON.parse(Buffer.from(data, "base64url").toString());
    if (!o.exp || o.exp < Date.now()) return null;
    return o;
  } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const base = baseUrl(req);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !verifyState(state) || !CID || !CSEC) {
    return NextResponse.redirect(`${base}/?gdrive=error`);
  }
  try {
    const tok = await (await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: CID, client_secret: CSEC, redirect_uri: `${base}/api/google/callback`, grant_type: "authorization_code" }),
    })).json();
    if (!tok.refresh_token) return NextResponse.redirect(`${base}/?gdrive=norefresh`);
    let email = "";
    try {
      const ui = await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${tok.access_token}` } })).json();
      email = ui.email || "";
    } catch {}
    const s = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });
    await s.from("google_connection").upsert({ id: 1, refresh_token: tok.refresh_token, email, connected_at: new Date().toISOString() }, { onConflict: "id" });
    return NextResponse.redirect(`${base}/?gdrive=ok`);
  } catch (e) {
    console.error("[/api/google/callback] Error:", e?.message);
    return NextResponse.redirect(`${base}/?gdrive=error`);
  }
}
