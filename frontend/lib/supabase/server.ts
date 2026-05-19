import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is required");
  }
  if (!key) {
    throw new Error("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
