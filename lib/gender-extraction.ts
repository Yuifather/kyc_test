import { clampConfidence } from "@/lib/confidence";
import { normalizeLooseText } from "@/lib/name-normalizer";
import type { GenderSource, GenderValue } from "@/types/verification";

export const GENDER_LABEL_HINTS: Record<string, string[]> = {
  KR: ["성별", "SEX", "Sex", "Gender"],
  CN: ["性别", "性別", "Sex"],
  JP: ["性別", "Sex", "Gender"],
  PH: ["Sex", "SEX"],
  ID: ["Jenis Kelamin", "Kelamin", "Sex"],
  MY: ["Jantina", "Gender", "Sex"],
  KH: ["Sex", "Gender"],
  IN: ["Gender", "GENDER", "लिंग"],
  AE: ["Sex", "Gender"],
  AR: ["Sexo", "Sex"],
  BR: ["Sexo", "Sex"],
  NG: ["Sex", "Gender"],
};

export const GENDER_VALUE_MAP: Record<string, Exclude<GenderValue, "">> = {
  male: "Male",
  m: "Male",
  남: "Male",
  男: "Male",
  lelaki: "Male",
  "laki-laki": "Male",
  pria: "Male",
  masculino: "Male",
  female: "Female",
  f: "Female",
  여: "Female",
  女: "Female",
  perempuan: "Female",
  wanita: "Female",
  feminino: "Female",
  x: "X",
  other: "X",
  transgender: "X",
  t: "X",
};

const COUNTRY_ALIASES: Record<string, string> = {
  korea: "KR",
  "south korea": "KR",
  "republic of korea": "KR",
  china: "CN",
  japan: "JP",
  philippines: "PH",
  indonesia: "ID",
  malaysia: "MY",
  cambodia: "KH",
  india: "IN",
  uae: "AE",
  "united arab emirates": "AE",
  argentina: "AR",
  brazil: "BR",
  nigeria: "NG",
};

interface ResolveGenderInput {
  countryDetected: string;
  gender: GenderValue;
  genderConfidence: number;
  genderSource: GenderSource;
  genderEvidence: string;
  genderNotes: string;
}

export function normalizeCountryCode(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const upper = trimmed.toUpperCase();

  if (/^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  return COUNTRY_ALIASES[normalizeLooseText(trimmed)] ?? trimmed;
}

export function resolveGenderExtraction({
  countryDetected,
  gender,
  genderConfidence,
  genderSource,
  genderEvidence,
  genderNotes,
}: ResolveGenderInput): {
  gender: GenderValue;
  gender_confidence: number;
  gender_source: GenderSource;
  gender_evidence: string;
  gender_notes: string;
} {
  const normalizedCountry = normalizeCountryCode(countryDetected);
  const evidence = genderEvidence.trim();
  const normalizedEvidence = normalizeLooseText(evidence);
  const labelHints = GENDER_LABEL_HINTS[normalizedCountry] ?? [];
  const hasKnownLabel = labelHints.some((label) =>
    normalizedEvidence.includes(normalizeLooseText(label)),
  );
  const mappedValue = mapGenderValue(evidence, normalizedEvidence);
  const modelValue = gender;

  if (!evidence) {
    return {
      gender: "",
      gender_confidence: 0,
      gender_source: "unknown" as GenderSource,
      gender_evidence: "",
      gender_notes:
        genderNotes.trim() ||
        "인쇄된 성별 표기와 값 근거를 확인하지 못해 Gender를 비워두었습니다.",
    };
  }

  if (!mappedValue && !modelValue) {
    return {
      gender: "",
      gender_confidence: 0,
      gender_source: "unknown" as GenderSource,
      gender_evidence: evidence,
      gender_notes:
        genderNotes.trim() ||
        "Gender 관련 근거는 있었지만 지원하는 매핑 기준으로 검증하지 못했습니다.",
    };
  }

  const resolvedValue = mappedValue ?? modelValue;

  if (!resolvedValue) {
    return {
      gender: "",
      gender_confidence: 0,
      gender_source: "unknown" as GenderSource,
      gender_evidence: evidence,
      gender_notes:
        genderNotes.trim() ||
        "Gender 관련 근거는 있었지만 신뢰하기에는 여전히 모호합니다.",
    };
  }

  if (modelValue && mappedValue && modelValue !== mappedValue) {
    return {
      gender: "",
      gender_confidence: 0.2,
      gender_source: "unknown" as GenderSource,
      gender_evidence: evidence,
      gender_notes:
        "Gender 근거와 모델 결과가 서로 달라 수동 검토가 권장됩니다.",
    };
  }

  const resolvedSource = hasKnownLabel
    ? genderSource === "unknown"
      ? "country_label_mapping"
      : genderSource
    : "country_label_mapping";
  const baseConfidence = hasKnownLabel ? Math.max(genderConfidence, 0.72) : 0.45;

  return {
    gender: resolvedValue,
    gender_confidence: clampConfidence(baseConfidence),
    gender_source: resolvedSource,
    gender_evidence: evidence,
    gender_notes:
      genderNotes.trim() ||
      (hasKnownLabel
        ? "인쇄된 성별 표기와 OCR 값을 기준으로 검증했습니다."
        : "가능성 있는 Gender 값은 찾았지만 이를 뒷받침하는 표기가 충분히 명확하지 않습니다."),
  };
}

function mapGenderValue(rawEvidence: string, normalizedEvidence: string) {
  const sortedEntries = Object.entries(GENDER_VALUE_MAP).sort(
    ([leftKey], [rightKey]) => rightKey.length - leftKey.length,
  );

  for (const [candidate, mappedValue] of sortedEntries) {
    const normalizedCandidate = normalizeLooseText(candidate);

    if (
      normalizedCandidate &&
      (normalizedEvidence === normalizedCandidate ||
        normalizedEvidence.includes(` ${normalizedCandidate} `) ||
        normalizedEvidence.startsWith(`${normalizedCandidate} `) ||
        normalizedEvidence.endsWith(` ${normalizedCandidate}`) ||
        rawEvidence.includes(candidate))
    ) {
      return mappedValue;
    }
  }

  return "";
}
