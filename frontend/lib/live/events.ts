import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

export async function publishSessionEvent(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  type: string,
  payload: Json,
) {
  const { error } = await supabase.from("session_events").insert({
    session_id: sessionId,
    type,
    payload,
  });

  if (error) {
    throw new Error(`Failed to publish ${type}: ${error.message}`);
  }
}
