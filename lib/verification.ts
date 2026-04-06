import { zodTextFormat } from "openai/helpers/zod";

import { averageConfidence, clampConfidence } from "@/lib/confidence";
import { resolveGenderExtraction } from "@/lib/gender-extraction";
import { inspectImageQuality } from "@/lib/image-quality";
import { lookupJapanPostalCode } from "@/lib/japan-post";
import { matchRomanizedName } from "@/lib/name-matcher";
import { normalizeLooseText, uniqueNameList } from "@/lib/name-normalizer";
import { getModelCandidates, getOpenAIClient } from "@/lib/openai";
import {
  type OpenAiPoiExtraction,
  type OpenAiPorExtraction,
  openAiPoiExtractionSchema,
  openAiPorExtractionSchema,
} from "@/lib/openai-schema";
import type {
  PoiVerificationResult,
  PorVerificationResult,
} from "@/types/verification";

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

interface VerifyPoiInput {
  englishName: string;
  countryHint: string;
  documentTypeHint: string;
  frontFile: File;
  backFile?: File;
}

interface VerifyPorInput {
  countryHint: string;
  documentTypeHint: string;
  documentFile: File;
}

const POI_SYSTEM_PROMPT = `You are an identity document analyzer for POI (Proof of Identity).
You receive a user-entered English full name plus the front image of an ID and sometimes the back image, plus the user-selected document type and issuing country.
Return only JSON that matches the provided schema.

Rules:
- Do not invent invisible values.
- Unknown strings must be "".
- Unknown arrays must be [].
- All confidence values must be numbers between 0 and 1.
- Keep manual_review_required false when optional fields are simply absent on the document.
- Only set manual_review_required to true when image quality or core name evidence is too weak for reliable verification.
- issued_country should be a country name consistent with the document and user hint when confident, otherwise "".
- date_of_birth must be normalized to YYYY-MM-DD when confident, otherwise "".
- date_of_expiry must be normalized to YYYY-MM-DD when confident, otherwise "".
- Keep standardized values separate from the local OCR values.
- local_full_name should preserve the original local-script full name when visible.
- Provide one primary romanized full name plus alternative romanizations when more than one is plausible.
- If name order is ambiguous, explain it in romanization_notes.
- Gender may only be returned when a printed gender/sex label and value are visible or strongly supported by OCR evidence.
- Never infer gender from face, name, or document number patterns.
- The first image is always the front side. When a second image is provided, treat it as the back side of the same document.
- Use the back side for fields that may only appear there, but do not invent fields if neither side shows them.
- If the document is blurry, cropped, reflective, tilted, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.`;

const POR_SYSTEM_PROMPT = `You are a document analyzer for POR (Proof of Residence).
You receive one residence-proof document image plus the user-selected document type and issuing country.
Return only JSON that matches the provided schema.

Rules:
- Do not invent invisible values.
- Unknown strings must be "".
- Unknown arrays must be [].
- All confidence values must be numbers between 0 and 1.
- Keep standardized values separate from local OCR values.
- issued_country should be a country name consistent with the document and user hint when confident, otherwise "".
- document_type should be a short English label.
- date_of_expiry must be normalized to YYYY-MM-DD when confident, otherwise "".
- postal_code must only be returned when it is explicitly visible on the document. Never infer or guess it from the address.
- local_full_address should preserve the original OCR address string when visible.
- address_notes should explain any segmentation ambiguity.
- For Japanese addresses:
  - country should be JAPAN.
  - state should be prefecture only.
  - city should contain the city/ward/district level. If both city and ward appear, include both in city.
  - address_1 should contain town or neighborhood only, without block/building/room.
  - address_2 should contain numbers, building names, and room numbers.
  - Standardized country/state/city/address_1/address_2 should be returned in uppercase Latin characters when possible.
- Only set manual_review_required to true when image quality or address/document evidence is too weak for reliable verification.
- If the document is blurry, cropped, reflective, tilted, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.`;

export async function verifyPoiDocument({
  englishName,
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
}: VerifyPoiInput): Promise<PoiVerificationResult> {
  validatePoiInputs({
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

  const extraction = await extractPoiWithOpenAI({
    englishName,
    countryHint,
    documentTypeHint,
    frontFile,
    backFile,
    frontBuffer,
    backBuffer,
  });

  const cleaned = sanitizePoiExtraction(extraction, englishName);
  const gender = resolveGenderExtraction({
    countryDetected: cleaned.issued_country,
    gender: cleaned.gender,
    genderConfidence: cleaned.gender_confidence,
    genderSource: cleaned.gender_source,
    genderEvidence: cleaned.gender_evidence,
    genderNotes: cleaned.gender_notes,
  });

  const documentQualityConfidence = mergeDocumentQualityConfidence(
    cleaned.document_quality_confidence,
    localImageQuality.confidence,
    localImageQuality.notes.length > 0,
  );

  const nameEvidenceConfidence = averageConfidence([
    cleaned.first_name_confidence,
    cleaned.last_name_confidence,
    cleaned.middle_name ? cleaned.middle_name_confidence : undefined,
    cleaned.overall_confidence,
    documentQualityConfidence,
  ]);

  const nameMatch = matchRomanizedName({
    userInput: englishName,
    primaryRomanization: cleaned.romanization_primary_full_name,
    alternativeRomanizations: cleaned.romanization_alternatives,
    firstName: cleaned.first_name,
    middleName: cleaned.middle_name,
    lastName: cleaned.last_name,
    evidenceConfidence: nameEvidenceConfidence,
    documentQualityConfidence,
    romanizationNotes: [cleaned.romanization_notes, cleaned.document_quality_notes]
      .filter(Boolean)
      .join(" "),
  });

  const warnings = uniqueStrings([
    ...cleaned.warnings,
    ...localImageQuality.warnings,
    ...buildPoiWarnings(cleaned, {
      documentQualityConfidence,
      genderWasHeldBack: !gender.gender,
      nameMatchReason: nameMatch.reason,
    }),
  ]);

  const overallConfidence = clampConfidence(
    averageConfidence([
      cleaned.overall_confidence,
      documentQualityConfidence,
      nameMatch.confidence,
      cleaned.document_type_confidence,
      cleaned.issued_country_confidence,
      cleaned.document_number_confidence,
      cleaned.date_of_expiry_confidence,
      cleaned.first_name_confidence,
      cleaned.last_name_confidence,
      cleaned.date_of_birth_confidence,
      cleaned.place_of_birth_confidence,
      cleaned.nationality_confidence,
    ]),
  );

  return {
    kind: "poi",
    user_input_english_name: englishName.trim(),
    document_type: cleaned.document_type || documentTypeHint.trim(),
    local_document_type: cleaned.local_document_type,
    document_type_confidence: cleaned.document_type_confidence,
    document_number: cleaned.document_number,
    local_document_number: cleaned.local_document_number,
    document_number_confidence: cleaned.document_number_confidence,
    issued_country: cleaned.issued_country || countryHint.trim(),
    local_issued_country: cleaned.local_issued_country,
    issued_country_confidence: cleaned.issued_country_confidence,
    date_of_expiry: cleaned.date_of_expiry,
    local_date_of_expiry: cleaned.local_date_of_expiry,
    date_of_expiry_confidence: cleaned.date_of_expiry_confidence,
    document_quality_confidence: documentQualityConfidence,
    document_quality_notes:
      uniqueStrings([cleaned.document_quality_notes, ...localImageQuality.notes]).join(
        " ",
      ) || "No additional image-quality issues were detected by the local heuristic.",
    first_name: cleaned.first_name,
    local_first_name: cleaned.local_first_name,
    first_name_confidence: cleaned.first_name_confidence,
    local_first_name_confidence: cleaned.local_first_name_confidence,
    last_name: cleaned.last_name,
    local_last_name: cleaned.local_last_name,
    last_name_confidence: cleaned.last_name_confidence,
    local_last_name_confidence: cleaned.local_last_name_confidence,
    middle_name: cleaned.middle_name,
    local_middle_name: cleaned.local_middle_name,
    middle_name_confidence: cleaned.middle_name_confidence,
    local_middle_name_confidence: cleaned.local_middle_name_confidence,
    local_full_name: cleaned.local_full_name,
    local_full_name_confidence: cleaned.local_full_name_confidence,
    gender: gender.gender,
    local_gender: cleaned.local_gender,
    gender_confidence: gender.gender_confidence,
    gender_source: gender.gender_source,
    gender_evidence: gender.gender_evidence,
    gender_notes: gender.gender_notes,
    date_of_birth: cleaned.date_of_birth,
    local_date_of_birth: cleaned.local_date_of_birth,
    date_of_birth_confidence: cleaned.date_of_birth_confidence,
    place_of_birth: cleaned.place_of_birth,
    local_place_of_birth: cleaned.local_place_of_birth,
    place_of_birth_confidence: cleaned.place_of_birth_confidence,
    nationality: cleaned.nationality,
    local_nationality: cleaned.local_nationality,
    nationality_confidence: cleaned.nationality_confidence,
    romanization_primary_full_name: cleaned.romanization_primary_full_name,
    romanization_alternatives: cleaned.romanization_alternatives,
    romanization_notes: cleaned.romanization_notes,
    name_match_result: nameMatch.result,
    name_match_confidence: nameMatch.confidence,
    name_match_reason: nameMatch.reason,
    overall_confidence: overallConfidence,
    manual_review_required:
      nameMatch.result === "manual_review" || documentQualityConfidence < 0.55,
    warnings,
  };
}

export async function verifyPorDocument({
  countryHint,
  documentTypeHint,
  documentFile,
}: VerifyPorInput): Promise<PorVerificationResult> {
  validatePorInputs({ countryHint, documentTypeHint, documentFile });

  const buffer = Buffer.from(await documentFile.arrayBuffer());
  const localImageQuality = inspectImageQuality(buffer, documentFile.size);
  const extraction = await extractPorWithOpenAI({
    countryHint,
    documentTypeHint,
    documentFile,
    buffer,
  });

  const cleaned = sanitizePorExtraction(extraction);
  const documentQualityConfidence = mergeDocumentQualityConfidence(
    cleaned.document_quality_confidence,
    localImageQuality.confidence,
    localImageQuality.notes.length > 0,
  );

  const postalLookup =
    !cleaned.postal_code || cleaned.postal_code_confidence < 0.55
      ? await lookupJapanPostalCode({
          issuedCountry: cleaned.issued_country || countryHint.trim(),
          country: cleaned.country,
          localCountry: cleaned.local_country,
          localState: cleaned.local_state,
          localCity: cleaned.local_city,
          localAddress1: cleaned.local_address_1,
          localAddress2: cleaned.local_address_2,
        })
      : { postalCode: "", confidence: 0, source: "none" as const };

  const finalPostalCode = cleaned.postal_code || postalLookup.postalCode;
  const finalPostalCodeConfidence = cleaned.postal_code
    ? cleaned.postal_code_confidence
    : postalLookup.postalCode
      ? postalLookup.confidence
      : cleaned.postal_code_confidence;

  const warnings = uniqueStrings([
    ...cleaned.warnings,
    ...localImageQuality.warnings,
    ...buildPorWarnings(cleaned, {
      documentQualityConfidence,
      postalLookupWarning: postalLookup.warning ?? "",
      hasPostalCode: Boolean(finalPostalCode),
    }),
  ]);

  const overallConfidence = clampConfidence(
    averageConfidence([
      cleaned.overall_confidence,
      documentQualityConfidence,
      cleaned.document_type_confidence,
      cleaned.issued_country_confidence,
      cleaned.document_number_confidence,
      cleaned.date_of_expiry_confidence,
      cleaned.country_confidence,
      cleaned.state_confidence,
      cleaned.city_confidence,
      cleaned.address_1_confidence,
      cleaned.address_2_confidence,
      finalPostalCodeConfidence,
    ]),
  );

  return {
    kind: "por",
    document_type: cleaned.document_type || documentTypeHint.trim(),
    local_document_type: cleaned.local_document_type,
    document_type_confidence: cleaned.document_type_confidence,
    document_number: cleaned.document_number,
    local_document_number: cleaned.local_document_number,
    document_number_confidence: cleaned.document_number_confidence,
    issued_country: cleaned.issued_country || countryHint.trim(),
    local_issued_country: cleaned.local_issued_country,
    issued_country_confidence: cleaned.issued_country_confidence,
    date_of_expiry: cleaned.date_of_expiry,
    local_date_of_expiry: cleaned.local_date_of_expiry,
    date_of_expiry_confidence: cleaned.date_of_expiry_confidence,
    document_quality_confidence: documentQualityConfidence,
    document_quality_notes:
      uniqueStrings([cleaned.document_quality_notes, ...localImageQuality.notes]).join(
        " ",
      ) || "No additional image-quality issues were detected by the local heuristic.",
    country: cleaned.country,
    local_country: cleaned.local_country,
    country_confidence: cleaned.country_confidence,
    state: cleaned.state,
    local_state: cleaned.local_state,
    state_confidence: cleaned.state_confidence,
    city: cleaned.city,
    local_city: cleaned.local_city,
    city_confidence: cleaned.city_confidence,
    address_1: cleaned.address_1,
    local_address_1: cleaned.local_address_1,
    address_1_confidence: cleaned.address_1_confidence,
    address_2: cleaned.address_2,
    local_address_2: cleaned.local_address_2,
    address_2_confidence: cleaned.address_2_confidence,
    postal_code: finalPostalCode,
    local_postal_code: cleaned.local_postal_code,
    postal_code_confidence: finalPostalCodeConfidence,
    postal_code_source: cleaned.postal_code ? "ocr" : postalLookup.source,
    local_full_address: cleaned.local_full_address,
    local_full_address_confidence: cleaned.local_full_address_confidence,
    address_notes: cleaned.address_notes,
    overall_confidence: overallConfidence,
    manual_review_required:
      cleaned.manual_review_required ||
      documentQualityConfidence < 0.55 ||
      !cleaned.country ||
      !cleaned.state ||
      !cleaned.city ||
      !cleaned.address_1,
    warnings,
  };
}

function validatePoiInputs({
  englishName,
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
}: VerifyPoiInput) {
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

function validatePorInputs({
  countryHint,
  documentTypeHint,
  documentFile,
}: VerifyPorInput) {
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

  validateImageFile(documentFile, "document");
}

function validateImageFile(file: File, side: "front" | "back" | "document") {
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

async function extractPoiWithOpenAI({
  englishName,
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
  frontBuffer,
  backBuffer,
}: VerifyPoiInput & { frontBuffer: Buffer; backBuffer?: Buffer }) {
  const userPrompt = [
    `User entered English full name: ${englishName.trim()}`,
    `Issued country: ${countryHint.trim()}`,
    `Document type: ${documentTypeHint.trim()}`,
    "Analyze the POI document images and extract the requested fields.",
    "The first uploaded image is the front side.",
    backFile && backBuffer
      ? "A second uploaded image is provided for the back side."
      : "No back-side image is provided.",
    "Return local OCR text separately whenever it exists.",
    "Do not infer gender without visible OCR label/value evidence.",
  ].join("\n");

  const inputContent = [
    { type: "input_text" as const, text: userPrompt },
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

  return executeOpenAiParse({
    schemaName: "poi_document_verification",
    inputContent,
    systemPrompt: POI_SYSTEM_PROMPT,
    schema: openAiPoiExtractionSchema,
  }) as Promise<OpenAiPoiExtraction>;
}

async function extractPorWithOpenAI({
  countryHint,
  documentTypeHint,
  documentFile,
  buffer,
}: VerifyPorInput & { buffer: Buffer }) {
  const userPrompt = [
    `Issued country: ${countryHint.trim()}`,
    `Document type: ${documentTypeHint.trim()}`,
    "Analyze the POR document image and extract the requested fields.",
    "Return local OCR text separately whenever it exists.",
    "Do not guess postal_code from the address. Leave it blank unless it is explicitly visible.",
  ].join("\n");

  const inputContent = [
    { type: "input_text" as const, text: userPrompt },
    {
      type: "input_image" as const,
      image_url: `data:${documentFile.type};base64,${buffer.toString("base64")}`,
      detail: "high" as const,
    },
  ];

  return executeOpenAiParse({
    schemaName: "por_document_verification",
    inputContent,
    systemPrompt: POR_SYSTEM_PROMPT,
    schema: openAiPorExtractionSchema,
  }) as Promise<OpenAiPorExtraction>;
}

async function executeOpenAiParse({
  schemaName,
  inputContent,
  systemPrompt,
  schema,
}: {
  schemaName: string;
  inputContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  >;
  systemPrompt: string;
  schema:
    | typeof openAiPoiExtractionSchema
    | typeof openAiPorExtractionSchema;
}) {
  const client = getOpenAIClient();
  const modelCandidates = getModelCandidates();
  let lastError: unknown;

  for (const model of modelCandidates) {
    try {
      const response = await client.responses.parse({
        model,
        max_output_tokens: 2200,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: inputContent },
        ],
        text: {
          format: zodTextFormat(schema, schemaName),
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

function sanitizePoiExtraction(extraction: OpenAiPoiExtraction, englishName: string) {
  const normalizedDateOfBirth = normalizeDateValue(extraction.date_of_birth);
  const normalizedDateOfExpiry = normalizeDateValue(extraction.date_of_expiry);

  return {
    document_type: cleanText(extraction.document_type),
    local_document_type: cleanText(extraction.local_document_type),
    document_type_confidence: clampConfidence(extraction.document_type_confidence),
    document_number: cleanText(extraction.document_number),
    local_document_number: cleanText(extraction.local_document_number),
    document_number_confidence: clampConfidence(extraction.document_number_confidence),
    issued_country: cleanText(extraction.issued_country),
    local_issued_country: cleanText(extraction.local_issued_country),
    issued_country_confidence: clampConfidence(extraction.issued_country_confidence),
    date_of_expiry: normalizedDateOfExpiry,
    local_date_of_expiry: cleanText(extraction.local_date_of_expiry),
    date_of_expiry_confidence: normalizedDateOfExpiry
      ? clampConfidence(extraction.date_of_expiry_confidence)
      : clampConfidence(Math.min(extraction.date_of_expiry_confidence, 0.35)),
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
    local_middle_name_confidence: clampConfidence(extraction.local_middle_name_confidence),
    local_full_name: cleanText(extraction.local_full_name),
    local_full_name_confidence: clampConfidence(extraction.local_full_name_confidence),
    gender: extraction.gender,
    local_gender: cleanText(extraction.local_gender),
    gender_confidence: clampConfidence(extraction.gender_confidence),
    gender_source: extraction.gender_source,
    gender_evidence: cleanText(extraction.gender_evidence),
    gender_notes: cleanText(extraction.gender_notes),
    date_of_birth: normalizedDateOfBirth,
    local_date_of_birth: cleanText(extraction.local_date_of_birth),
    date_of_birth_confidence: normalizedDateOfBirth
      ? clampConfidence(extraction.date_of_birth_confidence)
      : clampConfidence(Math.min(extraction.date_of_birth_confidence, 0.35)),
    place_of_birth: cleanText(extraction.place_of_birth),
    local_place_of_birth: cleanText(extraction.local_place_of_birth),
    place_of_birth_confidence: clampConfidence(extraction.place_of_birth_confidence),
    nationality: cleanText(extraction.nationality),
    local_nationality: cleanText(extraction.local_nationality),
    nationality_confidence: clampConfidence(extraction.nationality_confidence),
    romanization_primary_full_name: cleanText(extraction.romanization_primary_full_name),
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

function sanitizePorExtraction(extraction: OpenAiPorExtraction) {
  const normalizedDateOfExpiry = normalizeDateValue(extraction.date_of_expiry);
  const normalizedPostalCode = normalizePostalCode(extraction.postal_code);

  return {
    document_type: cleanText(extraction.document_type),
    local_document_type: cleanText(extraction.local_document_type),
    document_type_confidence: clampConfidence(extraction.document_type_confidence),
    document_number: cleanText(extraction.document_number),
    local_document_number: cleanText(extraction.local_document_number),
    document_number_confidence: clampConfidence(extraction.document_number_confidence),
    issued_country: cleanText(extraction.issued_country),
    local_issued_country: cleanText(extraction.local_issued_country),
    issued_country_confidence: clampConfidence(extraction.issued_country_confidence),
    date_of_expiry: normalizedDateOfExpiry,
    local_date_of_expiry: cleanText(extraction.local_date_of_expiry),
    date_of_expiry_confidence: normalizedDateOfExpiry
      ? clampConfidence(extraction.date_of_expiry_confidence)
      : clampConfidence(Math.min(extraction.date_of_expiry_confidence, 0.35)),
    document_quality_confidence: clampConfidence(extraction.document_quality_confidence),
    document_quality_notes: cleanText(extraction.document_quality_notes),
    country: cleanUppercaseText(extraction.country),
    local_country: cleanText(extraction.local_country),
    country_confidence: clampConfidence(extraction.country_confidence),
    state: cleanUppercaseText(extraction.state),
    local_state: cleanText(extraction.local_state),
    state_confidence: clampConfidence(extraction.state_confidence),
    city: cleanUppercaseText(extraction.city),
    local_city: cleanText(extraction.local_city),
    city_confidence: clampConfidence(extraction.city_confidence),
    address_1: cleanUppercaseText(extraction.address_1),
    local_address_1: cleanText(extraction.local_address_1),
    address_1_confidence: clampConfidence(extraction.address_1_confidence),
    address_2: cleanUppercaseText(extraction.address_2),
    local_address_2: cleanText(extraction.local_address_2),
    address_2_confidence: clampConfidence(extraction.address_2_confidence),
    postal_code: normalizedPostalCode,
    local_postal_code: cleanText(extraction.local_postal_code),
    postal_code_confidence: normalizedPostalCode
      ? clampConfidence(extraction.postal_code_confidence)
      : clampConfidence(Math.min(extraction.postal_code_confidence, 0.35)),
    local_full_address: cleanText(extraction.local_full_address),
    local_full_address_confidence: clampConfidence(extraction.local_full_address_confidence),
    address_notes: cleanText(extraction.address_notes),
    overall_confidence: clampConfidence(extraction.overall_confidence),
    manual_review_required: extraction.manual_review_required,
    warnings: uniqueStrings(extraction.warnings.map((warning) => cleanText(warning))),
  };
}

function buildPoiWarnings(
  extraction: ReturnType<typeof sanitizePoiExtraction>,
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

function buildPorWarnings(
  extraction: ReturnType<typeof sanitizePorExtraction>,
  {
    documentQualityConfidence,
    postalLookupWarning,
    hasPostalCode,
  }: {
    documentQualityConfidence: number;
    postalLookupWarning: string;
    hasPostalCode: boolean;
  },
) {
  const warnings: string[] = [];

  if (documentQualityConfidence < 0.55) {
    warnings.push("Image quality is low; manual review is recommended.");
  }

  if (!extraction.country || !extraction.state || !extraction.city || !extraction.address_1) {
    warnings.push("Core address fields could not be segmented confidently.");
  }

  if (!hasPostalCode) {
    warnings.push("Postal code could not be confirmed from OCR or lookup.");
  }

  if (postalLookupWarning) {
    warnings.push(postalLookupWarning);
  }

  return warnings;
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

function cleanUppercaseText(value: string) {
  const cleaned = cleanText(value);
  return /[a-z]/i.test(cleaned) ? cleaned.toUpperCase() : cleaned;
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

function normalizePostalCode(value: string) {
  const digits = cleanText(value).replace(/\D/g, "");

  if (digits.length !== 7) {
    return "";
  }

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
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

function mergeDocumentQualityConfidence(
  extractedConfidence: number,
  localConfidence: number,
  hasLocalNotes: boolean,
) {
  return clampConfidence(
    Math.min(
      extractedConfidence * 0.75 + localConfidence * 0.25,
      hasLocalNotes ? localConfidence + 0.08 : extractedConfidence,
    ),
  );
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
      "An unknown OpenAI error occurred while analyzing the document.",
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
    (message.includes("content policy") || code === "content_policy_violation")
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
    `OpenAI failed while analyzing the document. Check the request settings and uploaded files.${formatDetailSuffix(
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
