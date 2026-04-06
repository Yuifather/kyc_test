import { clampConfidence } from "@/lib/confidence";
import {
  joinNameParts,
  normalizeLooseText,
  normalizeName,
  type NormalizedName,
} from "@/lib/name-normalizer";
import type { MatchResult, NameMatchEvaluation } from "@/types/verification";

interface MatchRomanizedNameInput {
  userInput: string;
  primaryRomanization: string;
  alternativeRomanizations: string[];
  firstName: string;
  middleName: string;
  lastName: string;
  evidenceConfidence: number;
  documentQualityConfidence: number;
  romanizationNotes: string;
}

interface CandidateName {
  value: string;
  source:
    | "primary"
    | "alternative"
    | "component_full"
    | "component_no_middle"
    | "surname_first"
    | "surname_first_no_middle";
  normalized: NormalizedName;
}

interface CandidateEvaluation {
  result: MatchResult;
  score: number;
  reason: string;
}

const AMBIGUOUS_NOTE_MARKERS = [
  "ambiguous",
  "uncertain",
  "unclear",
  "weak",
  "blurry",
  "low quality",
  "hard to read",
  "multiple possible",
  "order unclear",
];

export function matchRomanizedName({
  userInput,
  primaryRomanization,
  alternativeRomanizations,
  firstName,
  middleName,
  lastName,
  evidenceConfidence,
  documentQualityConfidence,
  romanizationNotes,
}: MatchRomanizedNameInput): NameMatchEvaluation {
  const user = normalizeName(userInput);
  const candidates = buildCandidates({
    primaryRomanization,
    alternativeRomanizations,
    firstName,
    middleName,
    lastName,
  });

  if (!user.normalized || !candidates.length) {
    return {
      result: "manual_review",
      confidence: clampConfidence((evidenceConfidence + documentQualityConfidence) / 2),
      reason: "추출된 영문화 이름이 불완전하여 수동 검토가 권장됩니다.",
      matchedValue: "",
      score: 0,
    };
  }

  let bestCandidate = candidates[0];
  let bestEvaluation = evaluateCandidate(user, candidates[0]);

  for (const candidate of candidates.slice(1)) {
    const evaluation = evaluateCandidate(user, candidate);

    if (evaluation.score > bestEvaluation.score) {
      bestCandidate = candidate;
      bestEvaluation = evaluation;
    }
  }

  const ambiguousRomanization = isRomanizationAmbiguous(romanizationNotes);

  if (
    bestEvaluation.result === "mismatch" &&
    evidenceConfidence < 0.55 &&
    documentQualityConfidence < 0.7
  ) {
    return {
      result: "manual_review",
      confidence: clampConfidence((bestEvaluation.score + evidenceConfidence) / 2),
      reason: "OCR 품질이 낮고 영문화가 불확실하여 수동 검토가 권장됩니다.",
      matchedValue: bestCandidate.value,
      score: bestEvaluation.score,
    };
  }

  if (
    evidenceConfidence < 0.42 ||
    (ambiguousRomanization &&
      bestEvaluation.result !== "exact_match" &&
      documentQualityConfidence < 0.75)
  ) {
    return {
      result: "manual_review",
      confidence: clampConfidence(
        0.35 + bestEvaluation.score * 0.2 + evidenceConfidence * 0.25,
      ),
      reason: "OCR 품질이 낮고 영문화가 불확실하여 수동 검토가 권장됩니다.",
      matchedValue: bestCandidate.value,
      score: bestEvaluation.score,
    };
  }

  return {
    result: bestEvaluation.result,
    confidence: resultConfidence(bestEvaluation.result, bestEvaluation.score, evidenceConfidence),
    reason: bestEvaluation.reason,
    matchedValue: bestCandidate.value,
    score: bestEvaluation.score,
  };
}

function buildCandidates({
  primaryRomanization,
  alternativeRomanizations,
  firstName,
  middleName,
  lastName,
}: Omit<
  MatchRomanizedNameInput,
  "userInput" | "evidenceConfidence" | "documentQualityConfidence" | "romanizationNotes"
>) {
  const rawCandidates: Array<Pick<CandidateName, "source" | "value">> = [];

  if (primaryRomanization.trim()) {
    rawCandidates.push({ source: "primary", value: primaryRomanization });
  }

  for (const alternative of alternativeRomanizations) {
    rawCandidates.push({ source: "alternative", value: alternative });
  }

  const fullName = joinNameParts([firstName, middleName, lastName]);
  const noMiddleName = joinNameParts([firstName, lastName]);
  const surnameFirstFull = joinNameParts([lastName, firstName, middleName]);
  const surnameFirstNoMiddle = joinNameParts([lastName, firstName]);

  if (fullName) {
    rawCandidates.push({ source: "component_full", value: fullName });
  }

  if (middleName && noMiddleName) {
    rawCandidates.push({ source: "component_no_middle", value: noMiddleName });
  }

  if (surnameFirstFull) {
    rawCandidates.push({ source: "surname_first", value: surnameFirstFull });
  }

  if (middleName && surnameFirstNoMiddle) {
    rawCandidates.push({
      source: "surname_first_no_middle",
      value: surnameFirstNoMiddle,
    });
  }

  const uniqueByNormalized = new Set<string>();
  const candidates: CandidateName[] = [];

  for (const rawCandidate of rawCandidates) {
    const normalized = normalizeName(rawCandidate.value);
    const key = `${normalized.joined}|${normalized.sortedTokens.join(" ")}|${rawCandidate.source}`;

    if (!normalized.normalized || uniqueByNormalized.has(key)) {
      continue;
    }

    uniqueByNormalized.add(key);
    candidates.push({
      source: rawCandidate.source,
      value: rawCandidate.value.trim(),
      normalized,
    });
  }

  return candidates;
}

function evaluateCandidate(user: NormalizedName, candidate: CandidateName): CandidateEvaluation {
  if (!user.joined || !candidate.normalized.joined) {
    return {
      result: "manual_review",
      score: 0,
      reason: "입력값으로부터 신뢰할 수 있는 정규화 이름을 만들지 못했습니다.",
    };
  }

  if (user.joined === candidate.normalized.joined) {
    if (candidate.source === "surname_first" || candidate.source === "surname_first_no_middle") {
      return {
        result: "likely_match",
        score: 0.93,
        reason: "성/이름 순서를 바꿨을 때 일치했습니다.",
      };
    }

    if (
      candidate.source === "component_no_middle"
    ) {
      return {
        result: "likely_match",
        score: 0.85,
        reason: "입력값에는 Middle name이 없지만 First name과 Last name은 일치합니다.",
      };
    }

    if (candidate.source === "alternative") {
      return {
        result: "exact_match",
        score: 0.98,
        reason: "사용자 입력값이 정규화 후 대체 영문화 전체 이름 중 하나와 일치합니다.",
      };
    }

    return {
      result: "exact_match",
      score: 1,
      reason: "사용자 입력값이 정규화 후 주 영문화 전체 이름과 일치합니다.",
    };
  }

  if (user.sortedTokens.join(" ") === candidate.normalized.sortedTokens.join(" ")) {
    return {
      result: "likely_match",
      score: 0.89,
      reason: "띄어쓰기 또는 순서 차이만 있고 이름 토큰은 동일합니다.",
    };
  }

  if (matchesWithoutMiddle(user.tokens, candidate.normalized.tokens)) {
    return {
      result: "likely_match",
      score: 0.82,
      reason: "한쪽에서 Middle name이 생략되었지만 First name과 Last name은 일치합니다.",
    };
  }

  const joinedSimilarity = levenshteinSimilarity(user.joined, candidate.normalized.joined);
  const sortedSimilarity = levenshteinSimilarity(
    user.sortedTokens.join(""),
    candidate.normalized.sortedTokens.join(""),
  );
  const tokenOverlap = overlapScore(user.tokens, candidate.normalized.tokens);
  const score = Math.max(joinedSimilarity, sortedSimilarity, tokenOverlap);

  if (score >= 0.88) {
    return {
      result: "likely_match",
      score,
      reason: "정규화 후 이름이 매우 유사하며 영문화 표기 차이만 작게 보입니다.",
    };
  }

  if (score >= 0.7) {
    return {
      result: "possible_match",
      score,
      reason: "이름 겹침은 크지만 영문화 표기가 다소 모호합니다.",
    };
  }

  const surnameMismatch = !sharesOuterTokens(user.tokens, candidate.normalized.tokens);

  return {
    result: "mismatch",
    score,
    reason: surnameMismatch
      ? "성이 추출된 이름과 실질적으로 다릅니다."
      : "추출된 영문화 이름이 사용자 입력값과 충분히 가깝게 맞지 않습니다.",
  };
}

function matchesWithoutMiddle(userTokens: string[], candidateTokens: string[]) {
  if (userTokens.length < 2 || candidateTokens.length < 2) {
    return false;
  }

  const userOuter = [userTokens[0], userTokens[userTokens.length - 1]].join("");
  const candidateOuter = [
    candidateTokens[0],
    candidateTokens[candidateTokens.length - 1],
  ].join("");

  return userOuter === candidateOuter && userTokens.length !== candidateTokens.length;
}

function sharesOuterTokens(userTokens: string[], candidateTokens: string[]) {
  if (!userTokens.length || !candidateTokens.length) {
    return false;
  }

  const userFirst = userTokens[0];
  const userLast = userTokens[userTokens.length - 1];
  const candidateFirst = candidateTokens[0];
  const candidateLast = candidateTokens[candidateTokens.length - 1];

  return (
    userFirst === candidateFirst ||
    userFirst === candidateLast ||
    userLast === candidateFirst ||
    userLast === candidateLast
  );
}

function overlapScore(userTokens: string[], candidateTokens: string[]) {
  if (!userTokens.length || !candidateTokens.length) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);
  const userSet = new Set(userTokens);
  let shared = 0;

  for (const token of userSet) {
    if (candidateSet.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.max(userSet.size, candidateSet.size);
}

function levenshteinSimilarity(left: string, right: string) {
  if (!left && !right) {
    return 1;
  }

  if (!left || !right) {
    return 0;
  }

  const distance = levenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function levenshteinDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
}

function isRomanizationAmbiguous(notes: string) {
  const normalized = normalizeLooseText(notes);
  return AMBIGUOUS_NOTE_MARKERS.some((marker) => normalized.includes(marker));
}

function resultConfidence(result: MatchResult, score: number, evidenceConfidence: number) {
  switch (result) {
    case "exact_match":
      return clampConfidence(0.88 + score * 0.07 + evidenceConfidence * 0.05);
    case "likely_match":
      return clampConfidence(0.68 + score * 0.17 + evidenceConfidence * 0.1);
    case "possible_match":
      return clampConfidence(0.48 + score * 0.2 + evidenceConfidence * 0.12);
    case "manual_review":
      return clampConfidence(0.35 + score * 0.15 + evidenceConfidence * 0.15);
    case "mismatch":
    default:
      return clampConfidence(0.12 + (1 - score) * 0.2 + evidenceConfidence * 0.03);
  }
}
