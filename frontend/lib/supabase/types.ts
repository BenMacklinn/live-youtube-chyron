export type SessionMode = "chyron" | "verbatim";
export type ChyronGenerationMode = "guest" | "timeline";
export type SessionStatus = "connecting" | "transcribing" | "error" | "ended";
export type ChyronAction = "approved" | "rejected";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type LiveSessionRow = {
  id: string;
  youtube_url: string;
  mode: SessionMode;
  generation_mode: ChyronGenerationMode;
  status: SessionStatus;
  start_sec: number;
  next_offset_sec: number;
  context_window_sec: number;
  active_chyron: string;
  latest_verbatim: string;
  latest_batch_id: string | null;
  session_summary: string;
  last_topic: string;
  known_entities: string[];
  topic_history: string[];
  context_version: number;
  last_generation_version: number;
  last_generation_at: string | null;
  context_cleared_at: string | null;
  producer_guidance: string;
  guest_name: string;
  guest_company: string;
  last_transcript_text: string;
  audio_bytes_sent: number;
  chyron_input_tokens: number;
  chyron_output_tokens: number;
  chyron_requests: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type TranscriptSegmentRow = {
  id: string;
  session_id: string;
  text: string;
  offset_sec: number;
  created_at: string;
};

export type ChyronBatchRow = {
  id: string;
  session_id: string;
  session_summary: string;
  topic: string;
  entities: string[];
  verbatim_caption: string;
  recent_summary: string;
  chyron_cadence_sec: number;
  next_batch_at: string | null;
  created_at: string;
};

export type ChyronOptionRow = {
  id: string;
  batch_id: string;
  session_id: string;
  option_index: number;
  text: string;
  rationale: string;
  created_at: string;
};

export type ChyronMemoryRow = {
  id: string;
  session_id: string;
  chyron_id: string | null;
  text: string;
  action: ChyronAction;
  created_at: string;
};

export type SessionEventRow = {
  id: string;
  session_id: string;
  type: string;
  payload: Json;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      live_sessions: {
        Row: LiveSessionRow;
        Insert: Partial<LiveSessionRow> & Pick<LiveSessionRow, "youtube_url">;
        Update: Partial<LiveSessionRow>;
        Relationships: [];
      };
      transcript_segments: {
        Row: TranscriptSegmentRow;
        Insert: Partial<TranscriptSegmentRow> & Pick<TranscriptSegmentRow, "session_id" | "text" | "offset_sec">;
        Update: Partial<TranscriptSegmentRow>;
        Relationships: [];
      };
      chyron_batches: {
        Row: ChyronBatchRow;
        Insert: Partial<ChyronBatchRow> & Pick<ChyronBatchRow, "session_id">;
        Update: Partial<ChyronBatchRow>;
        Relationships: [];
      };
      chyron_options: {
        Row: ChyronOptionRow;
        Insert: Partial<ChyronOptionRow> & Pick<ChyronOptionRow, "id" | "batch_id" | "session_id" | "text">;
        Update: Partial<ChyronOptionRow>;
        Relationships: [];
      };
      chyron_memory: {
        Row: ChyronMemoryRow;
        Insert: Partial<ChyronMemoryRow> & Pick<ChyronMemoryRow, "session_id" | "text" | "action">;
        Update: Partial<ChyronMemoryRow>;
        Relationships: [];
      };
      session_events: {
        Row: SessionEventRow;
        Insert: Partial<SessionEventRow> & Pick<SessionEventRow, "session_id" | "type">;
        Update: Partial<SessionEventRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
