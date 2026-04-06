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

interface OpenAIStyleError extends Error {
  status?: number;
  code?: string | null;
  type?: string | null;
}

interface VerifyIdInput {
  englishName: string;
  countryHint: string;
  documentTypeHint: string;
  frontFile: File;
  backFile?: File;
}

const SYSTEM_PROMPT = `You are an identity document analyzer.
You receive a user-entered English full name plus the front image of an ID and sometimes the back image, plus the user-selected document type and issuing country.
Return only JSON that matches the provided schema.

Rules:
- Do not invent invisible values.
- Unknown strings must be "".
- Unknown arrays must be [].
- All confidence values must be numbers between 0 and 1.
- Keep manual_review_required false when optional fields are simply absent on the document.
- Only set manual_review_required to true when image quality or core name evidence is too weak for reliable verification.
- country_detected should use ISO 3166-1 alpha-2 when confident, otherwise "".
- date_of_birth must be normalized to YYYY-MM-DD when confident, otherwise "".
- date_of_expiry must be normalized to YYYY-MM-DD when confident, otherwise "".
- Keep the original local-script names separate from romanized names.
- Provide one primary romanized full name plus alternative romanizations when more than one is plausible.
- If name order is ambiguous, explain it in romanization_notes.
- Gender may only be returned when a printed gender/sex label and value are visible or strongly supported by OCR evidence.
- Never infer gender from face, name, or document number patterns.
- Use the document type and issuing country as strong hints when they are consistent with the image.
- The first image is always the front side. When a second image is provided, treat it as the back side of the same document.
- Use the back side for fields that may only appear there, but do not invent fields if neither side shows them.
- If the document is blurry, cropped, reflective, tilted, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.`;

export async function verifyIdDocument({
  englishName,
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
}: VerifyIdInput): Promise<VerificationResult> {
  validateInputs({
    englishName,
    countryHint,
    documentTypeHint,
    frontFile,
    backFile,
  });

  const frontBuffer = Buffer.from(await frontFile.arrayBuffer());
  const backBuffer = backFile
    ? Buffer.from(await backFile.arrayBuffer())
    : undefined;

  const localImageQuality = combineImageQualityChecks([
    inspectImageQuality(frontBuffer, frontFile.size),
    ...(backBuffer && backFile ? [inspectImageQuality(backBuffer, backFile.size)] : []),
  ]);

  const extraction = await extractWithOpenAI({
    englishName,
    countryHint,
    documentTypeHint,
    frontFile,
    backFile,
    frontBuffer,
    backBuffer,
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
      cleanedExtraction.document_number_confidence,
      cleanedExtraction.date_of_birth_confidence,
      cleanedExtraction.date_of_expiry_confidence,
      cleanedExtraction.nationality_confidence,
      gender.gender
        ? gender.gender_confidence
        : cleanedExtraction.gender_confidence > 0
          ? 0.35
          : undefined,
    ]),
  );

  const manualReviewRequired =
    nameMatch.result === "manual_review" ||
    documentQualityConfidence < 0.55;

  return {
    user_input_english_name: englishName,
    country_detected: cleanedExtraction.country_detected || countryHint.trim(),
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
    document_number: cleanedExtraction.document_number,
    document_number_confidence: cleanedExtraction.document_number_confidence,
    date_of_birth: cleanedExtraction.date_of_birth,
    date_of_birth_confidence: cleanedExtraction.date_of_birth_confidence,
    date_of_expiry: cleanedExtraction.date_of_expiry,
    date_of_expiry_confidence: cleanedExtraction.date_of_expiry_confidence,
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
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
}: VerifyIdInput) {
  if (!englishName.trim()) {
    throw new VerificationError(
      400,
      "Enter the user's English full name.",
      "English name is required.",
    );
  }

  if (!documentTypeHint.trim()) {
    throw new VerificationError(
      400,
      "Select the document type.",
      "Document type is required.",
    );
  }

  if (!countryHint.trim()) {
    throw new VerificationError(
      400,
      "Select the issued country.",
      "Issued country is required.",
    );
  }

  validateImageFile(frontFile, "front");

  if (backFile) {
    validateImageFile(backFile, "back");
  }
}

function validateImageFile(file: File, side: "front" | "back") {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new VerificationError(
      400,
      `${capitalize(side)} image must be JPG, PNG, WEBP, or HEIC.`,
      `Unsupported ${side} file type: ${file.type}`,
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new VerificationError(
      400,
      `${capitalize(side)} image is too large. Use a file up to 8MB.`,
      `${capitalize(side)} file too large: ${file.size}`,
    );
  }
}

async function extractWithOpenAI({
  englishName,
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
  frontBuffer,
  backBuffer,
}: VerifyIdInput & { frontBuffer: Buffer; backBuffer?: Buffer }) {
  const client = getOpenAIClient();
  const modelCandidates = getModelCandidates();
  const inputContent = [
    {
      type: "input_text" as const,
      text: buildUserPrompt({
        englishName,
        countryHint,
        documentTypeHint,
        hasBackImage: Boolean(backFile && backBuffer),
      }),
    },
    {
      type: "input_image" as const,
      image_url: `data:${frontFile.type};base64,${frontBuffer.toString("base64")}`,
      detail: "high" as const,
    },
    ...(backFile && backBuffer
      ? [
          {
            type: "input_image" as const,
            image_url: `data:${backFile.type};base64,${backBuffer.toString("base64")}`,
            detail: "high" as const,
          },
        ]
      : []),
  ];

  let lastError: unknown;

  for (const model of modelCandidates) {
    try {
      const response = await client.responses.parse({
        model,
        max_output_tokens: 1800,
        input: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: inputContent,
          },
        ],
        text: {
          format: zodTextFormat(openAiExtractionSchema, "id_document_verification"),
        },
      });

      if (!response.output_parsed) {
        throw new VerificationError(
          502,
          "OpenAI returned a response but it could not be parsed into the expected result shape.",
          "OpenAI returned no parsed output.",
        );
      }

      return response.output_parsed;
    } catch (error) {
      lastError = error;

      if (!isRetriableModelError(error)) {
        break;
      }
    }
  }

  throw mapOpenAIError(lastError, modelCandidates);
}

function buildUserPrompt({
  englishName,
  countryHint,
  documentTypeHint,
  hasBackImage,
}: Omit<VerifyIdInput, "frontFile" | "backFile"> & { hasBackImage: boolean }) {
  return [
    `User entered English full name: ${englishName.trim()}`,
    `Issued country: ${countryHint.trim()}`,
    `Document type: ${documentTypeHint.trim()}`,
    "Analyze the ID images and extract the required fields.",
    "The first uploaded image is the front side.",
    hasBackImage
      ? "A second uploaded image is provided for the back side."
      : "No back-side image is provided.",
    "Keep unknown strings as empty strings and unknown arrays as empty arrays.",
    "Do not set manual_review_required to true only because optional fields are absent on the document.",
    "Return the document number when visible. If unreadable, return an empty string.",
    "Return the date of expiry when visible and normalize it to YYYY-MM-DD.",
    "Provide a primary romanized full name and any credible alternatives.",
    "Do not infer gender without visible OCR label/value evidence.",
  ].join("\n");
}

function sanitizeExtraction(extraction: OpenAiExtraction, englishName: string) {
  const normalizedDate = normalizeDateValue(extraction.date_of_birth);
  const normalizedExpiry = normalizeDateValue(extraction.date_of_expiry);

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
    document_number: cleanText(extraction.document_number),
    document_number_confidence: clampConfidence(extraction.document_number_confidence),
    date_of_birth: normalizedDate,
    date_of_birth_confidence: normalizedDate
      ? clampConfidence(extraction.date_of_birth_confidence)
      : clampConfidence(Math.min(extraction.date_of_birth_confidence, 0.35)),
    date_of_expiry: normalizedExpiry,
    date_of_expiry_confidence: normalizedExpiry
      ? clampConfidence(extraction.date_of_expiry_confidence)
      : clampConfidence(Math.min(extraction.date_of_expiry_confidence, 0.35)),
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

function combineImageQualityChecks(
  checks: Array<{ confidence: number; notes: string[]; warnings: string[] }>,
) {
  return {
    confidence: averageConfidence(checks.map((check) => check.confidence)),
    notes: uniqueStrings(checks.flatMap((check) => check.notes)),
    warnings: uniqueStrings(checks.flatMap((check) => check.warnings)),
  };
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

function mapOpenAIError(error: unknown, attemptedModels: string[]) {
  if (error instanceof VerificationError) {
    return error;
  }

  if (!(error instanceof Error)) {
    return new VerificationError(
      502,
      "An unknown OpenAI error occurred while analyzing the ID images.",
      "Unknown OpenAI error.",
    );
  }

  const openAiError = error as OpenAIStyleError;
  const status = openAiError.status ?? 0;
  const code = String(openAiError.code ?? "").trim();
  const type = String(openAiError.type ?? "").trim();
  const message = error.message.toLowerCase();
  const attemptedModelSummary = attemptedModels.join(", ");

  if (message.includes("openai_api_key")) {
    return new VerificationError(
      500,
      "The server is missing OPENAI_API_KEY. Check .env.local or your deployment environment variables.",
      error.message,
    );
  }

  if (
    status === 401 ||
    code === "invalid_api_key" ||
    code === "incorrect_api_key_provided" ||
    type === "authentication_error" ||
    message.includes("invalid api key") ||
    message.includes("incorrect api key") ||
    message.includes("authentication")
  ) {
    return new VerificationError(
      401,
      `The OpenAI API key is invalid or expired. Check the configured key.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status === 429 &&
    (code === "insufficient_quota" ||
      code === "billing_hard_limit_reached" ||
      message.includes("quota") ||
      message.includes("billing"))
  ) {
    return new VerificationError(
      429,
      `OpenAI quota or billing is insufficient. Check OpenAI Billing and Usage.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (status === 429) {
    return new VerificationError(
      429,
      `OpenAI rate limits were exceeded. Please try again later.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status === 403 ||
    code === "permission_denied" ||
    message.includes("does not have access") ||
    message.includes("permission") ||
    message.includes("not allowed")
  ) {
    return new VerificationError(
      403,
      `The configured OpenAI account cannot access the required model. Attempted models: ${attemptedModelSummary}.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status === 404 ||
    code === "model_not_found" ||
    (message.includes("model") && message.includes("not found"))
  ) {
    return new VerificationError(
      404,
      `The requested OpenAI model was not found. Check OPENAI_MODEL or model access. Attempted models: ${attemptedModelSummary}.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status === 400 &&
    (code.includes("image") ||
      message.includes("image") ||
      message.includes("unsupported file") ||
      message.includes("invalid image") ||
      message.includes("input_image"))
  ) {
    return new VerificationError(
      400,
      `The uploaded image format or image data could not be processed. Try a different image.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status === 400 &&
    (message.includes("content policy") ||
      code === "content_policy_violation")
  ) {
    return new VerificationError(
      400,
      `The OpenAI request was blocked by content policy.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status === 400 &&
    (message.includes("max_output_tokens") ||
      message.includes("response_format") ||
      message.includes("schema") ||
      message.includes("json"))
  ) {
    return new VerificationError(
      500,
      `The server's OpenAI request configuration is invalid and needs to be fixed.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (
    status >= 500 ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network")
  ) {
    return new VerificationError(
      502,
      `OpenAI is temporarily unavailable or unstable. Please try again later.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  return new VerificationError(
    status >= 400 && status < 600 ? status : 502,
    `OpenAI failed while analyzing the ID images. Check the request settings and uploaded files.${formatDetailSuffix(
      status,
      code,
    )}`,
    error.message,
  );
}

function formatDetailSuffix(status: number, code: string) {
  const details: string[] = [];

  if (status) {
    details.push(`status ${status}`);
  }

  if (code) {
    details.push(`code ${code}`);
  }

  return details.length ? ` (${details.join(", ")})` : "";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
