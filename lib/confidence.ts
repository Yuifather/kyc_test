import type { ConfidenceTone, MatchResult } from "@/types/verification";

export function clampConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

export function averageConfidence(values: Array<number | undefined>) {
  const safeValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );

  if (!safeValues.length) {
    return 0;
  }

  const total = safeValues.reduce((sum, value) => sum + value, 0);
  return clampConfidence(total / safeValues.length);
}

export function getConfidenceTone(confidence: number): ConfidenceTone {
  if (confidence >= 0.8) {
    return "good";
  }

  if (confidence >= 0.5) {
    return "review";
  }

  return "low";
}

export function getConfidenceLabel(confidence: number) {
  const tone = getConfidenceTone(confidence);

  if (tone === "good") {
    return "높음";
  }

  if (tone === "review") {
    return "검토";
  }

  return "낮음";
}

export function formatConfidence(confidence: number) {
  return `${Math.round(clampConfidence(confidence) * 100)}%`;
}

export function getMatchTone(result: MatchResult): ConfidenceTone {
  switch (result) {
    case "exact_match":
    case "likely_match":
      return "good";
    case "possible_match":
    case "manual_review":
      return "review";
    case "mismatch":
    default:
      return "low";
  }
}

export function getMatchLabel(result: MatchResult) {
  switch (result) {
    case "exact_match":
      return "정확히 일치";
    case "likely_match":
      return "거의 일치";
    case "possible_match":
      return "가능성 있음";
    case "manual_review":
      return "수동 검토";
    case "mismatch":
    default:
      return "불일치";
  }
}
