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
  file: File;
}

const SYSTEM_PROMPT = `You are an identity document analyzer.
You receive a user-entered English full name plus one ID image, plus the user-selected document type and issuing country.
Return only JSON that matches the provided schema.

Rules:
- Do not invent invisible values.
- Unknown strings must be "".
- Unknown arrays must be [].
- All confidence values must be numbers between 0 and 1.
- country_detected should use ISO 3166-1 alpha-2 when confident, otherwise "".
- date_of_birth must be normalized to YYYY-MM-DD when confident, otherwise "".
- date_of_expiry must be normalized to YYYY-MM-DD when confident, otherwise "".
- Keep the original local-script names separate from romanized names.
- Provide one primary romanized full name plus alternative romanizations when more than one is plausible.
- If name order is ambiguous, explain it in romanization_notes.
- Gender may only be returned when a printed gender/sex label and value are visible or strongly supported by OCR evidence.
- Never infer gender from face, name, or document number patterns.
- Use the document type and issuing country as strong hints when they are consistent with the image.
- If the document is blurry, cropped, reflective, tilted, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.`;

export async function verifyIdDocument({
  englishName,
  countryHint,
  documentTypeHint,
  file,
}: VerifyIdInput): Promise<VerificationResult> {
  validateInputs({ englishName, countryHint, documentTypeHint, file });

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
    cleanedExtraction.manual_review_required ||
    nameMatch.result === "manual_review" ||
    documentQualityConfidence < 0.55 ||
    !cleanedExtraction.romanization_primary_full_name ||
    !cleanedExtraction.first_name ||
    !cleanedExtraction.last_name ||
    warnings.length > 0;

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
  file,
}: VerifyIdInput) {
  if (!englishName.trim()) {
    throw new VerificationError(
      400,
      "영문 이름을 먼저 입력해주세요.",
      "English name is required.",
    );
  }

  if (!documentTypeHint.trim()) {
    throw new VerificationError(
      400,
      "문서 타입을 선택해주세요.",
      "Document type is required.",
    );
  }

  if (!countryHint.trim()) {
    throw new VerificationError(
      400,
      "발급 국가를 입력해주세요.",
      "Issued country is required.",
    );
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new VerificationError(
      400,
      "JPG, PNG, WEBP, HEIC 형식의 이미지 파일만 업로드할 수 있습니다.",
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
        max_output_tokens: 1800,
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
        throw new VerificationError(
          502,
          "OpenAI가 응답은 반환했지만 결과를 구조화해서 읽지 못했습니다. 잠시 후 다시 시도해주세요.",
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
}: Omit<VerifyIdInput, "file">) {
  return [
    `User entered English full name: ${englishName.trim()}`,
    `Issued country: ${countryHint.trim()}`,
    `Document type: ${documentTypeHint.trim()}`,
    "Analyze the document image and extract the required fields.",
    "Keep unknown strings as empty strings and unknown arrays as empty arrays.",
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
      "신분증 이미지를 분석하는 중 알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
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
      "서버에 OpenAI API 키가 설정되지 않았습니다. `.env.local` 또는 Vercel 환경 변수를 확인해주세요.",
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
      `OpenAI API 키가 올바르지 않거나 만료되었습니다. 키 값을 다시 확인해주세요.${formatDetailSuffix(
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
      `OpenAI 크레딧 또는 결제 한도가 부족합니다. OpenAI Billing/Usage를 확인해주세요.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (status === 429) {
    return new VerificationError(
      429,
      `OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.${formatDetailSuffix(
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
      `현재 OpenAI 계정에서 필요한 모델에 접근할 수 없습니다. 모델 권한 또는 프로젝트 설정을 확인해주세요. 시도한 모델: ${attemptedModelSummary}.${formatDetailSuffix(
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
      `요청한 OpenAI 모델을 찾을 수 없습니다. \`OPENAI_MODEL\` 설정 또는 계정에서 사용 가능한 모델을 확인해주세요. 시도한 모델: ${attemptedModelSummary}.${formatDetailSuffix(
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
      `업로드한 이미지 형식 또는 이미지 데이터에 문제가 있어 분석하지 못했습니다. 다른 이미지로 다시 시도해주세요.${formatDetailSuffix(
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
      `OpenAI 정책 검사에 의해 요청이 차단되었습니다.${formatDetailSuffix(
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
      `서버의 OpenAI 요청 설정에 문제가 있습니다. 관리자 확인이 필요합니다.${formatDetailSuffix(
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
      `OpenAI 서버 응답이 일시적으로 불안정합니다. 잠시 후 다시 시도해주세요.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  return new VerificationError(
    status >= 400 && status < 600 ? status : 502,
    `신분증 이미지를 분석하는 중 OpenAI 요청이 실패했습니다. 설정 또는 입력 이미지를 다시 확인해주세요.${formatDetailSuffix(
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
