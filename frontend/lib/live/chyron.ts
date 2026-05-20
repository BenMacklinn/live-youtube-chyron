import type { ChyronGenerationMode, LiveSessionRow } from "@/lib/supabase/types";
import { liveConfig } from "./config";
import { headChars, normalizeChyronText } from "./text";

export const CHYRON_MAX_CHARS = 39;
const CHYRON_TARGET_CHARS = 34;

const CHYRON_HEADLINE_VOICE = `Headline voice (critical):
- Write broad broadcast lower-thirds — the general topic, theme, or question-turned-statement for this segment
- Zoom out from the last sentence: what is the conversation about at a high level, not the tactical step they just mentioned
- One beat per line: state a single fact or theme — do not stack the announcement plus reaction, buzz, or editorial color
- Never write commands, tips, or how-to lines (don't, use, be, try, get, stop, edit, avoid, make, start, keep, you, your)
- Never headline a single tool, workflow step, or piece of advice unless that is the whole segment theme
- Never add hype verbs or vague reaction framing (sparks, buzz, frenzy, shockwaves, ignites, fuels, roils, under fire) when a plain fact headline works
- Prefer broad topic patterns: theme + context, industry + issue, org + big idea, question distilled to a statement headline`;

const CHYRON_WRITING = `Writing chyrons (critical — do this before you output JSON):
${CHYRON_HEADLINE_VOICE}
1. Draft each headline in ALL CAPS as a complete phrase — a viewer must understand the general beat without more context
2. Count every character (letters, spaces, punctuation). The text must be ${CHYRON_MAX_CHARS} or fewer; aim for ${CHYRON_TARGET_CHARS} or less so you never brush the limit
3. If the line is too long or ends on a dangling word (to, on, for, with, and, or, the, a, in, of), rewrite shorter — do not truncate, do not cut mid-thought
4. Prefer shorter structure over cramming: drop words, use tighter nouns — never leave an incomplete trailing phrase to fit the limit
5. When a person's full name eats the limit, do not force it — keep the same style by leading with topic, company, or role instead of first + last name. Use last name only if it still fits; otherwise org or title plus the beat (the story matters more than spelling the whole name)
6. Set charCount to text.length for each option. Only add passing options to chyronOptions — never list drafts that failed the limit. Do not put failure notes like "Too long—removed" in rationale; omit failed drafts and rewrite shorter options until you have 3-5 valid lines (or fewer if the transcript is thin)`;

const SHARED_RULES = `Shared rules (both modes):
- Return 3-5 chyron options in ALL CAPS
- Stay broad: segment themes and general topics, not sentence-level detail or advice fragments
- Do not repeat chyrons listed as recently approved or rejected
- Do not invent facts not supported by the transcript

${CHYRON_WRITING}

Questions → statement chyrons (both modes):
- Actively listen for questions in the transcript — spoken or implied
- When a question is driving the segment, include at least one chyron that summarizes that question as a statement headline — so a viewer tuning in late knows what is being answered
- Keep the question's meaning: distill the same ask into shorter ALL CAPS phrasing, drop filler (you, your, we, so, like), never end with a question mark
- Do not replace the question with an answer, a command, a workflow step, or vague meta framing — the headline should still read as the question being discussed
- List spotted questions in detectedQuestions; when recent speech centers on a question, make question-summary chyrons a priority among your options
- Bad conversions: imperatives, answers instead of the ask, abstract labels (chart vs narrative, tension, debate), or unrelated topic headlines when a clear question is on the table

Granularity:
- Default to general topic headlines for interviews, panels, and advice segments
- When the transcript states hard news (funding, deal, earnings, launch, hire, policy): write plain factual headlines — org + what happened + one number if it fits
- Vary options by picking different single facts (round size, valuation, investor, product) — not by rephrasing the same fact with hype or buzzwords
- Keep hard-news lines simple and direct; save broader theme headlines for when there is no single clear announcement`;

const JSON_SCHEMA = `Respond with JSON only:
{
  "sessionSummary": "brief running summary of the conversation",
  "recentSummary": "one plain-language sentence on what they're discussing now",
  "detectedQuestions": ["verbatim or paraphrased questions spotted in the transcript"],
  "chyronOptions": [{"text": "ALL CAPS complete phrase", "charCount": 0, "rationale": "brief note"}],
  "verbatimCaption": "cleaned subtitle text for the recent speech"
}`;

const GUEST_SYSTEM_PROMPT = `You generate live broadcast chyrons for a GUEST segment.

Generation mode: Guest — broad topic and question-statement headlines, same style as timeline.

Your chyrons should:
- Capture the general theme of what the guest and hosts are discussing
- When a question is on the table, summarize that question as a statement headline so late viewers know what is being answered
- Use guest name or company only when it helps identify the theme — never force name or company into every line
- Lead with the big idea; avoid tool names, workflow steps, and sentence-level detail

${SHARED_RULES}

${JSON_SCHEMA}`;

const TIMELINE_SYSTEM_PROMPT = `You generate live broadcast chyrons for general TIMELINE coverage.

Generation mode: Timeline — broad news and conversation topics, not guest-interview labels unless the whole segment is about one person.

Your chyrons should:
- Capture the general topic or news theme of the current segment
- When a question is on the table, summarize that question as a statement headline so late viewers know what is being answered
- Use org or person names only when they define the segment theme — not every passing mention
- Write segment-title lower-thirds, not play-by-play of the last few sentences
- Never write meta or analyst-style labels (vs, narrative, outlook, tension) when a clear topic exists

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

export function shouldGenerateChyrons(_session: LiveSessionRow) {
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
    const guestName = session.guest_name?.trim();
    const guestCompany = session.guest_company?.trim();
    if (guestName || guestCompany) {
      parts.push(
        `Optional on-air guest context (include in a chyron only when it fits — not required on every line):\nName: ${guestName || "—"}\nCompany / show: ${guestCompany || "—"}`,
      );
    } else {
      parts.push("Guest segment mode — broad topic headlines from the transcript (same style as timeline).");
    }
  } else {
    parts.push("Timeline mode — broad topic headlines from the transcript.");
  }

  if (approved.length > 0) {
    parts.push(`Recently approved (do not repeat): ${JSON.stringify(approved)}`);
  }
  if (rejected.length > 0) {
    parts.push(`Recently rejected (do not repeat): ${JSON.stringify(rejected)}`);
  }

  parts.push(
    `Chyron limit: each text must be a complete phrase, ${CHYRON_MAX_CHARS} characters or fewer (aim ${CHYRON_TARGET_CHARS}). Count before you respond. If the recent transcript has a clear question, at least one option must summarize that question as a statement for late viewers.`,
  );

  return {
    mode,
    system: systemPromptForMode(mode),
    user: parts.join("\n\n"),
  };
}

function looksLikeEditorialHypeChyron(text: string) {
  return /\b(SPARKS?|IGNITES?|FUELS?|SENDS?|ROILS?)\b.*\b(BUZZ|FRENZY|FIRESTORM|SHOCKWAVES?|DEBATE)\b|\b(VALUATION|STOCK|DEAL)\s+(BUZZ|FRENZY|WATCH)\b/.test(
    text,
  );
}

function looksLikeImperativeChyron(text: string) {
  if (/\b(YOU|YOUR)\b/.test(text)) return true;
  return /^(DON'T|DONT|DO NOT|USE|BE |BE$|TRY|GET |GET$|STOP|EDIT|AVOID|MAKE|TAKE|START|KEEP|NEVER|ALWAYS|LEARN|BUILD|WRITE|SET |SET$|GO |GO$|STAY|RUN|FIX|SKIP|ADD|PUT|PLAN|THINK|FOCUS)\b/.test(
    text,
  );
}

function isPublishableChyronOption(text: string, rationale: string, charCount?: number) {
  if (text.length > CHYRON_MAX_CHARS) return false;
  if (typeof charCount === "number" && charCount > CHYRON_MAX_CHARS) return false;
  if (/too long|over limit|exceeds.*limit|did not fit|removed draft/i.test(rationale)) return false;
  if (looksLikeImperativeChyron(text)) return false;
  if (looksLikeEditorialHypeChyron(text)) return false;
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
