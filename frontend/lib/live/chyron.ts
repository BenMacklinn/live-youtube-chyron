import type { ChyronGenerationMode, LiveSessionRow } from "@/lib/supabase/types";
import { liveConfig } from "./config";
import { headChars, normalizeChyronText } from "./text";

export const CHYRON_MAX_CHARS = 39;
const CHYRON_TARGET_CHARS = 34;

const CHYRON_WRITING = `Writing chyrons (critical — do this before you output JSON):
1. Draft each headline in ALL CAPS as a complete phrase — a viewer must understand the beat without more context
2. Count every character (letters, spaces, punctuation). The text must be ${CHYRON_MAX_CHARS} or fewer; aim for ${CHYRON_TARGET_CHARS} or less so you never brush the limit
3. If the line is too long or ends on a dangling word (to, on, for, with, and, or, the, a, in, of), rewrite shorter — do not truncate, do not cut mid-thought
4. Prefer shorter structure over cramming: drop words, use tighter nouns — never leave an incomplete trailing phrase to fit the limit
5. When a person's full name eats the limit, do not force it — keep the same style by leading with topic, company, or role instead of first + last name. Use last name only if it still fits; otherwise org or title plus the beat (the story matters more than spelling the whole name)
6. Set charCount to text.length for each option. Only add passing options to chyronOptions — never list drafts that failed the limit. Do not put failure notes like "Too long—removed" in rationale; omit failed drafts and rewrite shorter options until you have 3-5 valid lines (or fewer if the transcript is thin)`;

const SHARED_RULES = `Shared rules (both modes):
- Return 3-5 chyron options in ALL CAPS
- Be specific to what speakers are discussing right now
- Do not repeat chyrons listed as recently approved or rejected
- Do not invent facts not supported by the transcript

${CHYRON_WRITING}

Questions → statement chyrons (both modes):
- Actively listen for questions in the transcript — spoken or implied
- When a question drives the conversation, answer it with a concrete fact or development from the transcript — not a meta label about the conversation
- Rephrase from interrogative to statement: strip filler, keep names/numbers/events, never end with a question mark
- Bad conversions use abstract framing (chart vs narrative, tension, debate, outlook) without stating what actually happened
- Good conversions name the subject and state the beat (who, what, how much, what changed)
- When recent speech centers on a question, include at least one question-derived chyron among your options`;

const JSON_SCHEMA = `Respond with JSON only:
{
  "sessionSummary": "brief running summary of the conversation",
  "recentSummary": "one plain-language sentence on what they're discussing now",
  "detectedQuestions": ["verbatim or paraphrased questions spotted in the transcript"],
  "chyronOptions": [{"text": "ALL CAPS complete phrase", "charCount": 0, "rationale": "brief note"}],
  "verbatimCaption": "cleaned subtitle text for the recent speech"
}`;

const GUEST_SYSTEM_PROMPT = `You generate live broadcast chyrons for a GUEST segment.

Generation mode: Guest — a named guest is on air. The producer set who they are and their company/show.

Your chyrons should:
- Center on the guest and what they are discussing right now
- Anchor every option to the guest — last name, company/show, or role is enough; full first + last name only when it fits with the topic
- Pull the subject from the recent transcript; connect the guest to the live topic, not generic interview filler
- Write tight interview-style lower-thirds: who is on air + what they are talking about

${SHARED_RULES}

${JSON_SCHEMA}`;

const TIMELINE_SYSTEM_PROMPT = `You generate live broadcast chyrons for general TIMELINE coverage.

Generation mode: Timeline — no guest interview framing. Headlines reflect the news topic or conversation beat.

Your chyrons should:
- Capture the current news beat — the topic, story, or development being discussed
- Ground headlines in concrete nouns from the transcript: people, places, organizations, events, numbers — use org or topic when a full personal name is too long
- Never write meta or analyst-style labels (vs, narrative, outlook, tension) when the transcript has actual facts to use
- Write general coverage lower-thirds, not guest-interview labels, unless the transcript is clearly about a specific person
- Lead with the story; add detail only when it fits the character limit

${SHARED_RULES}

${JSON_SCHEMA}`;

export type ChyronPrompt = {
  system: string;
  user: string;
  mode: ChyronGenerationMode;
};

export type ChyronModelResponse = {
  sessionSummary: string;
  recentSummary: string;
  verbatimCaption: string;
  detectedQuestions: string[];
  chyronOptions: Array<{ text: string; rationale: string }>;
};

export type ChyronOptionRow = {
  id: string;
  batch_id: string;
  session_id: string;
  option_index: number;
  text: string;
  rationale: string;
};

export function isGuestMode(session: LiveSessionRow) {
  return session.generation_mode === "guest";
}

export function guestContextReady(session: LiveSessionRow) {
  return Boolean(session.guest_name?.trim()) && Boolean(session.guest_company?.trim());
}

export function shouldGenerateChyrons(session: LiveSessionRow) {
  if (isGuestMode(session) && !guestContextReady(session)) return false;
  return true;
}

function systemPromptForMode(mode: ChyronGenerationMode) {
  return mode === "guest" ? GUEST_SYSTEM_PROMPT : TIMELINE_SYSTEM_PROMPT;
}

function buildContextParts(session: LiveSessionRow, recentTranscript: string) {
  const parts: string[] = [];
  const freshContext = Boolean(session.context_cleared_at) && !session.session_summary.trim();

  if (freshContext) {
    parts.push("Context was cleared. Summarize and generate chyrons from the recent transcript only.");
  } else if (session.session_summary.trim()) {
    parts.push(`Session summary so far (refine, do not discard prior context):\n${session.session_summary}`);
  }

  parts.push(`Recent transcript (last ${session.context_window_sec}s):\n${recentTranscript}`);
  parts.push(`Keep sessionSummary under ${liveConfig.contextSummaryMaxChars} characters.`);

  return parts;
}

export function buildChyronPrompt(
  session: LiveSessionRow,
  recentTranscript: string,
  approved: string[],
  rejected: string[],
): ChyronPrompt {
  const mode = session.generation_mode ?? "timeline";
  const parts = buildContextParts(session, recentTranscript);

  if (mode === "guest") {
    const guestName = session.guest_name?.trim() ?? "";
    const guestCompany = session.guest_company?.trim() ?? "";
    parts.push(
      `On-air guest (required context — every chyron should tie to this guest):\nName: ${guestName}\nCompany / show: ${guestCompany}`,
    );
  } else {
    parts.push("No guest segment — topic-driven headlines only.");
  }

  if (approved.length > 0) {
    parts.push(`Recently approved (do not repeat): ${JSON.stringify(approved)}`);
  }
  if (rejected.length > 0) {
    parts.push(`Recently rejected (do not repeat): ${JSON.stringify(rejected)}`);
  }

  parts.push(
    `Chyron limit: each text must be a complete phrase, ${CHYRON_MAX_CHARS} characters or fewer (aim ${CHYRON_TARGET_CHARS}). Count before you respond.`,
  );

  return {
    mode,
    system: systemPromptForMode(mode),
    user: parts.join("\n\n"),
  };
}

function isPublishableChyronOption(text: string, rationale: string, charCount?: number) {
  if (text.length > CHYRON_MAX_CHARS) return false;
  if (typeof charCount === "number" && charCount > CHYRON_MAX_CHARS) return false;
  if (/too long|over limit|exceeds.*limit|did not fit|removed draft/i.test(rationale)) return false;
  return true;
}

export function parseChyronResponse(raw: string): ChyronModelResponse {
  const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
  const options = Array.isArray(parsed.chyronOptions) ? parsed.chyronOptions : [];
  const questions = Array.isArray(parsed.detectedQuestions) ? parsed.detectedQuestions : [];

  return {
    sessionSummary: String(parsed.sessionSummary ?? "").trim(),
    recentSummary: String(parsed.recentSummary ?? "").trim(),
    verbatimCaption: String(parsed.verbatimCaption ?? "").trim(),
    detectedQuestions: questions.slice(0, 5).map((question) => String(question).trim()).filter(Boolean),
    chyronOptions: options.slice(0, 8).flatMap((option) => {
      const row = option as Record<string, unknown>;
      const text = normalizeChyronText(String(row.text ?? ""));
      const rationale = String(row.rationale ?? "").trim();
      const charCount = typeof row.charCount === "number" ? row.charCount : undefined;
      if (!text || text.length < 8 || !isPublishableChyronOption(text, rationale, charCount)) {
        return [];
      }
      return [{ text, rationale }];
    }),
  };
}

export function buildChyronOptionRows(
  options: Array<{ text: string; rationale: string }>,
  batchId: string,
  sessionId: string,
  skipTexts: Set<string>,
): ChyronOptionRow[] {
  const rows: ChyronOptionRow[] = [];

  for (const option of options) {
    const text = normalizeChyronText(option.text);
    if (!text || text.length < 8 || text.length > CHYRON_MAX_CHARS || skipTexts.has(text)) continue;

    rows.push({
      id: `${batchId}-${rows.length}`,
      batch_id: batchId,
      session_id: sessionId,
      option_index: rows.length,
      text,
      rationale: option.rationale,
    });

    if (rows.length >= 5) break;
  }

  return rows;
}

export function trimChyronFields(response: ChyronModelResponse) {
  return {
    sessionSummary: response.sessionSummary
      ? headChars(response.sessionSummary, liveConfig.contextSummaryMaxChars)
      : "",
    recentSummary: response.recentSummary
      ? headChars(response.recentSummary, liveConfig.recentSummaryMaxChars)
      : "",
    verbatimCaption: response.verbatimCaption,
  };
}
