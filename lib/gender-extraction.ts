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
        "Gender was withheld because no printed label/value evidence was confirmed.",
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
        "Gender evidence was present but could not be validated against supported mappings.",
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
        "Gender evidence was present but remained too ambiguous to trust.",
    };
  }

  if (modelValue && mappedValue && modelValue !== mappedValue) {
    return {
      gender: "",
      gender_confidence: 0.2,
      gender_source: "unknown" as GenderSource,
      gender_evidence: evidence,
      gender_notes:
        "Gender evidence conflicts with the model output, so manual review is recommended.",
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
        ? "Validated from a printed gender/sex label and OCR value."
        : "A likely gender value was found, but the supporting label was not fully clear."),
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
