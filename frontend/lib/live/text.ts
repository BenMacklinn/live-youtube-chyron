export function dedupeOverlap(previous: string, current: string, maxWords = 12): string {
  const currentWords = current.trim().split(/\s+/).filter(Boolean);
  const previousWords = previous.trim().split(/\s+/).filter(Boolean);
  const maxOverlap = Math.min(maxWords, previousWords.length, currentWords.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    if (normalizeWords(previousWords.slice(-size)).join(" ") === normalizeWords(currentWords.slice(0, size)).join(" ")) {
      return currentWords.slice(size).join(" ");
    }
  }

  return current.trim();
}

export function headChars(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) return value;
  return value.slice(0, maxChars).replace(/\s+\S*$/, "").trimEnd();
}

/** Fit broadcast chyron text to a hard character cap without mid-phrase truncation when possible. */
export function fitChyronText(value: string, maxChars: number): string | null {
  const cleaned = value.trim().toUpperCase();
  if (!cleaned || maxChars <= 0) return null;
  if (cleaned.length <= maxChars) return cleaned;

  const fitted = headChars(cleaned, maxChars);
  if (!fitted || fitted.length < 10) return null;
  if (cleaned.length - fitted.length > 10) return null;

  return fitted;
}

export function tailChars(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) return value;
  return value.slice(-maxChars).replace(/^\S*\s+/, "").trimStart();
}

function normalizeWords(words: string[]) {
  return words.map((word) => word.toLowerCase().replace(/\W+/g, "")).filter(Boolean);
}
