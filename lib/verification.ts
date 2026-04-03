import { zodTextFormat } from "openai/helpers/zod";

import { averageConfidence, clampConfidence } from "@/lib/confidence";
import { resolveGenderExtraction } from "@/lib/gender-extraction";
import { inspectImageQuality } from "@/lib/image-quality";
import { matchRomanizedName } from "@/lib/name-matcher";
import { normalizeLooseText, uniqueNameList } from "@/lib/name-normalizer";
import { getModelCandidates, getOpenAIClient } from "@/lib/openai";
import {
  type OpenAiExtraction,
  openAiExtractionSchema,
} from "@/lib/openai-schema";
import type { VerificationResult } from "@/types/verification";

export const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export class VerificationError extends Error {
  statusCode: number;
  userMessage: string;

  constructor(statusCode: number, userMessage: string, message?: string) {
    super(message ?? userMessage);
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

interface VerifyIdInput {
  englishName: string;
  countryHint: string;
  documentTypeHint: string;
  file: File;
}

const SYSTEM_PROMPT = `You are an identity document analyzer.
You receive a user-entered English full name plus one ID image.
Return only JSON that matches the provided schema.

Rules:
- Do not invent invisible values.
- Unknown strings must be "".
- Unknown arrays must be [].
- All confidence values must be numbers between 0 and 1.
- country_detected should use ISO 3166-1 alpha-2 when confident, otherwise "".
- date_of_birth must be normalized to YYYY-MM-DD when confident, otherwise "".
- Keep the original local-script names separate from romanized names.
- Provide one primary romanized full name plus alternative romanizations when more than one is plausible.
- If name order is ambiguous, explain it in romanization_notes.
- Gender may only be returned when a printed gender/sex label and value are visible or strongly supported by OCR evidence.
- Never infer gender from face, name, or document number patterns.
- If the document is blurry, cropped, reflective, tilted, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.`;

export async function verifyIdDocument({
  englishName,
  countryHint,
  documentTypeHint,
  file,
}: VerifyIdInput): Promise<VerificationResult> {
  validateInputs({ englishName, file });

  const buffer = Buffer.from(await file.arrayBuffer());
  const localImageQuality = inspectImageQuality(buffer, file.size);
  const extraction = await extractWithOpenAI({
    englishName,
    countryHint,
    documentTypeHint,
    file,
    buffer,
  });
  const cleanedExtraction = sanitizeExtraction(extraction, englishName);
  const gender = resolveGenderExtraction({
    countryDetected: cleanedExtraction.country_detected,
    gender: cleanedExtraction.gender,
    genderConfidence: cleanedExtraction.gender_confidence,
    genderSource: cleanedExtraction.gender_source,
    genderEvidence: cleanedExtraction.gender_evidence,
    genderNotes: cleanedExtraction.gender_notes,
  });

  const documentQualityConfidence = clampConfidence(
    Math.min(
      cleanedExtraction.document_quality_confidence * 0.75 +
        localImageQuality.confidence * 0.25,
      localImageQuality.notes.length
        ? localImageQuality.confidence + 0.08
        : cleanedExtraction.document_quality_confidence,
    ),
  );

  const nameEvidenceConfidence = averageConfidence([
    cleanedExtraction.first_name_confidence,
    cleanedExtraction.last_name_confidence,
    cleanedExtraction.middle_name
      ? cleanedExtraction.middle_name_confidence
      : undefined,
    cleanedExtraction.overall_confidence,
    documentQualityConfidence,
  ]);

  const nameMatch = matchRomanizedName({
    userInput: englishName,
    primaryRomanization: cleanedExtraction.romanization_primary_full_name,
    alternativeRomanizations: cleanedExtraction.romanization_alternatives,
    firstName: cleanedExtraction.first_name,
    middleName: cleanedExtraction.middle_name,
    lastName: cleanedExtraction.last_name,
    evidenceConfidence: nameEvidenceConfidence,
    documentQualityConfidence,
    romanizationNotes: [
      cleanedExtraction.romanization_notes,
      cleanedExtraction.document_quality_notes,
    ]
      .filter(Boolean)
      .join(" "),
  });

  const warnings = uniqueStrings([
    ...cleanedExtraction.warnings,
    ...localImageQuality.warnings,
    ...buildDerivedWarnings(cleanedExtraction, {
      documentQualityConfidence,
      genderWasHeldBack: !gender.gender,
      nameMatchReason: nameMatch.reason,
    }),
  ]);

  const documentQualityNotes = uniqueStrings([
    cleanedExtraction.document_quality_notes,
    ...localImageQuality.notes,
  ]).join(" ");

  const overallConfidence = clampConfidence(
    averageConfidence([
      cleanedExtraction.overall_confidence,
      documentQualityConfidence,
      nameMatch.confidence,
      cleanedExtraction.first_name_confidence,
      cleanedExtraction.last_name_confidence,
      cleanedExtraction.date_of_birth_confidence,
      cleanedExtraction.nationality_confidence,
      gender.gender
        ? gender.gender_confidence
        : cleanedExtraction.gender_confidence > 0
          ? 0.35
          : undefined,
    ]),
  );

  const manualReviewRequired =
    cleanedExtraction.manual_review_required ||
    nameMatch.result === "manual_review" ||
    documentQualityConfidence < 0.55 ||
    !cleanedExtraction.romanization_primary_full_name ||
    !cleanedExtraction.first_name ||
    !cleanedExtraction.last_name ||
    warnings.length > 0;

  return {
    user_input_english_name: englishName,
    country_detected: cleanedExtraction.country_detected,
    document_type_detected:
      cleanedExtraction.document_type_detected || documentTypeHint.trim(),
    document_quality_confidence: documentQualityConfidence,
    document_quality_notes:
      documentQualityNotes ||
      "No additional image-quality issues were detected by the local heuristic.",
    first_name: cleanedExtraction.first_name,
    local_first_name: cleanedExtraction.local_first_name,
    first_name_confidence: cleanedExtraction.first_name_confidence,
    local_first_name_confidence: cleanedExtraction.local_first_name_confidence,
    last_name: cleanedExtraction.last_name,
    local_last_name: cleanedExtraction.local_last_name,
    last_name_confidence: cleanedExtraction.last_name_confidence,
    local_last_name_confidence: cleanedExtraction.local_last_name_confidence,
    middle_name: cleanedExtraction.middle_name,
    local_middle_name: cleanedExtraction.local_middle_name,
    middle_name_confidence: cleanedExtraction.middle_name_confidence,
    local_middle_name_confidence: cleanedExtraction.local_middle_name_confidence,
    gender: gender.gender,
    gender_confidence: gender.gender_confidence,
    gender_source: gender.gender_source,
    gender_evidence: gender.gender_evidence,
    gender_notes: gender.gender_notes,
    date_of_birth: cleanedExtraction.date_of_birth,
    date_of_birth_confidence: cleanedExtraction.date_of_birth_confidence,
    place_of_birth: cleanedExtraction.place_of_birth,
    place_of_birth_confidence: cleanedExtraction.place_of_birth_confidence,
    nationality: cleanedExtraction.nationality,
    nationality_confidence: cleanedExtraction.nationality_confidence,
    romanization_primary_full_name: cleanedExtraction.romanization_primary_full_name,
    romanization_alternatives: cleanedExtraction.romanization_alternatives,
    romanization_notes: cleanedExtraction.romanization_notes,
    name_match_result: nameMatch.result,
    name_match_confidence: nameMatch.confidence,
    name_match_reason: nameMatch.reason,
    overall_confidence: overallConfidence,
    manual_review_required: manualReviewRequired,
    warnings,
  };
}

function validateInputs({
  englishName,
  file,
}: Pick<VerifyIdInput, "englishName" | "file">) {
  if (!englishName.trim()) {
    throw new VerificationError(
      400,
      "영문 이름을 먼저 입력해주세요.",
      "English name is required.",
    );
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new VerificationError(
      400,
      "JPG, PNG, WEBP, HEIC 이미지 파일만 업로드해주세요.",
      `Unsupported file type: ${file.type}`,
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new VerificationError(
      400,
      "이미지 파일이 너무 큽니다. 8MB 이하 파일을 업로드해주세요.",
      `File too large: ${file.size}`,
    );
  }
}

async function extractWithOpenAI({
  englishName,
  countryHint,
  documentTypeHint,
  file,
  buffer,
}: VerifyIdInput & { buffer: Buffer }) {
  const client = getOpenAIClient();
  const imageDataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;
  const modelCandidates = getModelCandidates();
  const userMessage = buildUserPrompt({
    englishName,
    countryHint,
    documentTypeHint,
  });

  let lastError: unknown;

  for (const model of modelCandidates) {
    try {
      const response = await client.responses.parse({
        model,
        max_output_tokens: 1600,
        input: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: userMessage,
              },
              {
                type: "input_image",
                image_url: imageDataUrl,
                detail: "high",
              },
            ],
          },
        ],
        text: {
          format: zodTextFormat(openAiExtractionSchema, "id_document_verification"),
        },
      });

      if (!response.output_parsed) {
        throw new Error("OpenAI returned no parsed output.");
      }

      return response.output_parsed;
    } catch (error) {
      lastError = error;

      if (!isRetriableModelError(error)) {
        break;
      }
    }
  }

  throw new VerificationError(
    502,
    "신분증 이미지를 분석하는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.",
    lastError instanceof Error ? lastError.message : "OpenAI extraction failed.",
  );
}

function buildUserPrompt({
  englishName,
  countryHint,
  documentTypeHint,
}: Omit<VerifyIdInput, "file">) {
  return [
    `User entered English full name: ${englishName.trim()}`,
    `Country hint: ${countryHint.trim() || "none"}`,
    `Document type hint: ${documentTypeHint.trim() || "none"}`,
    "Analyze the document image and extract the required fields.",
    "Keep unknown strings as empty strings and unknown arrays as empty arrays.",
    "Provide a primary romanized full name and any credible alternatives.",
    "Do not infer gender without visible OCR label/value evidence.",
  ].join("\n");
}

function sanitizeExtraction(extraction: OpenAiExtraction, englishName: string) {
  const normalizedDate = normalizeDateValue(extraction.date_of_birth);

  return {
    country_detected: cleanText(extraction.country_detected),
    document_type_detected: cleanText(extraction.document_type_detected),
    document_quality_confidence: clampConfidence(extraction.document_quality_confidence),
    document_quality_notes: cleanText(extraction.document_quality_notes),
    first_name: cleanText(extraction.first_name),
    local_first_name: cleanText(extraction.local_first_name),
    first_name_confidence: clampConfidence(extraction.first_name_confidence),
    local_first_name_confidence: clampConfidence(extraction.local_first_name_confidence),
    last_name: cleanText(extraction.last_name),
    local_last_name: cleanText(extraction.local_last_name),
    last_name_confidence: clampConfidence(extraction.last_name_confidence),
    local_last_name_confidence: clampConfidence(extraction.local_last_name_confidence),
    middle_name: cleanText(extraction.middle_name),
    local_middle_name: cleanText(extraction.local_middle_name),
    middle_name_confidence: clampConfidence(extraction.middle_name_confidence),
    local_middle_name_confidence: clampConfidence(
      extraction.local_middle_name_confidence,
    ),
    gender: extraction.gender,
    gender_confidence: clampConfidence(extraction.gender_confidence),
    gender_source: extraction.gender_source,
    gender_evidence: cleanText(extraction.gender_evidence),
    gender_notes: cleanText(extraction.gender_notes),
    date_of_birth: normalizedDate,
    date_of_birth_confidence: normalizedDate
      ? clampConfidence(extraction.date_of_birth_confidence)
      : clampConfidence(Math.min(extraction.date_of_birth_confidence, 0.35)),
    place_of_birth: cleanText(extraction.place_of_birth),
    place_of_birth_confidence: clampConfidence(extraction.place_of_birth_confidence),
    nationality: cleanText(extraction.nationality),
    nationality_confidence: clampConfidence(extraction.nationality_confidence),
    romanization_primary_full_name: cleanText(
      extraction.romanization_primary_full_name,
    ),
    romanization_alternatives: uniqueNameList(
      extraction.romanization_alternatives
        .map((value) => cleanText(value))
        .filter(
          (value) =>
            value &&
            normalizeLooseText(value) !== normalizeLooseText(englishName),
        ),
    ),
    romanization_notes: cleanText(extraction.romanization_notes),
    overall_confidence: clampConfidence(extraction.overall_confidence),
    manual_review_required: extraction.manual_review_required,
    warnings: uniqueStrings(extraction.warnings.map((warning) => cleanText(warning))),
  };
}

function cleanText(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "";
  }

  const normalized = normalizeLooseText(trimmed);
  const blockedValues = new Set([
    "n a",
    "na",
    "none",
    "null",
    "unknown",
    "not visible",
    "not available",
    "unreadable",
  ]);

  return blockedValues.has(normalized) ? "" : trimmed;
}

function normalizeDateValue(value: string) {
  const trimmed = cleanText(value);

  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})$/);

  if (!match) {
    return "";
  }

  const [, first, second, third] = match;

  if (first.length === 4) {
    return formatDate(first, second, third);
  }

  if (third.length === 4) {
    const day = Number(first);
    const month = Number(second);

    if (day > 12) {
      return formatDate(third, second, first);
    }

    if (month > 12) {
      return formatDate(third, first, second);
    }
  }

  return "";
}

function formatDate(year: string, month: string, day: string) {
  const safeMonth = Number(month);
  const safeDay = Number(day);

  if (
    Number.isNaN(safeMonth) ||
    Number.isNaN(safeDay) ||
    safeMonth < 1 ||
    safeMonth > 12 ||
    safeDay < 1 ||
    safeDay > 31
  ) {
    return "";
  }

  return `${year.padStart(4, "0")}-${String(safeMonth).padStart(2, "0")}-${String(
    safeDay,
  ).padStart(2, "0")}`;
}

function buildDerivedWarnings(
  extraction: ReturnType<typeof sanitizeExtraction>,
  {
    documentQualityConfidence,
    genderWasHeldBack,
    nameMatchReason,
  }: {
    documentQualityConfidence: number;
    genderWasHeldBack: boolean;
    nameMatchReason: string;
  },
) {
  const warnings: string[] = [];

  if (documentQualityConfidence < 0.55) {
    warnings.push("Image quality is low; manual review is recommended.");
  }

  if (!extraction.romanization_primary_full_name) {
    warnings.push("The primary romanized full name could not be extracted confidently.");
  }

  if (!extraction.date_of_birth) {
    warnings.push("Date of birth could not be standardized confidently.");
  }

  if (genderWasHeldBack) {
    warnings.push("Gender was withheld because direct OCR evidence was insufficient.");
  }

  if (nameMatchReason.toLowerCase().includes("manual review")) {
    warnings.push("Name comparison requires manual review.");
  }

  return warnings;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    unique.push(trimmed);
  }

  return unique;
}

function isRetriableModelError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("model") &&
    (message.includes("not found") ||
      message.includes("unsupported") ||
      message.includes("permission") ||
      message.includes("access"))
  );
}
