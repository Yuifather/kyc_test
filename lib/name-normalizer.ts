export interface NormalizedName {
  raw: string;
  normalized: string;
  tokens: string[];
  joined: string;
  sortedTokens: string[];
}

const NAME_PUNCTUATION_REGEX = /[-_/,'`.]+/g;
const NON_WORD_SEPARATOR_REGEX = /[^\p{L}\p{N}\s]/gu;
const COLLAPSE_SPACES_REGEX = /\s+/g;

export function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeLooseText(value: string) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(NAME_PUNCTUATION_REGEX, " ")
    .replace(NON_WORD_SEPARATOR_REGEX, " ")
    .replace(COLLAPSE_SPACES_REGEX, " ")
    .trim();
}

export function normalizeName(value: string): NormalizedName {
  const normalized = normalizeLooseText(value);
  const tokens = normalized ? normalized.split(" ") : [];

  return {
    raw: value,
    normalized,
    tokens,
    joined: tokens.join(""),
    sortedTokens: [...tokens].sort(),
  };
}

export function joinNameParts(parts: string[]) {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(COLLAPSE_SPACES_REGEX, " ")
    .trim();
}

export function uniqueNameList(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalizeName(value);
    const key = `${normalized.joined}|${normalized.sortedTokens.join(" ")}`;

    if (!normalized.normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value.trim());
  }

  return unique;
}
