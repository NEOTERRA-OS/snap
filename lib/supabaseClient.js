"use client";
import { createClient } from "@supabase/supabase-js";
import { SUPA_URL, SUPA_ANON } from "./config";

// Dedicated Snap project; all tables live in the default `public` schema.
export const supabase = createClient(SUPA_URL, SUPA_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});
