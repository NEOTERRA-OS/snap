"use client";
import { createClient } from "@supabase/supabase-js";

// Fallbacks prevent the build from crashing if env vars are missing at build time.
// Real (public) values are inlined from Vercel env at build for runtime use.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// All BelegFlow tables live in the dedicated `belegflow` Postgres schema.
export const supabase = createClient(url, key, {
  db: { schema: "belegflow" },
  auth: { persistSession: true, autoRefreshToken: true },
});

// Separate client bound to the `storage` schema is not needed — storage uses its own API.
