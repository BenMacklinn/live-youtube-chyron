import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const DEFAULT_SUPABASE_URL = "https://xrbbbebtxjekvwkyuloe.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Fo36jr4acI47NPTEduhV4A_jTkLkaC3";

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

  return createClient<Database>(url, key, {
    realtime: {
      params: {
        eventsPerSecond: 20,
      },
    },
  });
}
