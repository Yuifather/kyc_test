import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import { averageConfidence, clampConfidence } from "@/lib/confidence";
import { resolveGenderExtraction } from "@/lib/gender-extraction";
import { inspectImageQuality } from "@/lib/image-quality";
import { lookupJapanPostalCode } from "@/lib/japan-post";
import { matchRomanizedName } from "@/lib/name-matcher";
import { normalizeLooseText, uniqueNameList } from "@/lib/name-normalizer";
import { getModelCandidates, getOpenAIClient } from "@/lib/openai";
import {
  type OpenAiDocumentNumberRescueExtraction,
  type OpenAiPoiExtraction,
  type OpenAiPorExtraction,
  openAiDocumentNumberRescueSchema,
  openAiPoiExtractionSchema,
  openAiPorExtractionSchema,
} from "@/lib/openai-schema";
import type {
  DocumentIntegrityStatus,
  MatchResult,
  PoiVerificationResult,
  PorVerificationResult,
  ReviewStatus,
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

function isJapaneseCountryHint(value: string) {
  const normalized = normalizeLooseText(value);
  return ["japan", "jp", "日本", "일본", "nihon", "nippon"].includes(normalized);
}

function buildPoiSystemPrompt(
  countryHint: string,
  mode: "default" | "name_rescue" | "document_number_rescue",
) {
  const sections = [GLOBAL_POI_SYSTEM_PROMPT];

  if (isJapaneseCountryHint(countryHint)) {
    sections.push(JAPANESE_POI_SYSTEM_PROMPT);
  }

  if (mode === "name_rescue") {
    sections.push(
      "Name rescue mode: focus on the front-side name fields only and produce conservative romanization alternatives when the reading is ambiguous.",
    );
  }

  if (mode === "document_number_rescue") {
    sections.push(
      "Document-number rescue mode: focus on the explicit document number only. Prefer the document-type-specific side and ignore unrelated serials, phone numbers, postal codes, dates, barcodes, and decorative numbers.",
    );
  }

  return sections.join("\n\n");
}

function buildPorSystemPrompt(
  countryHint: string,
  mode: "default" | "address_rescue" | "document_number_rescue",
) {
  const sections = [GLOBAL_POR_SYSTEM_PROMPT];

  if (isJapaneseCountryHint(countryHint)) {
    sections.push(JAPANESE_POR_SYSTEM_PROMPT);
  }

  if (mode === "address_rescue") {
    sections.push(
      "Address rescue mode: focus on the recipient residence address, recover the best split for state, city, address_1, address_2, and postal_code, and ignore sender or issuer addresses.",
    );
  }

  if (mode === "document_number_rescue") {
    sections.push(
      "Document-number rescue mode: focus only on the explicit account, customer, reference, contract, or document number field. Do not use phone numbers, postal codes, dates, amounts, barcode payloads, or address digits as document_number.",
    );
  }

  return sections.join("\n\n");
}

interface VerifyPoiInput {
  englishName: string;
  countryHint: string;
  documentTypeHint: string;
  frontFile: File;
  backFile?: File;
}

interface VerifyPorInput {
  englishName: string;
  countryHint: string;
  documentTypeHint: string;
  documentFile: File;
}

const GLOBAL_POI_SYSTEM_PROMPT = `You are an identity document analyzer for POI (Proof of Identity).
You receive the front image of an ID and sometimes the back image, plus the user-selected document type and issuing country.
Return only JSON that matches the provided schema.

Rules:
- Do not invent invisible values.
- Unknown strings must be "".
- Unknown arrays must be [].
- All confidence values must be numbers between 0 and 1.
- Keep manual_review_required false when optional fields are simply absent on the document.
- Only set manual_review_required to true when image quality or core name evidence is too weak for reliable verification.
- Assess document integrity separately from OCR quality.
- document_integrity_status must be one of clean, suspected, or tampered.
- Use tampered only when there are clear signs of editing, compositing, text replacement, cut-and-paste, or other fabrication artifacts.
- Use suspected when the document shows mild or unclear signs of manipulation but not enough evidence to call it tampered.
- Do not mark a document tampered merely because the required name is missing, hidden, covered, cropped, or unreadable.
- Do not mark a document tampered merely because optional fields are hidden, blank, or obscured.
- Treat screenshots, screen captures, digitally generated mockups, photo-edit composites, printed-and-rephotographed copies, and other non-camera captures of the physical document as tampered.
- Only treat a genuine camera photo of the physical document as clean. If the image is clearly a scan, screenshot, screen capture, printed copy, or digital composite, mark it tampered even when the text is readable.
- If you cannot clearly tell that the image is a real camera photo of a physical document, do not mark it clean. Prefer suspected or tampered.
- A clean white-background card graphic, layout mockup, synthetic render, or neatly composited ID image is not a clean camera photo. Mark it suspected or tampered unless it clearly shows real-world camera capture cues from a physical card.
- If the image is rotated, skewed, or partially cropped but otherwise looks genuine, keep document_integrity_status clean unless there are separate edit artifacts.
- Write document_integrity_notes in Korean when the status is suspected or tampered.
- first_name, last_name, middle_name, document_type, issued_country, nationality, and place_of_birth must be standardized values.
- first_name, last_name, and middle_name must be written in Latin script when visible and romanizable. Never put kanji, kana, hangul, hanzi, or other local script into these standardized fields.
- issued_country should be a country name consistent with the document and user hint when confident, otherwise "".
- date_of_birth must be normalized to YYYY-MM-DD when confident, otherwise "".
- date_of_expiry must be normalized to YYYY-MM-DD when confident, otherwise "".
- Keep standardized values separate from the local OCR values.
- local_full_name should preserve the original local-script full name when visible.
- local_first_name, local_last_name, local_middle_name, and local_full_name must keep the original OCR script exactly when visible.
- Provide one primary romanized full name plus alternative romanizations when more than one is plausible.
- Also provide field-specific candidate arrays for first_name_romanization_candidates, middle_name_romanization_candidates, and last_name_romanization_candidates when a local-script name can be romanized.
- Each field-specific candidate array should contain plausible Latin-script spellings for that exact name part. The application uses these candidates to score name consistency.
- If name order is ambiguous, explain it in romanization_notes.
- Write explanatory text fields such as document_quality_notes, gender_notes, romanization_notes, and warnings in Korean.
- Keep normalized data values such as document_type, issued_country, romanized names, and dates in their required output format.
- Gender may only be returned when a printed gender/sex label and value are visible or strongly supported by OCR evidence.
- Never infer gender from face, name, or document number patterns.
- The user-entered English name is only for comparison. Never copy or adapt it into first_name, last_name, middle_name, or romanization fields unless the document evidence independently supports the same spelling.
- The first image is always the front side. When a second image is provided, treat it as the back side of the same document.
- The front side is required and must contain the person's name.
- Extract person-name fields from the front side only.
- If the front side does not show a readable person name, leave first_name, last_name, middle_name, and local_full_name blank.
- Use the back side only for supplementary non-name fields that may appear there.
- For Japanese driver's licenses, the document number is typically on the front side.
- For Japanese My Number Cards / Individual Number Cards, the document number is typically on the back side.
- For Japanese My Number Cards / Individual Number Cards, document_number means the 12-digit 個人番号. Search the back side carefully and prefer the 12-digit number shown in grouped boxes.
- Never output placeholder, example, or stereotyped names. If the actual name is unclear, leave the name fields blank instead of inventing a common name.
- If the document is blurry, cropped, reflective, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.
- Do not lower document_quality_confidence only because the image is rotated sideways if the text is still readable.`;

const JAPANESE_POI_SYSTEM_PROMPT = `Japanese POI-specific rules:
- For Japanese identity documents, read the personal name only from the field labeled \u6c0f\u540d on the front side.
- For Japanese driver's licenses and ID cards, do not use text from the \u4f4f\u6240 field or any address block for name fields.
- For Japanese driver's licenses, the document number is usually on the front side.
- For Japanese My Number Cards / Individual Number Cards, the document number is usually on the back side.
- For Japanese My Number Cards / Individual Number Cards, document_number means the 12-digit 個人番号 on the back side. Ignore short front-side serials, certificate dates, municipality lines, and auxiliary numbers.
- If the image is rotated or the name field is vertical, mentally rotate it and read the \u6c0f\u540d field before extracting names.
- If a Japanese local-script name is visible as surname followed by given name, keep that exact local order in local_full_name and split local_last_name/local_first_name accordingly.
- For Japanese documents, local_issued_country should be \u65e5\u672c when the issuing country is Japan. Do not put a prefecture into local_issued_country.
- If a Japanese kanji name has no explicit reading, generate multiple plausible Latin readings in romanization_alternatives from the document evidence and common Japanese name conventions.
- For Japanese names, also populate first_name_romanization_candidates, middle_name_romanization_candidates, and last_name_romanization_candidates with the best plausible readings for each corresponding field.
- These field-specific candidate arrays should include single-field readings such as MIYAGAWA for 宮川 and KATSU / CHIKARA / RIKI / TSUTOMU when the character 力 is ambiguous.
- Do not rely on a fixed lookup table in application code. The application compares the candidates you provide.
- If multiple readings are plausible, keep the primary reading conservative and place the rest in romanization_alternatives.
- Never collapse an ambiguous kanji name into a single reading when a better set of candidates is available.
- Write romanization_notes in Korean and mention when the reading is ambiguous.`;

const GLOBAL_POR_SYSTEM_PROMPT = `You are a document analyzer for POR (Proof of Residence).
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
- If a recipient/addressee name is visible, extract first_name, last_name, middle_name, local_first_name, local_last_name, local_middle_name, local_full_name, romanization_primary_full_name, romanization_alternatives, and the field-specific romanization candidate arrays using the same POI-style rules.
- Keep standardized name fields in Latin script and local name fields in the original OCR script.
- Never use sender, issuer, office, or footer names for the recipient name fields.
- address_notes should explain any segmentation ambiguity.
- Write explanatory text fields such as document_quality_notes, address_notes, and warnings in Korean.
- Assess document integrity separately from OCR quality.
- document_integrity_status must be one of clean, suspected, or tampered.
- Use tampered only when there are clear signs of editing, compositing, text replacement, cut-and-paste, or other fabrication artifacts.
- Use suspected when the document shows mild or unclear signs of manipulation but not enough evidence to call it tampered.
- Do not mark a document tampered merely because the recipient address is missing, hidden, covered, cropped, or unreadable.
- Do not mark a document tampered merely because sender, issuer, office, footer, contact, or return-address fields are hidden, blank, or obscured.
- Treat screenshots, screen captures, digitally generated mockups, photo-edit composites, printed-and-rephotographed copies, and other non-camera captures of the physical document as tampered.
- A clean synthetic layout, flat digital bill render, or neatly composited page that does not look like a camera photo of paper should not be marked clean.
- If the image is rotated, skewed, or partially cropped but otherwise looks genuine, keep document_integrity_status clean unless there are separate edit artifacts.
- If you cannot clearly tell that the image is a real camera photo of a physical document, do not mark it clean. Prefer suspected or tampered.
- Write document_integrity_notes in Korean when the status is suspected or tampered.
- Keep normalized data values such as document_type, issued_country, country/state/city/address fields, and dates in their required output format.
- When multiple addresses are visible, always choose the recipient/addressee residence address for POR.
- Ignore sender, issuer, office, branch, footer, contact, or return addresses unless they are clearly the recipient address.
- On mailed notices, bills, giro slips, or utility documents, prefer the address block directly associated with the recipient name, often located above the recipient name and honorific.
- On mailed notices, bills, giro slips, and utility documents, select the recipient/addressee block that contains the recipient name and recipient residence address. Ignore issuer headquarters, remittance instructions, payment tables, and company contact blocks.
- local_full_address must contain only the selected recipient/addressee address block, not a concatenation of recipient and sender addresses.
- document_number may appear elsewhere on the page, outside the recipient block. Search the full document for an explicit number label or dedicated number field, and never force document_number to come from the recipient address block.
- On utility bills or giro slips, document_number must come from an explicit customer/account/reference field. Never use a phone number, postal code, date, amount, barcode payload, or issuer contact number as document_number.
- Only set manual_review_required to true when image quality or address/document evidence is too weak for reliable verification.
- If the document is blurry, cropped, reflective, occluded, or too small, lower document_quality_confidence and explain it in document_quality_notes.
- Do not lower document_quality_confidence only because the image is rotated sideways if the text is still readable.`;

const JAPANESE_POR_SYSTEM_PROMPT = `Japanese POR-specific rules:
- For Japanese addresses:
  - country should be JAPAN.
  - state should be prefecture only.
  - city should contain the city/ward/district level. If both city and ward appear, include both in city.
  - address_1 should contain the recipient-side local area below city level and before the numeric block/building/room. It may include sub-municipal area names such as HACHIMAN-CHO MIYAMA or OAZA SANNAI when that is the clearest recipient address split.
  - address_2 should contain numbers, building names, and room numbers.
  - Standardized country/state/city/address_1/address_2 should be returned in uppercase Latin characters when possible.
  - Example: "501-4452 郡上市八幡町美山2455番地1" for the addressee should be split as country JAPAN, state GIFU, city GUJO-SHI, address_1 HACHIMAN-CHO MIYAMA, address_2 2455-1, postal_code 501-4452.
  - Example: "上益城郡益城町安永529" should be split as country JAPAN, state KUMAMOTO, city KAMIMASHIKI-GUN, address_1 MASHIKI-MACHI, address_2 YASUNAGA 529, postal_code 861-2231.
  - Example: "青森県青森市大字三内字沢部426番地17" should be split as country JAPAN, state AOMORI-KEN, city AOMORI-SHI, address_1 OAZA SANNAI, address_2 AZA SAWABE 426-17, postal_code 038-0031.
  - When the local recipient address is "郡上市八幡町美山2455番地1", local_city must be "郡上市" and local_address_1 must be "八幡町美山". Do not split it as "郡" plus "上市八幡町美山".
- When the local recipient address contains 大字 and 字, split them across address_1 and address_2 instead of mixing them into city.
- Keep state as prefecture with suffixes such as -KEN, -TO, -DO, or -FU when appropriate.
- Keep city as city/ward/district with suffixes such as -SHI, -KU, or -GUN when appropriate.
- If a recipient name is visible on a Japanese POR document, extract it with the same field rules as POI: standardized fields in Latin script, local fields in the original OCR script, and candidate romanizations for comparison.
- For Japanese giro slips, utility notices, and bills, the recipient/addressee name and residence address come from the recipient block, while document_number may be elsewhere on the page. Search the full page for an explicit number label or dedicated field and do not limit document_number to the recipient block.
- For Japanese utility bills, giro slips, statements, and mailed notices, the recipient block usually contains the postal code, recipient address, recipient name, and honorific. Prefer that block over issuer tables and payment summaries.
- For Japanese identity documents used as POR, such as My Number cards, residence cards, driver's licenses, and residence certificates, extract the address strictly from the field labeled 住所 or its immediate address line.
- The application will use postal-code lookup when postal_code is not visible, so do not invent postal codes.`;

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

  let cleaned = normalizePoiDocumentNumberForType(sanitizePoiExtraction(extraction), {
    countryHint,
    documentTypeHint,
  });

  if (
    shouldRunJapanesePoiNameRescue({
      countryHint,
      documentTypeHint,
      issuedCountry: cleaned.issued_country,
      localIssuedCountry: cleaned.local_issued_country,
      firstName: cleaned.first_name,
      firstNameConfidence: cleaned.first_name_confidence,
      localFirstName: cleaned.local_first_name,
      localFirstNameConfidence: cleaned.local_first_name_confidence,
      lastName: cleaned.last_name,
      lastNameConfidence: cleaned.last_name_confidence,
      localLastName: cleaned.local_last_name,
      localLastNameConfidence: cleaned.local_last_name_confidence,
      localFullName: cleaned.local_full_name,
      localFullNameConfidence: cleaned.local_full_name_confidence,
      romanizationPrimaryFullName: cleaned.romanization_primary_full_name,
    })
  ) {
    const nameRescueExtraction = await extractPoiWithOpenAI({
      englishName,
      countryHint,
      documentTypeHint,
      frontFile,
      frontBuffer,
      mode: "name_rescue",
    });
    const nameRescueCleaned = normalizePoiDocumentNumberForType(
      sanitizePoiExtraction(nameRescueExtraction),
      {
        countryHint,
        documentTypeHint,
      },
    );

    if (hasPoiNameEvidence(nameRescueCleaned)) {
      cleaned = mergePoiNameExtraction(cleaned, nameRescueCleaned);
    }
  }

  if (
    shouldRunPoiDocumentNumberRescue({
      countryHint,
      documentTypeHint,
      detectedDocumentType: cleaned.document_type,
      localDocumentType: cleaned.local_document_type,
      backProvided: Boolean(backFile && backBuffer),
      documentNumber: cleaned.document_number,
      localDocumentNumber: cleaned.local_document_number,
      documentNumberConfidence: cleaned.document_number_confidence,
    })
  ) {
    const documentNumberRescueExtraction = await extractPoiDocumentNumberWithOpenAI({
      englishName,
      countryHint,
      documentTypeHint,
      frontFile,
      backFile,
      frontBuffer,
      backBuffer,
    });
    const documentNumberRescueCleaned = normalizePoiDocumentNumberRescueExtraction(
      documentNumberRescueExtraction,
      { countryHint, documentTypeHint },
    );

    if (isBetterPoiDocumentNumberExtraction(cleaned, documentNumberRescueCleaned)) {
      cleaned = mergePoiDocumentNumberExtraction(cleaned, documentNumberRescueCleaned);
    }
  }

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
      documentIntegrityStatus: cleaned.document_integrity_status,
      documentIntegrityNotes: cleaned.document_integrity_notes,
      documentQualityConfidence,
      nameMatchRequiresReview: nameMatch.result === "manual_review",
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
      cleaned.first_name_confidence,
      cleaned.last_name_confidence,
      cleaned.date_of_birth_confidence,
      cleaned.place_of_birth_confidence,
      cleaned.nationality_confidence,
    ]),
  );
  const manualReviewRequired =
    nameMatch.result === "manual_review" ||
    documentQualityConfidence < 0.55 ||
    cleaned.document_integrity_status !== "clean";
  const reviewStatus = derivePoiReviewStatusV2({
    manualReviewRequired,
    documentIntegrityStatus: cleaned.document_integrity_status,
    nameMatchResult: nameMatch.result,
    nameMatchConfidence: nameMatch.confidence,
    firstName: cleaned.first_name,
    firstNameConfidence: cleaned.first_name_confidence,
    localFirstNameConfidence: cleaned.local_first_name_confidence,
    lastName: cleaned.last_name,
    lastNameConfidence: cleaned.last_name_confidence,
    localLastNameConfidence: cleaned.local_last_name_confidence,
    localFirstName: cleaned.local_first_name,
    localLastName: cleaned.local_last_name,
    localFullName: cleaned.local_full_name,
    localFullNameConfidence: cleaned.local_full_name_confidence,
  });

  const result = {
    kind: "poi" as const,
    review_status: reviewStatus,
    user_input_english_name: englishName.trim(),
    document_type: cleaned.document_type || documentTypeHint.trim(),
    local_document_type: cleaned.local_document_type,
    document_type_confidence: cleaned.document_type_confidence,
    document_number: cleaned.document_number,
    local_document_number: cleaned.local_document_number,
    document_number_confidence: cleaned.document_number_confidence,
    document_integrity_status: cleaned.document_integrity_status,
    document_integrity_notes: cleaned.document_integrity_notes,
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
      ) || "로컬 품질 점검 기준에서 추가 이미지 품질 이슈는 감지되지 않았습니다.",
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
    first_name_romanization_candidates: cleaned.first_name_romanization_candidates,
    middle_name_romanization_candidates: cleaned.middle_name_romanization_candidates,
    last_name_romanization_candidates: cleaned.last_name_romanization_candidates,
    name_match_result: nameMatch.result,
    name_match_confidence: nameMatch.confidence,
    name_match_reason: nameMatch.reason,
    overall_confidence: overallConfidence,
    manual_review_required: manualReviewRequired,
    warnings,
  };

  return result;
}

export async function verifyPorDocument({
  englishName,
  countryHint,
  documentTypeHint,
  documentFile,
}: VerifyPorInput): Promise<PorVerificationResult> {
  validatePorInputs({ englishName, countryHint, documentTypeHint, documentFile });

  const buffer = Buffer.from(await documentFile.arrayBuffer());
  const localImageQuality = inspectImageQuality(buffer, documentFile.size);
  const extraction = await extractPorWithOpenAI({
    englishName,
    countryHint,
    documentTypeHint,
    documentFile,
    buffer,
  });
  let cleaned = normalizePorDocumentNumberForType(sanitizePorExtraction(extraction), {
    countryHint,
    documentTypeHint,
  });

  if (shouldRetryPorAddressExtraction(cleaned, { countryHint, documentTypeHint })) {
    const retryExtraction = await extractPorWithOpenAI({
      englishName,
      countryHint,
      documentTypeHint,
      documentFile,
      buffer,
      mode: "address_rescue",
    });
    const retryCleaned = normalizePorDocumentNumberForType(
      sanitizePorExtraction(retryExtraction),
      {
        countryHint,
        documentTypeHint,
      },
    );
    const [currentAddressScore, retryAddressScore] = await Promise.all([
      scorePorAddressCandidate(cleaned, { countryHint, documentTypeHint }),
      scorePorAddressCandidate(retryCleaned, { countryHint, documentTypeHint }),
    ]);

    if (retryAddressScore > currentAddressScore) {
      cleaned = retryCleaned;
    }
  }

  if (
    shouldRunPorDocumentNumberRescue(cleaned, {
      countryHint,
      documentTypeHint,
    })
  ) {
    const documentNumberRescueExtraction = await extractPorDocumentNumberWithOpenAI({
      englishName,
      countryHint,
      documentTypeHint,
      documentFile,
      buffer,
    });
    const documentNumberRescueCleaned = normalizePorDocumentNumberRescueExtraction(
      documentNumberRescueExtraction,
      { countryHint, documentTypeHint },
    );

    if (
      isBetterPorDocumentNumberExtraction(cleaned, documentNumberRescueCleaned, {
        countryHint,
        documentTypeHint,
      })
    ) {
      cleaned = mergePorDocumentNumberExtraction(cleaned, documentNumberRescueCleaned);
    }
  }

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
      documentIntegrityStatus: cleaned.document_integrity_status,
      documentIntegrityNotes: cleaned.document_integrity_notes,
      documentQualityConfidence,
      postalLookupWarning: postalLookup.warning ?? "",
      hasPostalCode: Boolean(finalPostalCode),
      nameMatchRequiresReview:
        nameMatch.result === "manual_review" ||
        nameMatch.result === "possible_match" ||
        nameMatch.result === "mismatch" ||
        nameMatch.confidence < 0.78 ||
        hasLowConfidencePresentField(
          [
            { value: cleaned.first_name || cleaned.local_first_name, confidence: cleaned.first_name_confidence || cleaned.local_first_name_confidence },
            { value: cleaned.last_name || cleaned.local_last_name, confidence: cleaned.last_name_confidence || cleaned.local_last_name_confidence },
            { value: cleaned.middle_name || cleaned.local_middle_name, confidence: cleaned.middle_name_confidence || cleaned.local_middle_name_confidence },
          ],
          0.55,
        ),
      hasVisibleNameEvidence: Boolean(
        cleaned.local_full_name ||
          cleaned.local_first_name ||
          cleaned.local_last_name ||
          cleaned.first_name ||
          cleaned.last_name,
      ),
    }),
    ...(nameMatch.result === "manual_review" ||
    nameMatch.result === "possible_match" ||
    nameMatch.result === "mismatch" ||
    nameMatch.confidence < 0.78
      ? [nameMatch.reason]
      : []),
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
      cleaned.postal_code ? finalPostalCodeConfidence : 0,
      cleaned.first_name_confidence,
      cleaned.last_name_confidence,
      cleaned.middle_name_confidence,
    ]),
  );
  const manualReviewRequired =
    cleaned.manual_review_required ||
    documentQualityConfidence < 0.55 ||
    cleaned.document_integrity_status !== "clean" ||
    !cleaned.country ||
    !cleaned.state ||
    !cleaned.city ||
    !cleaned.address_1 ||
    nameMatch.result === "manual_review" ||
    nameMatch.result === "possible_match" ||
    nameMatch.result === "mismatch" ||
    nameMatch.confidence < 0.78 ||
    hasLowConfidencePresentField(
      [
        { value: cleaned.first_name || cleaned.local_first_name, confidence: cleaned.first_name_confidence || cleaned.local_first_name_confidence },
        { value: cleaned.last_name || cleaned.local_last_name, confidence: cleaned.last_name_confidence || cleaned.local_last_name_confidence },
        { value: cleaned.middle_name || cleaned.local_middle_name, confidence: cleaned.middle_name_confidence || cleaned.local_middle_name_confidence },
      ],
      0.55,
    );
  const reviewStatus = derivePorReviewStatus({
    manualReviewRequired,
    documentIntegrityStatus: cleaned.document_integrity_status,
    country: cleaned.country,
    countryConfidence: cleaned.country_confidence,
    localCountry: cleaned.local_country,
    state: cleaned.state,
    stateConfidence: cleaned.state_confidence,
    localState: cleaned.local_state,
    city: cleaned.city,
    cityConfidence: cleaned.city_confidence,
    localCity: cleaned.local_city,
    address1: cleaned.address_1,
    address1Confidence: cleaned.address_1_confidence,
    localAddress1: cleaned.local_address_1,
    address2: cleaned.address_2,
    address2Confidence: cleaned.address_2_confidence,
    localAddress2: cleaned.local_address_2,
    postalCode: finalPostalCode,
    postalCodeConfidence: finalPostalCodeConfidence,
    localFullAddress: cleaned.local_full_address,
    postalCodeSource: cleaned.postal_code ? "ocr" : postalLookup.source,
    nameMatchResult: nameMatch.result,
    nameMatchConfidence: nameMatch.confidence,
    firstName: cleaned.first_name,
    localFirstName: cleaned.local_first_name,
    firstNameConfidence: cleaned.first_name_confidence,
    localFirstNameConfidence: cleaned.local_first_name_confidence,
    lastName: cleaned.last_name,
    localLastName: cleaned.local_last_name,
    lastNameConfidence: cleaned.last_name_confidence,
    localLastNameConfidence: cleaned.local_last_name_confidence,
    middleName: cleaned.middle_name,
    localMiddleName: cleaned.local_middle_name,
    middleNameConfidence: cleaned.middle_name_confidence,
    localMiddleNameConfidence: cleaned.local_middle_name_confidence,
    localFullName: cleaned.local_full_name,
    localFullNameConfidence: cleaned.local_full_name_confidence,
  });

  return {
    kind: "por",
    review_status: reviewStatus,
    user_input_english_name: englishName.trim(),
    document_type: cleaned.document_type || documentTypeHint.trim(),
    local_document_type: cleaned.local_document_type,
    document_type_confidence: cleaned.document_type_confidence,
    document_number: cleaned.document_number,
    local_document_number: cleaned.local_document_number,
    document_number_confidence: cleaned.document_number_confidence,
    document_integrity_status: cleaned.document_integrity_status,
    document_integrity_notes: cleaned.document_integrity_notes,
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
      ) || "로컬 품질 점검 기준에서 추가 이미지 품질 이슈는 감지되지 않았습니다.",
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
    romanization_primary_full_name: cleaned.romanization_primary_full_name,
    romanization_alternatives: cleaned.romanization_alternatives,
    romanization_notes: cleaned.romanization_notes,
    first_name_romanization_candidates: cleaned.first_name_romanization_candidates,
    middle_name_romanization_candidates: cleaned.middle_name_romanization_candidates,
    last_name_romanization_candidates: cleaned.last_name_romanization_candidates,
    name_match_result: nameMatch.result,
    name_match_confidence: nameMatch.confidence,
    name_match_reason: nameMatch.reason,
    overall_confidence: overallConfidence,
    manual_review_required: manualReviewRequired,
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
      "고객 영문 성명을 입력해주세요.",
      "English name is required.",
    );
  }

  if (!documentTypeHint.trim()) {
    throw new VerificationError(
      400,
      "Document type을 선택해주세요.",
      "Document type is required.",
    );
  }

  if (!countryHint.trim()) {
    throw new VerificationError(
      400,
      "Issued country를 선택해주세요.",
      "Issued country is required.",
    );
  }

  validateImageFile(frontFile, "front");

  if (backFile) {
    validateImageFile(backFile, "back");
  }
}

function validatePorInputs({
  englishName,
  countryHint,
  documentTypeHint,
  documentFile,
}: VerifyPorInput) {
  if (!englishName.trim()) {
    throw new VerificationError(
      400,
      "POR 영문 성명을 입력해주세요.",
      "English name is required.",
    );
  }

  if (!documentTypeHint.trim()) {
    throw new VerificationError(
      400,
      "Document type을 선택해주세요.",
      "Document type is required.",
    );
  }

  if (!countryHint.trim()) {
    throw new VerificationError(
      400,
      "Issued country를 선택해주세요.",
      "Issued country is required.",
    );
  }

  validateImageFile(documentFile, "document");
}

function validateImageFile(file: File, side: "front" | "back" | "document") {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new VerificationError(
      400,
      `${capitalize(side)} 이미지 형식은 JPG, PNG, WEBP, HEIC만 가능합니다.`,
      `Unsupported ${side} file type: ${file.type}`,
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new VerificationError(
      400,
      `${capitalize(side)} 이미지는 최대 8MB까지 업로드할 수 있습니다.`,
      `${capitalize(side)} file too large: ${file.size}`,
    );
  }
}

async function extractPoiWithOpenAI({
  englishName: _englishName,
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
  frontBuffer,
  backBuffer,
  mode = "default",
}: VerifyPoiInput & {
  frontBuffer: Buffer;
  backBuffer?: Buffer;
  mode?: "default" | "name_rescue" | "document_number_rescue";
}) {
  void _englishName;
  const typeFingerprint = buildDocumentTypeFingerprint(documentTypeHint);
  const isJapaneseIndividualNumberRescue =
    mode === "document_number_rescue" &&
    backFile &&
    backBuffer &&
    isJapaneseCountryHint(countryHint) &&
    isJapaneseIndividualNumberCardType(typeFingerprint);
  const isJapaneseDriversLicenseRescue =
    mode === "document_number_rescue" &&
    isJapaneseCountryHint(countryHint) &&
    isJapaneseDriversLicenseType(typeFingerprint);
  const userPromptLines = [
    `Issued country: ${countryHint.trim()}`,
    `Document type: ${documentTypeHint.trim()}`,
    "Analyze the POI document images and extract the requested fields.",
    "The image must be a genuine camera photo of a physical document. If it is a screenshot, scan, screen capture, printed copy, rephoto of a printout, or digital composite, mark document_integrity_status tampered even when the text is readable.",
    "If you cannot clearly tell that the image is a real camera photo of a physical document, do not mark it clean.",
    "The first uploaded image is the front side.",
    "Also assess whether the document looks clean, suspected, or tampered. Do not treat missing or hidden non-required fields as tampering.",
    backFile && backBuffer
      ? "A second uploaded image is provided for the back side."
      : "No back-side image is provided.",
    "The front side must contain the person's name. If the front image does not show a readable name, leave the name fields blank.",
    "If the required name is missing or unreadable but there are no other edit artifacts, leave document_integrity_status clean and let the app handle the missing required field.",
    "Do not use the back side to populate first_name, last_name, middle_name, or local_full_name.",
    "Return local OCR text separately whenever it exists.",
    "For Japanese driver's licenses, document_number is usually on the front side.",
    "For Japanese My Number Cards / Individual Number Cards, document_number is usually on the back side.",
    "Use the document-type-appropriate side when extracting document_number.",
    "first_name, last_name, and middle_name must be standardized English or Latin-script values, not the original local script.",
    "The server compares the extracted name with the user's input later. Do not use any external or assumed English spelling to fill extracted name fields.",
    "Do not infer gender without visible OCR label/value evidence.",
  ];

  if (mode === "name_rescue") {
    userPromptLines.push(
      "Ignore address, issuer, dates, class, organ-donation notes, and all non-name text unless needed only to orient the card.",
      "On Japanese driver's licenses and ID cards, the name is in the front-side field labeled \u6c0f\u540d. Read that field before any nearby vertical text.",
      "Never copy \u4f4f\u6240 or any place name into local_first_name, local_last_name, or local_full_name.",
      "Never output placeholder or example names. If the actual name is unreadable, leave every name field blank.",
    );
  }

  if (mode === "document_number_rescue") {
    userPromptLines.push(
      "This retry is focused only on document_number.",
      "Inspect every uploaded image, but prefer the document-type-appropriate side for document_number.",
      "For Japanese driver's licenses, prioritize the front-side number field.",
      "For Japanese My Number Cards / Individual Number Cards, prioritize the back-side 12-digit 個人番号 and ignore short serials or auxiliary numbers.",
      "For Japanese My Number Cards / Individual Number Cards, the 個人番号 is the 12-digit number shown in grouped boxes next to the label 個人番号. Read those grouped digits exactly.",
      "If one uploaded image contains multiple card views or both front/back content, inspect the full image and use the document-type-appropriate number field.",
      "Do not use dates, certificate expiry markings, postal codes, barcodes, municipality codes, or contact numbers as document_number.",
    );
  }

  const userPrompt = userPromptLines.join("\n");
  const inputContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [{ type: "input_text" as const, text: userPrompt }];

  if (isJapaneseIndividualNumberRescue && backFile && backBuffer) {
    inputContent.push({
      type: "input_image" as const,
      image_url: `data:${backFile.type};base64,${backBuffer.toString("base64")}`,
      detail: "high" as const,
    });
  } else {
    inputContent.push({
      type: "input_image" as const,
      image_url: `data:${frontFile.type};base64,${frontBuffer.toString("base64")}`,
      detail: "high" as const,
    });

    if (
      backFile &&
      backBuffer &&
      mode !== "name_rescue" &&
      !isJapaneseDriversLicenseRescue
    ) {
      inputContent.push({
        type: "input_image" as const,
        image_url: `data:${backFile.type};base64,${backBuffer.toString("base64")}`,
        detail: "high" as const,
      });
    }
  }
  return executeOpenAiParse({
    schemaName: "poi_document_verification",
    inputContent,
    systemPrompt: buildPoiSystemPrompt(countryHint, mode),
    schema: openAiPoiExtractionSchema,
    maxOutputTokens:
      mode === "document_number_rescue"
        ? 500
        : mode === "name_rescue"
          ? 900
          : 1500,
  }) as Promise<OpenAiPoiExtraction>;
}

async function extractPoiDocumentNumberWithOpenAI({
  countryHint,
  documentTypeHint,
  frontFile,
  backFile,
  frontBuffer,
  backBuffer,
}: VerifyPoiInput & {
  frontBuffer: Buffer;
  backBuffer?: Buffer;
}): Promise<OpenAiDocumentNumberRescueExtraction> {
  const typeFingerprint = buildDocumentTypeFingerprint(documentTypeHint);
  const inputContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [
    {
      type: "input_text",
      text: [
        `Issued country: ${countryHint.trim()}`,
        `Document type: ${documentTypeHint.trim()}`,
        "Focus only on the document_number field.",
        "Return only document_number, local_document_number, and document_number_confidence.",
        "Do not output any other fields.",
        "Ignore names, addresses, dates, gender, issuer, municipality codes, postal codes, phone numbers, barcodes, QR codes, certificate expiry markings, and decorative serials.",
        "The image must still be treated as a full original image; inspect the whole uploaded image and do not crop mentally to only one region.",
        isJapaneseCountryHint(countryHint) && isJapaneseIndividualNumberCardType(typeFingerprint)
          ? "For Japanese My Number Cards / Individual Number Cards, prioritize the back-side 12-digit 個人番号 shown in grouped boxes next to the label 個人番号. Read those digits exactly."
          : isJapaneseCountryHint(countryHint) && isJapaneseDriversLicenseType(typeFingerprint)
            ? "For Japanese driver's licenses, prioritize the front-side number field labeled 番号 and return that number exactly."
            : "Use only an explicit document-number field when one is visible.",
      ].join("\n"),
    },
  ];

  if (
    isJapaneseCountryHint(countryHint) &&
    isJapaneseIndividualNumberCardType(typeFingerprint) &&
    backFile &&
    backBuffer
  ) {
    inputContent.push({
      type: "input_image",
      image_url: `data:${backFile.type};base64,${backBuffer.toString("base64")}`,
      detail: "high",
    });
  } else {
    inputContent.push({
      type: "input_image",
      image_url: `data:${frontFile.type};base64,${frontBuffer.toString("base64")}`,
      detail: "high",
    });

    if (backFile && backBuffer && !isJapaneseDriversLicenseType(typeFingerprint)) {
      inputContent.push({
        type: "input_image",
        image_url: `data:${backFile.type};base64,${backBuffer.toString("base64")}`,
        detail: "high",
      });
    }
  }

  return executeOpenAiParse({
    schemaName: "poi_document_number_rescue",
    inputContent,
    systemPrompt: buildPoiSystemPrompt(countryHint, "document_number_rescue"),
    schema: openAiDocumentNumberRescueSchema,
    maxOutputTokens: 120,
  });
}

async function extractPorWithOpenAI({
  englishName: _englishName,
  countryHint,
  documentTypeHint,
  documentFile,
  buffer,
  mode = "default",
}: VerifyPorInput & {
  buffer: Buffer;
  mode?: "default" | "address_rescue" | "document_number_rescue";
}) {
  void _englishName;
  const userPromptLines = [
    `Issued country: ${countryHint.trim()}`,
    `Document type: ${documentTypeHint.trim()}`,
    "Analyze the POR document image and extract the requested fields.",
    "The image must be a genuine camera photo of a physical document. If it is a screenshot, scan, screen capture, printed copy, rephoto of a printout, or digital composite, mark document_integrity_status tampered even when the text is readable.",
    "If you cannot clearly tell that the image is a real camera photo of a physical document, do not mark it clean.",
    "Also assess whether the document looks clean, suspected, or tampered. Do not treat missing or hidden non-required fields as tampering.",
    "Return local OCR text separately whenever it exists.",
    "If a recipient or addressee name is visible, extract first_name, last_name, middle_name, local_first_name, local_last_name, local_middle_name, local_full_name, romanization_primary_full_name, romanization_alternatives, and the field-specific romanization candidate arrays using the same rules as POI.",
    "Keep standardized name fields in Latin script and local name fields in the original OCR script.",
    "Never use sender, issuer, office, branch, or footer names for the recipient name fields.",
    "The recipient/addressee name and residence address should come from the recipient block, not sender or issuer blocks.",
    "Do not guess postal_code from the address. Leave it blank unless it is explicitly visible.",
    "Document_number may appear elsewhere on the page, outside the recipient block. Search the full document for an explicit number label or dedicated number field, and never force it to come from the recipient address block.",
    "If both recipient and sender addresses are present, extract the recipient or addressee residence address only.",
    "Ignore issuer, office, footer, return, branch, or contact addresses unless they are clearly the recipient address.",
    "For mailed notices or utility slips, prefer the address block closest to the recipient name.",
    "If the required recipient address is missing or unreadable but there are no other edit artifacts, leave document_integrity_status clean and let the app handle the missing required field.",
  ];

  if (mode === "address_rescue") {
    userPromptLines.push(
      "This is a retry focused on recovering the residence address.",
      "The document may be rotated sideways. Mentally rotate it until the text is upright before reading.",
      "For Japanese residence cards, residence certificates, My Number cards, driver's licenses, and other address-bearing IDs, inspect the line labeled 住所 and its immediate address text carefully.",
      "For utility bills, giro slips, and mailed notices, identify the recipient/addressee block first. Use the recipient name and nearby recipient address block, not the issuer or billing summary.",
      "If the address is visible, return local_full_address and split it into state, city, address_1, address_2, and postal_code.",
      "Do not leave the address blank just because the image is rotated. Only leave it blank when it is genuinely unreadable.",
      "If document_type and issued_country are already clear, prioritize recovering the address fields on this retry.",
      "Document_number may still be elsewhere on the page; only extract it from an explicit label or dedicated field, not from the recipient address block.",
    );
  }

  if (mode === "document_number_rescue") {
    userPromptLines.push(
      "This is a retry focused only on document_number.",
      "Search the full document for an explicit customer/account/reference/contract/document number field.",
      "On utility bills, giro slips, statements, and mailed notices, do not use phone numbers, postal codes, dates, amounts, barcodes, QR payloads, issuer contact numbers, or recipient address digits as document_number.",
      "Only return document_number when there is a dedicated number field or an explicit label indicating that number.",
    );
  }

  const userPrompt = userPromptLines.join("\n");

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
    systemPrompt: buildPorSystemPrompt(countryHint, mode),
    schema: openAiPorExtractionSchema,
    maxOutputTokens:
      mode === "document_number_rescue"
        ? 500
        : mode === "address_rescue"
          ? 1100
          : 1500,
  }) as Promise<OpenAiPorExtraction>;
}

async function extractPorDocumentNumberWithOpenAI({
  countryHint,
  documentTypeHint,
  documentFile,
  buffer,
}: VerifyPorInput & {
  buffer: Buffer;
}): Promise<OpenAiDocumentNumberRescueExtraction> {
  const inputContent = [
    {
      type: "input_text" as const,
      text: [
        `Issued country: ${countryHint.trim()}`,
        `Document type: ${documentTypeHint.trim()}`,
        "Focus only on document_number.",
        "Return only document_number, local_document_number, and document_number_confidence.",
        "Do not output any other fields.",
        "Inspect the whole uploaded document image.",
        "Document_number may appear outside the recipient block, but it must come from an explicit number field or label.",
        "On utility bills, giro slips, statements, and mailed notices, never use phone numbers, postal codes, dates, amounts, barcode payloads, QR payloads, or recipient-address digits as document_number.",
        "Use customer/account/reference/contract/document numbers only when a dedicated label or dedicated number box clearly indicates that number.",
      ].join("\n"),
    },
    {
      type: "input_image" as const,
      image_url: `data:${documentFile.type};base64,${buffer.toString("base64")}`,
      detail: "high" as const,
    },
  ];

  return executeOpenAiParse({
    schemaName: "por_document_number_rescue",
    inputContent,
    systemPrompt: buildPorSystemPrompt(countryHint, "document_number_rescue"),
    schema: openAiDocumentNumberRescueSchema,
    maxOutputTokens: 140,
  });
}
async function executeOpenAiParse<TSchema extends z.ZodTypeAny>({
  schemaName,
  inputContent,
  systemPrompt,
  schema,
  maxOutputTokens = 1500,
}: {
  schemaName: string;
  inputContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  >;
  systemPrompt: string;
  schema: TSchema;
  maxOutputTokens?: number;
}): Promise<z.infer<TSchema>> {
  const client = getOpenAIClient();
  const modelCandidates = getModelCandidates();
  let lastError: unknown;

  for (const model of modelCandidates) {
    try {
      const response = await client.responses.parse({
        model,
        max_output_tokens: maxOutputTokens,
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
          "OpenAI 응답은 받았지만 기대한 결과 형식으로 해석하지 못했습니다.",
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

function sanitizePoiExtraction(extraction: OpenAiPoiExtraction) {
  const normalizedDateOfBirth = normalizeDateValue(extraction.date_of_birth);
  const normalizedDateOfExpiry = normalizeDateValue(extraction.date_of_expiry);
  const standardizedDocumentNumber = cleanDocumentNumberText(extraction.document_number);
  const localDocumentNumber = cleanDocumentNumberText(extraction.local_document_number);
  const finalDocumentNumber =
    standardizedDocumentNumber ||
    (looksLikeDocumentNumber(localDocumentNumber) ? localDocumentNumber : "");
  const documentNumberConfidence = deriveDocumentNumberConfidence({
    extractedConfidence: extraction.document_number_confidence,
    documentQualityConfidence: extraction.document_quality_confidence,
    standardizedValue: finalDocumentNumber,
    localValue: localDocumentNumber,
  });

  let cleaned = {
    document_type: cleanText(extraction.document_type),
    local_document_type: cleanText(extraction.local_document_type),
    document_type_confidence: clampConfidence(extraction.document_type_confidence),
    document_number: finalDocumentNumber,
    local_document_number: localDocumentNumber,
    document_number_confidence: documentNumberConfidence,
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
    document_integrity_status: normalizeDocumentIntegrityStatus(
      extraction.document_integrity_status,
    ),
    document_integrity_notes: cleanText(extraction.document_integrity_notes),
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
        .filter(Boolean),
    ),
    romanization_notes: cleanText(extraction.romanization_notes),
    first_name_romanization_candidates: uniqueNameList(
      extraction.first_name_romanization_candidates
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    middle_name_romanization_candidates: uniqueNameList(
      extraction.middle_name_romanization_candidates
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    last_name_romanization_candidates: uniqueNameList(
      extraction.last_name_romanization_candidates
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    overall_confidence: clampConfidence(extraction.overall_confidence),
    manual_review_required: extraction.manual_review_required,
    warnings: uniqueStrings(extraction.warnings.map((warning) => cleanText(warning))),
  };

  if (shouldClearInferredPoiNationality(cleaned)) {
    cleaned = {
      ...cleaned,
      nationality: "",
      local_nationality: "",
      nationality_confidence: 0,
    };
  }

  const normalized = shouldApplyJapanesePoiHeuristics(cleaned)
    ? normalizeJapanesePoiExtraction(cleaned)
    : cleaned;

  return preferOriginalLocalPoiNameScripts(normalized);
}

function sanitizePorExtraction(extraction: OpenAiPorExtraction) {
  const normalizedDateOfExpiry = normalizeDateValue(extraction.date_of_expiry);
  const localFullAddress = cleanText(extraction.local_full_address);
  const standardizedDocumentNumber = cleanDocumentNumberText(extraction.document_number);
  const localDocumentNumber = cleanDocumentNumberText(extraction.local_document_number);
  const finalDocumentNumber =
    standardizedDocumentNumber ||
    (looksLikeDocumentNumber(localDocumentNumber) ? localDocumentNumber : "");
  const documentNumberConfidence = deriveDocumentNumberConfidence({
    extractedConfidence: extraction.document_number_confidence,
    documentQualityConfidence: extraction.document_quality_confidence,
    standardizedValue: finalDocumentNumber,
    localValue: localDocumentNumber,
  });
  const visiblePostalCode =
    normalizePostalCode(extraction.postal_code) ||
    normalizePostalCode(extraction.local_postal_code) ||
    extractPostalCodeFromText(localFullAddress);
  const rebalancedJapaneseAddress = rebalanceJapanesePorLocalAddress({
    issuedCountry: cleanText(extraction.issued_country),
    country: cleanUppercaseText(extraction.country),
    localCountry: cleanText(extraction.local_country),
    localState: cleanText(extraction.local_state),
    localCity: cleanText(extraction.local_city),
    localAddress1: cleanText(extraction.local_address_1),
    localAddress2: cleanText(extraction.local_address_2),
    localFullAddress,
  });
  const localPostalCode = cleanText(extraction.local_postal_code) || visiblePostalCode;
  const postalCodeConfidence = visiblePostalCode
    ? Math.max(
        clampConfidence(extraction.postal_code_confidence),
        extraction.postal_code ? 0.7 : 0.78,
      )
    : clampConfidence(Math.min(extraction.postal_code_confidence, 0.35));
  const addressNotes = uniqueStrings(
    [
      cleanText(extraction.address_notes),
      rebalancedJapaneseAddress.note,
    ].filter(Boolean),
  ).join(" ");

  let cleaned = {
    document_type: cleanText(extraction.document_type),
    local_document_type: cleanText(extraction.local_document_type),
    document_type_confidence: clampConfidence(extraction.document_type_confidence),
    document_number: finalDocumentNumber,
    local_document_number: localDocumentNumber,
    document_number_confidence: documentNumberConfidence,
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
    document_integrity_status: normalizeDocumentIntegrityStatus(
      extraction.document_integrity_status,
    ),
    document_integrity_notes: cleanText(extraction.document_integrity_notes),
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
    romanization_primary_full_name: cleanText(extraction.romanization_primary_full_name),
    romanization_alternatives: uniqueNameList(
      extraction.romanization_alternatives
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    romanization_notes: cleanText(extraction.romanization_notes),
    first_name_romanization_candidates: uniqueNameList(
      extraction.first_name_romanization_candidates
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    middle_name_romanization_candidates: uniqueNameList(
      extraction.middle_name_romanization_candidates
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    last_name_romanization_candidates: uniqueNameList(
      extraction.last_name_romanization_candidates
        .map((value) => cleanText(value))
        .filter(Boolean),
    ),
    country: cleanUppercaseText(extraction.country),
    local_country: cleanText(extraction.local_country),
    country_confidence: clampConfidence(extraction.country_confidence),
    state: cleanUppercaseText(extraction.state),
    local_state: cleanText(extraction.local_state),
    state_confidence: clampConfidence(extraction.state_confidence),
    city: cleanUppercaseText(extraction.city),
    local_city: rebalancedJapaneseAddress.localCity,
    city_confidence: clampConfidence(extraction.city_confidence),
    address_1: cleanUppercaseText(extraction.address_1),
    local_address_1: rebalancedJapaneseAddress.localAddress1,
    address_1_confidence: clampConfidence(extraction.address_1_confidence),
    address_2: cleanUppercaseText(extraction.address_2),
    local_address_2: rebalancedJapaneseAddress.localAddress2,
    address_2_confidence: clampConfidence(extraction.address_2_confidence),
    postal_code: visiblePostalCode,
    local_postal_code: localPostalCode,
    postal_code_confidence: postalCodeConfidence,
    local_full_address: localFullAddress,
    local_full_address_confidence: clampConfidence(extraction.local_full_address_confidence),
    address_notes: addressNotes,
    overall_confidence: clampConfidence(extraction.overall_confidence),
    manual_review_required: extraction.manual_review_required,
    warnings: uniqueStrings(extraction.warnings.map((warning) => cleanText(warning))),
  };

  if (shouldApplyJapanesePoiHeuristics(cleaned)) {
    cleaned = normalizeJapanesePoiExtraction(cleaned);
  }

  return preferOriginalLocalPoiNameScripts(cleaned);
}

function rebalanceJapanesePorLocalAddress({
  issuedCountry,
  country,
  localCountry,
  localState,
  localCity,
  localAddress1,
  localAddress2,
  localFullAddress,
}: {
  issuedCountry: string;
  country: string;
  localCountry: string;
  localState: string;
  localCity: string;
  localAddress1: string;
  localAddress2: string;
  localFullAddress: string;
}) {
  if (!shouldApplyJapanesePorHeuristics({ issuedCountry, country, localCountry, localState })) {
    return {
      localCity,
      localAddress1,
      localAddress2,
      note: "",
    };
  }

  const parsed = parseJapaneseRecipientAddress({
    localState,
    localCity,
    localAddress1,
    localAddress2,
    localFullAddress,
  });
  const nextLocalCity = parsed.localCity || localCity;
  const nextLocalAddress1 = parsed.localAddress1 || localAddress1;
  const nextLocalAddress2 = parsed.localAddress2 || localAddress2;
  const changed =
    nextLocalCity !== localCity ||
    nextLocalAddress1 !== localAddress1 ||
    nextLocalAddress2 !== localAddress2;

  return {
    localCity: nextLocalCity,
    localAddress1: nextLocalAddress1,
    localAddress2: nextLocalAddress2,
    note: changed
      ? "일본 주소를 수신자 기준으로 다시 분리해 City, Address 1, Address 2를 정리했습니다."
      : "",
  };
}

function buildPoiWarnings(
  extraction: ReturnType<typeof sanitizePoiExtraction>,
  {
    documentIntegrityStatus,
    documentIntegrityNotes,
    documentQualityConfidence,
    nameMatchRequiresReview,
  }: {
    documentIntegrityStatus: DocumentIntegrityStatus;
    documentIntegrityNotes: string;
    documentQualityConfidence: number;
    nameMatchRequiresReview: boolean;
  },
) {
  const warnings: string[] = [];

  warnings.push(
    ...buildDocumentIntegrityWarnings({
      status: documentIntegrityStatus,
      notes: documentIntegrityNotes,
    }),
  );

  if (documentQualityConfidence < 0.55) {
    warnings.push("이미지 품질이 낮아 수동 검토가 권장됩니다.");
  }

  if (!extraction.romanization_primary_full_name) {
    warnings.push("이름의 영문화 표기를 확인하기 어렵습니다.");
  }

  if (nameMatchRequiresReview) {
    warnings.push("이름 정합성은 맞지만 영문화 표기가 다소 모호합니다.");
  }

  return warnings;
}

function buildPorWarnings(
  extraction: ReturnType<typeof sanitizePorExtraction>,
  {
    documentIntegrityStatus,
    documentIntegrityNotes,
    documentQualityConfidence,
    postalLookupWarning,
    hasPostalCode,
    nameMatchRequiresReview,
    hasVisibleNameEvidence,
  }: {
    documentIntegrityStatus: DocumentIntegrityStatus;
    documentIntegrityNotes: string;
    documentQualityConfidence: number;
    postalLookupWarning: string;
    hasPostalCode: boolean;
    nameMatchRequiresReview: boolean;
    hasVisibleNameEvidence: boolean;
  },
) {
  const warnings: string[] = [];

  warnings.push(
    ...buildDocumentIntegrityWarnings({
      status: documentIntegrityStatus,
      notes: documentIntegrityNotes,
    }),
  );

  if (documentQualityConfidence < 0.55) {
    warnings.push("이미지 품질이 낮아 수동 검토가 권장됩니다.");
  }

  if (!extraction.country || !extraction.state || !extraction.city || !extraction.address_1) {
    warnings.push("핵심 주소 필드를 신뢰도 있게 분리하지 못했습니다.");
  }

  if (!hasPostalCode) {
    warnings.push("OCR 또는 조회 결과로 Postal code를 확인하지 못했습니다.");
  }

  if (!hasVisibleNameEvidence) {
    warnings.push("이름 정보를 신뢰도 있게 판독하지 못했습니다.");
  }

  if (nameMatchRequiresReview) {
    warnings.push("이름 정합도 또는 로마자 판독이 모호해 수동 검토가 필요합니다.");
  }

  if (postalLookupWarning) {
    warnings.push(postalLookupWarning);
  }

  return warnings;
}

function derivePoiReviewStatusV2({
  manualReviewRequired,
  documentIntegrityStatus,
  nameMatchResult,
  nameMatchConfidence,
  firstName,
  firstNameConfidence,
  lastName,
  lastNameConfidence,
  localFirstNameConfidence,
  localLastNameConfidence,
  localFirstName,
  localLastName,
  localFullName,
  localFullNameConfidence,
}: {
  manualReviewRequired: boolean;
  documentIntegrityStatus: DocumentIntegrityStatus;
  nameMatchResult: PoiVerificationResult["name_match_result"];
  nameMatchConfidence: number;
  firstName: string;
  firstNameConfidence: number;
  lastName: string;
  lastNameConfidence: number;
  localFirstNameConfidence: number;
  localLastNameConfidence: number;
  localFirstName: string;
  localLastName: string;
  localFullName: string;
  localFullNameConfidence: number;
}): ReviewStatus {
  const hasFrontNameEvidence = Boolean(
    localFullName || (firstName && lastName) || localFirstName || localLastName,
  );
  const ocrFields = [
    { value: localFirstName || firstName, confidence: localFirstNameConfidence || firstNameConfidence },
    { value: localLastName || lastName, confidence: localLastNameConfidence || lastNameConfidence },
    { value: localFullName, confidence: localFullNameConfidence },
  ];

  if (!hasFrontNameEvidence) {
    return "불가";
  }

  if (documentIntegrityStatus === "tampered") {
    return "불가";
  }

  if (documentIntegrityStatus === "suspected") {
    return "검토";
  }

  if (
    nameMatchResult === "mismatch" ||
    nameMatchResult === "possible_match" ||
    nameMatchResult === "manual_review" ||
    nameMatchConfidence < 0.78
  ) {
    return "검토";
  }

  if (nameMatchResult === "likely_match" && nameMatchConfidence < 0.9) {
    return "검토";
  }

  if (hasLowConfidencePresentField(ocrFields, 0.55)) {
    return "검토";
  }

  if (manualReviewRequired) {
    return "검토";
  }

  return "정상";
}

function shouldRetryPorAddressExtraction(
  extraction: ReturnType<typeof sanitizePorExtraction>,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  if (!isJapaneseCountryHint(countryHint)) {
    return false;
  }

  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    extraction.document_type,
    extraction.local_document_type,
  );
  const quickScore = getPorAddressExtractionScore(extraction);
  const suspiciousAddress =
    hasSenderLikeAddressSignals(extraction) || hasWeakPorAddressEvidence(extraction);

  if (isUtilityLikeDocumentType(typeFingerprint)) {
    return quickScore < 6 || suspiciousAddress;
  }

  if (isAddressBearingIdDocumentType(typeFingerprint)) {
    return quickScore < 5 || suspiciousAddress;
  }

  return false;
}

function getPorAddressExtractionScore(extraction: ReturnType<typeof sanitizePorExtraction>) {
  const fields = [
    extraction.country,
    extraction.state,
    extraction.city,
    extraction.address_1,
    extraction.address_2,
    extraction.postal_code,
    extraction.local_full_address,
  ];

  return fields.filter(Boolean).length;
}

async function scorePorAddressCandidate(
  extraction: ReturnType<typeof sanitizePorExtraction>,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    extraction.document_type,
    extraction.local_document_type,
  );
  const fieldsScore =
    (extraction.country ? 2 : 0) +
    (extraction.state ? 3 : 0) +
    (extraction.city ? 3 : 0) +
    (extraction.address_1 ? 3 : 0) +
    (extraction.address_2 ? 1.5 : 0) +
    (extraction.local_full_address ? 4 : 0) +
    (extraction.postal_code ? 2 : 0);
  const confidenceScore =
    clampConfidence(
      averageConfidence([
        extraction.country_confidence,
        extraction.state_confidence,
        extraction.city_confidence,
        extraction.address_1_confidence,
        extraction.address_2_confidence,
        extraction.local_full_address_confidence,
        extraction.postal_code_confidence,
      ]),
    ) * 6;
  let total = fieldsScore + confidenceScore;

  if (hasSenderLikeAddressSignals(extraction)) {
    total -= isUtilityLikeDocumentType(typeFingerprint) ? 8 : 4;
  }

  if (hasWeakPorAddressEvidence(extraction)) {
    total -= 3;
  }

  if (isJapaneseCountryHint(countryHint)) {
    const lookup = await lookupJapanPostalCode({
      issuedCountry: extraction.issued_country || countryHint.trim(),
      country: extraction.country,
      localCountry: extraction.local_country,
      localState: extraction.local_state,
      localCity: extraction.local_city,
      localAddress1: extraction.local_address_1,
      localAddress2: extraction.local_address_2,
    });

    if (lookup.postalCode) {
      if (!extraction.postal_code || extraction.postal_code === lookup.postalCode) {
        total += 4;
      } else {
        total -= 2;
      }
    } else if (!extraction.postal_code && isUtilityLikeDocumentType(typeFingerprint)) {
      total -= 1.5;
    }
  }

  if (isUtilityLikeDocumentType(typeFingerprint)) {
    total += extraction.local_full_name ? 1.5 : -1;
    total += extraction.address_notes ? 0.5 : 0;
  }

  return total;
}

function derivePorReviewStatus({
  manualReviewRequired,
  documentIntegrityStatus,
  country,
  countryConfidence,
  localCountry,
  state,
  stateConfidence,
  localState,
  city,
  cityConfidence,
  localCity,
  address1,
  address1Confidence,
  localAddress1,
  address2,
  address2Confidence,
  localAddress2,
  postalCode,
  postalCodeConfidence,
  localFullAddress,
  postalCodeSource,
  nameMatchResult,
  nameMatchConfidence,
  firstName,
  firstNameConfidence,
  localFirstNameConfidence,
  lastName,
  lastNameConfidence,
  localLastNameConfidence,
  middleName,
  middleNameConfidence,
  localMiddleNameConfidence,
  localFirstName,
  localLastName,
  localMiddleName,
  localFullName,
  localFullNameConfidence,
}: {
  manualReviewRequired: boolean;
  documentIntegrityStatus: DocumentIntegrityStatus;
  country: string;
  countryConfidence: number;
  localCountry: string;
  state: string;
  stateConfidence: number;
  localState: string;
  city: string;
  cityConfidence: number;
  localCity: string;
  address1: string;
  address1Confidence: number;
  localAddress1: string;
  address2: string;
  address2Confidence: number;
  localAddress2: string;
  postalCode: string;
  postalCodeConfidence: number;
  localFullAddress: string;
  postalCodeSource: PorVerificationResult["postal_code_source"];
  nameMatchResult: MatchResult;
  nameMatchConfidence: number;
  firstName: string;
  firstNameConfidence: number;
  localFirstNameConfidence: number;
  lastName: string;
  lastNameConfidence: number;
  localLastNameConfidence: number;
  middleName: string;
  middleNameConfidence: number;
  localMiddleNameConfidence: number;
  localFirstName: string;
  localLastName: string;
  localMiddleName: string;
  localFullName: string;
  localFullNameConfidence: number;
}): ReviewStatus {
  const hasVisibleAddressEvidence = Boolean(
    localFullAddress || localCountry || localState || localCity || localAddress1 || localAddress2,
  );
  const hasCoreAddressEvidence = Boolean(country && state && city && address1);
  const hasVisibleNameEvidence = Boolean(
    localFullName || localFirstName || localLastName || localMiddleName || (firstName && lastName),
  );
  const coreFields = [
    { value: country, confidence: countryConfidence },
    { value: state, confidence: stateConfidence },
    { value: city, confidence: cityConfidence },
    { value: address1, confidence: address1Confidence },
    { value: address2, confidence: address2Confidence },
    { value: postalCode, confidence: postalCodeConfidence },
  ];
  const nameFields = [
    { value: firstName || localFirstName, confidence: firstNameConfidence || localFirstNameConfidence },
    { value: lastName || localLastName, confidence: lastNameConfidence || localLastNameConfidence },
    { value: middleName || localMiddleName, confidence: middleNameConfidence || localMiddleNameConfidence },
    { value: localFullName, confidence: localFullNameConfidence },
  ];

  if (!hasVisibleAddressEvidence) {
    return "불가";
  }

  if (documentIntegrityStatus === "tampered") {
    return "불가";
  }

  if (documentIntegrityStatus === "suspected") {
    return "검토";
  }

  if (!hasVisibleNameEvidence) {
    return "검토";
  }

  if (
    !hasCoreAddressEvidence ||
    (postalCodeSource === "none" && !postalCode) ||
    hasLowConfidencePresentField(coreFields, 0.65) ||
    hasLowConfidencePresentField(nameFields, 0.55) ||
    nameMatchResult === "manual_review" ||
    nameMatchResult === "possible_match" ||
    nameMatchResult === "mismatch" ||
    nameMatchConfidence < 0.78 ||
    (manualReviewRequired && hasLowConfidencePresentField(coreFields, 0.8))
  ) {
    return "검토";
  }

  return "정상";
}

function hasLowConfidencePresentField(
  fields: Array<{ value: string; confidence: number }>,
  threshold: number,
) {
  return fields.some(
    (field) => Boolean(field.value) && Number.isFinite(field.confidence) && field.confidence < threshold,
  );
}

function isJapaneseCountryValue(value: string) {
  return isJapaneseCountryHint(value);
}

function shouldApplyJapanesePoiHeuristics(value: {
  issued_country: string;
  local_issued_country: string;
  document_type: string;
  local_document_type: string;
}) {
  return [
    value.issued_country,
    value.local_issued_country,
    value.document_type,
    value.local_document_type,
  ].some(
    (candidate) =>
      isJapaneseCountryValue(candidate) || normalizeLooseText(candidate) === "\u65e5\u672c",
  );
}

function normalizeDocumentIntegrityStatus(value: string): DocumentIntegrityStatus {
  const normalized = normalizeLooseText(value);

  if (
    normalized === "tampered" ||
    normalized === "forged" ||
    normalized === "edited" ||
    normalized === "manipulated" ||
    normalized === "fabricated" ||
    normalized.includes("변조") ||
    normalized.includes("위조") ||
    normalized.includes("조작")
  ) {
    return "tampered";
  }

  if (
    normalized === "suspected" ||
    normalized === "uncertain" ||
    normalized === "ambiguous" ||
    normalized === "possible" ||
    normalized === "needsreview" ||
    normalized.includes("의심") ||
    normalized.includes("검토") ||
    normalized.includes("가능성")
  ) {
    return "suspected";
  }

  return "clean";
}

function buildDocumentIntegrityWarnings({
  status,
  notes,
}: {
  status: DocumentIntegrityStatus;
  notes: string;
}) {
  if (status === "clean") {
    return [];
  }

  if (status === "tampered") {
    return [notes || "문서 조작 또는 변조가 확인되어 불가입니다."];
  }

  return [notes || "문서 조작 또는 변조 가능성이 있어 수동 검토가 필요합니다."];
}

function normalizeJapanesePoiExtraction<
  T extends {
    local_issued_country: string;
    local_first_name: string;
    first_name_confidence: number;
    local_last_name: string;
    last_name_confidence: number;
    local_middle_name: string;
    middle_name_confidence: number;
    local_full_name: string;
    local_full_name_confidence: number;
  },
>(value: T) {
  const nextValue = { ...value };

  if (looksLikeJapanesePrefecture(nextValue.local_issued_country)) {
    nextValue.local_issued_country = "\u65e5\u672c";
  }

  if (looksLikeJapaneseAddressField(nextValue.local_first_name)) {
    nextValue.local_first_name = "";
    nextValue.first_name_confidence = 0;
  }

  if (looksLikeJapaneseAddressField(nextValue.local_last_name)) {
    nextValue.local_last_name = "";
    nextValue.last_name_confidence = 0;
  }

  if (looksLikeJapaneseAddressField(nextValue.local_middle_name)) {
    nextValue.local_middle_name = "";
    nextValue.middle_name_confidence = 0;
  }

  if (looksLikeJapaneseAddressField(nextValue.local_full_name)) {
    nextValue.local_full_name = "";
    nextValue.local_full_name_confidence = 0;
  }

  if (!nextValue.local_full_name && nextValue.local_last_name && nextValue.local_first_name) {
    nextValue.local_full_name = `${nextValue.local_last_name} ${nextValue.local_first_name}`;
    nextValue.local_full_name_confidence = averageConfidence([
      nextValue.local_full_name_confidence,
      nextValue.last_name_confidence,
      nextValue.first_name_confidence,
    ]);
  }

  if (nextValue.local_full_name && (!nextValue.local_last_name || !nextValue.local_first_name)) {
    const splitFullName = splitLocalFullName(nextValue.local_full_name);

    if (!nextValue.local_last_name && splitFullName.lastName) {
      nextValue.local_last_name = splitFullName.lastName;
    }

    if (!nextValue.local_first_name && splitFullName.firstName) {
      nextValue.local_first_name = splitFullName.firstName;
    }
  }

  return nextValue;
}

function looksLikeJapanesePrefecture(value: string) {
  return /[\u90fd\u9053\u5e9c\u770c]$/u.test(cleanText(value));
}

function looksLikeJapaneseAddressField(value: string) {
  const cleaned = cleanText(value);

  return (
    /[0-9\uff10-\uff19]/u.test(cleaned) ||
    /(?:\u4e01\u76ee|\u756a\u5730|\u756a|\u53f7)/u.test(cleaned) ||
    /[\u90fd\u9053\u5e9c\u770c]$/u.test(cleaned)
  );
}

function shouldRunJapanesePoiNameRescue({
  countryHint,
  documentTypeHint,
  issuedCountry,
  localIssuedCountry,
  firstName,
  firstNameConfidence,
  localFirstName,
  localFirstNameConfidence,
  lastName,
  lastNameConfidence,
  localLastName,
  localLastNameConfidence,
  localFullName,
  localFullNameConfidence,
  romanizationPrimaryFullName,
}: {
  countryHint: string;
  documentTypeHint: string;
  issuedCountry: string;
  localIssuedCountry: string;
  firstName: string;
  firstNameConfidence: number;
  localFirstName: string;
  localFirstNameConfidence: number;
  lastName: string;
  lastNameConfidence: number;
  localLastName: string;
  localLastNameConfidence: number;
  localFullName: string;
  localFullNameConfidence: number;
  romanizationPrimaryFullName: string;
}) {
  const normalizedDocType = normalizeLooseText(documentTypeHint);
  const isJapaneseDocument =
    [countryHint, issuedCountry, localIssuedCountry].some((value) => isJapaneseCountryValue(value)) &&
    (normalizedDocType.includes("driver") ||
      normalizedDocType.includes("license") ||
      normalizedDocType.includes("id") ||
      normalizedDocType.includes("card"));

  if (!isJapaneseDocument) {
    return false;
  }

  if (!hasPoiNameEvidence({
    first_name: firstName,
    last_name: lastName,
    local_first_name: localFirstName,
    local_last_name: localLastName,
    local_full_name: localFullName,
    romanization_primary_full_name: romanizationPrimaryFullName,
  })) {
    return true;
  }

  return hasLowConfidencePresentField(
    [
      {
        value: localFirstName || firstName,
        confidence: localFirstNameConfidence || firstNameConfidence,
      },
      {
        value: localLastName || lastName,
        confidence: localLastNameConfidence || lastNameConfidence,
      },
      {
        value: localFullName,
        confidence: localFullNameConfidence,
      },
    ],
    0.62,
  );
}

function hasPoiNameEvidence(value: {
  first_name: string;
  last_name: string;
  local_first_name: string;
  local_last_name: string;
  local_full_name: string;
  romanization_primary_full_name: string;
}) {
  return Boolean(
    value.local_full_name ||
      value.local_first_name ||
      value.local_last_name ||
      (value.first_name && value.last_name) ||
      value.romanization_primary_full_name,
  );
}

function mergePoiNameExtraction<
  T extends {
    first_name: string;
    local_first_name: string;
    first_name_confidence: number;
    local_first_name_confidence: number;
    last_name: string;
    local_last_name: string;
    last_name_confidence: number;
    local_last_name_confidence: number;
    middle_name: string;
    local_middle_name: string;
    middle_name_confidence: number;
    local_middle_name_confidence: number;
    local_full_name: string;
    local_full_name_confidence: number;
    romanization_primary_full_name: string;
    romanization_alternatives: string[];
    romanization_notes: string;
    overall_confidence: number;
  warnings: string[];
    first_name_romanization_candidates: string[];
    middle_name_romanization_candidates: string[];
    last_name_romanization_candidates: string[];
  },
>(baseValue: T, rescueValue: T) {
  return {
    ...baseValue,
    first_name: rescueValue.first_name,
    local_first_name: rescueValue.local_first_name,
    first_name_confidence: rescueValue.first_name_confidence,
    local_first_name_confidence: rescueValue.local_first_name_confidence,
    last_name: rescueValue.last_name,
    local_last_name: rescueValue.local_last_name,
    last_name_confidence: rescueValue.last_name_confidence,
    local_last_name_confidence: rescueValue.local_last_name_confidence,
    middle_name: rescueValue.middle_name,
    local_middle_name: rescueValue.local_middle_name,
    middle_name_confidence: rescueValue.middle_name_confidence,
    local_middle_name_confidence: rescueValue.local_middle_name_confidence,
    local_full_name: rescueValue.local_full_name,
    local_full_name_confidence: rescueValue.local_full_name_confidence,
    romanization_primary_full_name: rescueValue.romanization_primary_full_name,
    romanization_alternatives: rescueValue.romanization_alternatives,
    romanization_notes: rescueValue.romanization_notes,
    first_name_romanization_candidates: uniqueNameList([
      ...baseValue.first_name_romanization_candidates,
      ...rescueValue.first_name_romanization_candidates,
    ]),
    middle_name_romanization_candidates: uniqueNameList([
      ...baseValue.middle_name_romanization_candidates,
      ...rescueValue.middle_name_romanization_candidates,
    ]),
    last_name_romanization_candidates: uniqueNameList([
      ...baseValue.last_name_romanization_candidates,
      ...rescueValue.last_name_romanization_candidates,
    ]),
    overall_confidence: averageConfidence([
      baseValue.overall_confidence,
      rescueValue.overall_confidence,
    ]),
    warnings: uniqueStrings([...baseValue.warnings, ...rescueValue.warnings]),
  };
}

function normalizePoiDocumentNumberForType<
  T extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(
  value: T,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  const nextValue = { ...value };
  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    nextValue.document_type,
    nextValue.local_document_type,
  );

  if (!isJapaneseCountryHint(countryHint)) {
    return nextValue;
  }

  if (isJapaneseIndividualNumberCardType(typeFingerprint)) {
    const individualNumber =
      extractJapaneseIndividualNumber(nextValue.document_number) ||
      extractJapaneseIndividualNumber(nextValue.local_document_number);

    if (!individualNumber) {
      return {
        ...nextValue,
        document_number: "",
        local_document_number: "",
        document_number_confidence: 0,
      };
    }

    return {
      ...nextValue,
      document_number: individualNumber,
      local_document_number: nextValue.local_document_number || individualNumber,
      document_number_confidence: Math.max(
        nextValue.document_number_confidence,
        nextValue.local_document_number ? 0.93 : 0.88,
      ),
    };
  }

  return nextValue;
}

function normalizePoiDocumentNumberRescueExtraction(
  extraction: OpenAiDocumentNumberRescueExtraction,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  return normalizePoiDocumentNumberForType(
    {
      document_type: documentTypeHint,
      local_document_type: "",
      document_number: cleanDocumentNumberText(extraction.document_number),
      local_document_number: cleanDocumentNumberText(extraction.local_document_number),
      document_number_confidence: clampConfidence(extraction.document_number_confidence),
    },
    { countryHint, documentTypeHint },
  );
}

function normalizePorDocumentNumberForType<
  T extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(
  value: T,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  const nextValue = { ...value };
  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    nextValue.document_type,
    nextValue.local_document_type,
  );

  if (isJapaneseCountryHint(countryHint) && isJapaneseIndividualNumberCardType(typeFingerprint)) {
    const individualNumber =
      extractJapaneseIndividualNumber(nextValue.document_number) ||
      extractJapaneseIndividualNumber(nextValue.local_document_number);

    return {
      ...nextValue,
      document_number: individualNumber,
      local_document_number: individualNumber
        ? nextValue.local_document_number || individualNumber
        : "",
      document_number_confidence: individualNumber
        ? Math.max(nextValue.document_number_confidence, 0.9)
        : 0,
    };
  }

  if (!isUtilityLikeDocumentType(typeFingerprint)) {
    return nextValue;
  }

  const standardizedCandidate = normalizePorDocumentNumberCandidate(
    nextValue.document_number,
    typeFingerprint,
  );
  const localCandidate = normalizePorDocumentNumberCandidate(
    nextValue.local_document_number,
    typeFingerprint,
  );
  const bestCandidate = standardizedCandidate || localCandidate;

  if (!bestCandidate) {
    return {
      ...nextValue,
      document_number: "",
      local_document_number: "",
      document_number_confidence: 0,
    };
  }

  return {
    ...nextValue,
    document_number: bestCandidate,
    local_document_number: localCandidate,
    document_number_confidence: Math.max(
      nextValue.document_number_confidence,
      localCandidate ? 0.78 : 0.68,
    ),
  };
}

function normalizePorDocumentNumberRescueExtraction(
  extraction: OpenAiDocumentNumberRescueExtraction,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  return normalizePorDocumentNumberForType(
    {
      document_type: documentTypeHint,
      local_document_type: "",
      document_number: cleanDocumentNumberText(extraction.document_number),
      local_document_number: cleanDocumentNumberText(extraction.local_document_number),
      document_number_confidence: clampConfidence(extraction.document_number_confidence),
    },
    { countryHint, documentTypeHint },
  );
}

function shouldRunPoiDocumentNumberRescue({
  countryHint,
  documentTypeHint,
  detectedDocumentType,
  localDocumentType,
  backProvided,
  documentNumber,
  localDocumentNumber,
  documentNumberConfidence,
}: {
  countryHint: string;
  documentTypeHint: string;
  detectedDocumentType: string;
  localDocumentType: string;
  backProvided: boolean;
  documentNumber: string;
  localDocumentNumber: string;
  documentNumberConfidence: number;
}) {
  if (!isJapaneseCountryHint(countryHint)) {
    return false;
  }

  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    detectedDocumentType,
    localDocumentType,
  );

  if (isJapaneseIndividualNumberCardType(typeFingerprint)) {
    const hasValidIndividualNumber = Boolean(
      extractJapaneseIndividualNumber(documentNumber) ||
        extractJapaneseIndividualNumber(localDocumentNumber),
    );

    return backProvided && (!hasValidIndividualNumber || documentNumberConfidence < 0.9);
  }

  if (isJapaneseDriversLicenseType(typeFingerprint)) {
    return (!documentNumber && !localDocumentNumber) || documentNumberConfidence < 0.72;
  }

  return false;
}

function isBetterPoiDocumentNumberExtraction<
  TBase extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
  TRescue extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(baseValue: TBase, rescueValue: TRescue) {
  return scorePoiDocumentNumberCandidate(rescueValue) > scorePoiDocumentNumberCandidate(baseValue);
}

function mergePoiDocumentNumberExtraction<
  TBase extends {
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
    warnings: string[];
  },
  TRescue extends {
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(baseValue: TBase, rescueValue: TRescue) {
  return {
    ...baseValue,
    document_number: rescueValue.document_number,
    local_document_number: rescueValue.local_document_number,
    document_number_confidence: rescueValue.document_number_confidence,
    warnings: uniqueStrings([...baseValue.warnings]),
  };
}

function shouldRunPorDocumentNumberRescue(
  extraction: ReturnType<typeof sanitizePorExtraction>,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  if (!isJapaneseCountryHint(countryHint)) {
    return false;
  }

  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    extraction.document_type,
    extraction.local_document_type,
  );

  if (isJapaneseIndividualNumberCardType(typeFingerprint)) {
    const hasValidIndividualNumber = Boolean(
      extractJapaneseIndividualNumber(extraction.document_number) ||
        extractJapaneseIndividualNumber(extraction.local_document_number),
    );

    return !hasValidIndividualNumber || extraction.document_number_confidence < 0.9;
  }

  if (isUtilityLikeDocumentType(typeFingerprint)) {
    return (
      !normalizePorDocumentNumberCandidate(extraction.document_number, typeFingerprint) &&
      !normalizePorDocumentNumberCandidate(extraction.local_document_number, typeFingerprint)
    );
  }

  return false;
}

function isBetterPorDocumentNumberExtraction<
  TBase extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
  TRescue extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(
  baseValue: TBase,
  rescueValue: TRescue,
  {
    countryHint,
    documentTypeHint,
  }: {
    countryHint: string;
    documentTypeHint: string;
  },
) {
  const typeFingerprint = buildDocumentTypeFingerprint(
    documentTypeHint,
    baseValue.document_type || rescueValue.document_type,
    baseValue.local_document_type || rescueValue.local_document_type,
  );

  return (
    scorePorDocumentNumberCandidate(baseValue, typeFingerprint, countryHint) <
    scorePorDocumentNumberCandidate(rescueValue, typeFingerprint, countryHint)
  );
}

function mergePorDocumentNumberExtraction<
  TBase extends {
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
    warnings: string[];
  },
  TRescue extends {
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(baseValue: TBase, rescueValue: TRescue) {
  return {
    ...baseValue,
    document_number: rescueValue.document_number,
    local_document_number: rescueValue.local_document_number,
    document_number_confidence: rescueValue.document_number_confidence,
    warnings: uniqueStrings([...baseValue.warnings]),
  };
}

function buildDocumentTypeFingerprint(...values: string[]) {
  return values.map((value) => normalizeLooseText(value)).filter(Boolean).join(" ");
}

function isJapaneseIndividualNumberCardType(typeFingerprint: string) {
  return (
    typeFingerprint.includes("individualnumber") ||
    typeFingerprint.includes("mynumber") ||
    typeFingerprint.includes("個人番号カード") ||
    typeFingerprint.includes("マイナンバー") ||
    (typeFingerprint.includes("idcard") && typeFingerprint.includes("個人番号"))
  );
}

function isJapaneseDriversLicenseType(typeFingerprint: string) {
  return (
    typeFingerprint.includes("driver") ||
    typeFingerprint.includes("license") ||
    typeFingerprint.includes("運転免許")
  );
}

function isUtilityLikeDocumentType(typeFingerprint: string) {
  return [
    "utility",
    "bill",
    "giro",
    "statement",
    "invoice",
    "notice",
    "請求",
    "料金",
    "利用",
    "振替",
    "納付",
    "ご案内",
  ].some((keyword) => typeFingerprint.includes(normalizeLooseText(keyword)));
}

function isAddressBearingIdDocumentType(typeFingerprint: string) {
  return (
    typeFingerprint.includes("residence") ||
    typeFingerprint.includes("record") ||
    typeFingerprint.includes("certificate") ||
    typeFingerprint.includes("permit") ||
    typeFingerprint.includes("card") ||
    typeFingerprint.includes("license") ||
    typeFingerprint.includes("住民票") ||
    typeFingerprint.includes("在留") ||
    typeFingerprint.includes("免許")
  );
}

function hasSenderLikeAddressSignals(extraction: ReturnType<typeof sanitizePorExtraction>) {
  const combined = normalizeLooseText(
    [
      extraction.local_full_address,
      extraction.local_address_1,
      extraction.local_address_2,
      extraction.address_notes,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!combined) {
    return false;
  }

  const senderMarkers = [
    "株式会社",
    "有限会社",
    "営業所",
    "支店",
    "本社",
    "センター",
    "総務",
    "水道",
    "役所",
    "課",
    "係",
    "ntt",
    "ファイナンス",
    "お問い合わせ",
    "問合せ",
    "ご案内",
    "料金",
    "請求",
    "電話",
    "tel",
    "customer service",
  ];

  return senderMarkers.some((marker) => combined.includes(normalizeLooseText(marker)));
}

function hasWeakPorAddressEvidence(extraction: ReturnType<typeof sanitizePorExtraction>) {
  if (!extraction.local_full_address && !extraction.local_address_1 && !extraction.local_address_2) {
    return true;
  }

  if (!extraction.state || !extraction.city || !extraction.address_1) {
    return true;
  }

  return hasLowConfidencePresentField(
    [
      { value: extraction.state || extraction.local_state, confidence: extraction.state_confidence },
      { value: extraction.city || extraction.local_city, confidence: extraction.city_confidence },
      { value: extraction.address_1 || extraction.local_address_1, confidence: extraction.address_1_confidence },
    ],
    0.62,
  );
}

function extractJapaneseIndividualNumber(value: string) {
  const digits = cleanText(value).replace(/\D/g, "");

  if (digits.length !== 12) {
    return "";
  }

  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

function normalizePorDocumentNumberCandidate(value: string, typeFingerprint: string) {
  const candidate = cleanDocumentNumberText(value);

  if (!candidate || !looksLikeDocumentNumber(candidate)) {
    return "";
  }

  if (isUtilityLikeDocumentType(typeFingerprint)) {
    if (
      isLikelyPhoneLikeNumber(candidate) ||
      isLikelyPostalCodeLikeNumber(candidate) ||
      isLikelyDateLikeNumber(candidate) ||
      isLikelyAmountLikeNumber(candidate) ||
      isLikelyBarcodePayload(candidate)
    ) {
      return "";
    }
  }

  return candidate;
}

function scorePoiDocumentNumberCandidate<
  T extends {
    document_type: string;
    local_document_type: string;
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(value: T) {
  const typeFingerprint = buildDocumentTypeFingerprint(
    value.document_type,
    value.local_document_type,
  );
  const isIndividualNumber = isJapaneseIndividualNumberCardType(typeFingerprint);
  const candidate = isIndividualNumber
    ? extractJapaneseIndividualNumber(value.document_number || value.local_document_number)
    : cleanDocumentNumberText(value.document_number || value.local_document_number);

  if (!candidate) {
    return 0;
  }

  return (
    (isIndividualNumber ? 10 : 6) +
    clampConfidence(value.document_number_confidence) * 5 +
    (value.local_document_number ? 1 : 0)
  );
}

function scorePorDocumentNumberCandidate<
  TValue extends {
    document_number: string;
    local_document_number: string;
    document_number_confidence: number;
  },
>(
  value: TValue,
  typeFingerprint: string,
  countryHint: string,
) {
  const candidate = isJapaneseCountryHint(countryHint) && isJapaneseIndividualNumberCardType(typeFingerprint)
    ? extractJapaneseIndividualNumber(value.document_number || value.local_document_number)
    : normalizePorDocumentNumberCandidate(
        value.document_number || value.local_document_number,
        typeFingerprint,
      );

  if (!candidate) {
    return 0;
  }

  return 6 + clampConfidence(value.document_number_confidence) * 5 + (value.local_document_number ? 1 : 0);
}

function isLikelyPhoneLikeNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 11 && digits.startsWith("0");
}

function isLikelyPostalCodeLikeNumber(value: string) {
  return value.replace(/\D/g, "").length === 7;
}

function isLikelyDateLikeNumber(value: string) {
  return /\b(?:19|20)\d{2}[-/.]?\d{1,2}[-/.]?\d{1,2}\b/.test(value);
}

function isLikelyAmountLikeNumber(value: string) {
  return /[¥円]/u.test(value) || /^\d{1,3}(?:,\d{3})+$/.test(value);
}

function isLikelyBarcodePayload(value: string) {
  const compact = value.replace(/[^0-9A-Za-z]/g, "");
  return compact.length >= 18;
}

function shouldClearInferredPoiNationality(value: {
  nationality: string;
  local_nationality: string;
  nationality_confidence: number;
  issued_country: string;
  local_document_type: string;
  document_type: string;
}) {
  if (!value.nationality || value.local_nationality) {
    return false;
  }

  const normalizedNationality = normalizeLooseText(value.nationality);
  const normalizedIssuedCountry = normalizeLooseText(value.issued_country);

  if (!normalizedNationality || normalizedNationality !== normalizedIssuedCountry) {
    return false;
  }

  const normalizedDocumentType = normalizeLooseText(
    `${value.document_type} ${value.local_document_type}`,
  );

  return (
    value.nationality_confidence < 0.8 ||
    normalizedDocumentType.includes("driver") ||
    normalizedDocumentType.includes("license") ||
    normalizedDocumentType.includes("\u904b\u8ee2")
  );
}

function parseJapaneseRecipientAddress({
  localState,
  localCity,
  localAddress1,
  localAddress2,
  localFullAddress,
}: {
  localState: string;
  localCity: string;
  localAddress1: string;
  localAddress2: string;
  localFullAddress: string;
}) {
  const sourceAddress = normalizeJapaneseAddressText(
    localFullAddress || `${localState}${localCity}${localAddress1}${localAddress2}`,
  );

  if (!sourceAddress) {
    return {
      localCity,
      localAddress1,
      localAddress2,
    };
  }

  let remainder = sourceAddress.replace(/^〒/u, "");
  remainder = remainder.replace(/^\d{3}[-－ーｰ]?\d{4}/u, "");

  const normalizedState = normalizeJapaneseAddressText(localState);

  if (normalizedState && remainder.startsWith(normalizedState)) {
    remainder = remainder.slice(normalizedState.length);
  }

  const cityMatch = matchJapaneseCityBoundary(remainder);

  if (!cityMatch) {
    return {
      localCity,
      localAddress1,
      localAddress2,
    };
  }

  const nextLocalCity = cityMatch.city;
  remainder = cityMatch.remainder;
  let nextLocalAddress1 = "";
  let nextLocalAddress2 = "";

  if (nextLocalCity.endsWith("郡")) {
    const districtMatch = remainder.match(/^(.+?[町村])(.*)$/u);

    if (districtMatch) {
      nextLocalAddress1 = cleanText(districtMatch[1] ?? "");
      remainder = cleanText(districtMatch[2] ?? "");
    }
  }

  if (!nextLocalAddress1) {
    const oazaAzaMatch = remainder.match(/^(大字[^字]+)(字.+)$/u);

    if (oazaAzaMatch) {
      nextLocalAddress1 = cleanText(oazaAzaMatch[1] ?? "");
      remainder = cleanText(oazaAzaMatch[2] ?? "");
    }
  }

  if (!nextLocalAddress1) {
    const chomeMatch = remainder.match(/^(.+?)([0-9０-９一二三四五六七八九十]+丁目.*)$/u);

    if (chomeMatch) {
      nextLocalAddress1 = cleanText(chomeMatch[1] ?? "");
      remainder = cleanText(chomeMatch[2] ?? "");
    }
  }

  if (!nextLocalAddress1) {
    const numericIndex = remainder.search(/[0-9０-９]/u);

    if (numericIndex > 0) {
      nextLocalAddress1 = cleanText(remainder.slice(0, numericIndex));
      remainder = cleanText(remainder.slice(numericIndex));
    }
  }

  if (!nextLocalAddress1) {
    nextLocalAddress1 = cleanText(remainder);
    remainder = "";
  }

  nextLocalAddress2 = cleanText(remainder) || cleanText(localAddress2);

  return {
    localCity: cleanText(nextLocalCity) || cleanText(localCity),
    localAddress1: cleanText(nextLocalAddress1) || cleanText(localAddress1),
    localAddress2: nextLocalAddress2,
  };
}

function preferOriginalLocalPoiNameScripts<T extends {
  local_first_name: string;
  local_last_name: string;
  local_middle_name: string;
  local_full_name: string;
}>(value: T) {
  const nextValue = { ...value };
  const fullName = cleanText(nextValue.local_full_name);
  const splitFullName = splitLocalFullName(fullName);
  const fullNameHasHan = containsHanScript(fullName);

  if (fullNameHasHan && isKanaOnly(nextValue.local_last_name)) {
    nextValue.local_last_name = splitFullName.lastName || "";
  }

  if (fullNameHasHan && isKanaOnly(nextValue.local_first_name)) {
    nextValue.local_first_name = splitFullName.firstName || "";
  }

  if (fullNameHasHan && isKanaOnly(nextValue.local_middle_name)) {
    nextValue.local_middle_name = "";
  }

  return nextValue;
}

function splitLocalFullName(value: string) {
  const tokens = cleanText(value)
    .split(/[\s·・]+/u)
    .map((token) => cleanText(token))
    .filter(Boolean);

  if (tokens.length < 2) {
    return {
      lastName: "",
      firstName: "",
    };
  }

  return {
    lastName: tokens[0] ?? "",
    firstName: tokens.slice(1).join(" "),
  };
}

function isKanaOnly(value: string) {
  const cleaned = cleanText(value);
  return Boolean(cleaned) && /^[\p{Script=Katakana}\p{Script=Hiragana}ー\s]+$/u.test(cleaned);
}

function containsHanScript(value: string) {
  return /[\p{Script=Han}]/u.test(cleanText(value));
}

function matchJapaneseCityBoundary(value: string) {
  const patterns = [
    /^(.+?市.+?区)(.+)$/u,
    /^(.+?市)(.+)$/u,
    /^(.+?区)(.+)$/u,
    /^(.+?郡)(.+)$/u,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match) {
      return {
        city: cleanText(match[1] ?? ""),
        remainder: cleanText(match[2] ?? ""),
      };
    }
  }

  return null;
}

function normalizeJapaneseAddressText(value: string) {
  return cleanText(value).normalize("NFKC").replace(/\s+/g, "");
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

function shouldApplyJapanesePorHeuristics({
  issuedCountry,
  country,
  localCountry,
  localState,
}: {
  issuedCountry: string;
  country: string;
  localCountry: string;
  localState: string;
}) {
  const normalizedValues = [issuedCountry, country, localCountry, localState]
    .map((value) => value.normalize("NFKC").toLowerCase().trim())
    .filter(Boolean);

  return normalizedValues.some((value) =>
    ["japan", "jp", "日本"].includes(value),
  );
}

function extractPostalCodeFromText(value: string) {
  const match = value.match(/\b(\d{3})[-－ーｰ]?(\d{4})\b/);

  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2]}`;
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

function cleanDocumentNumberText(value: string) {
  const cleaned = cleanText(value).normalize("NFKC");

  if (!cleaned) {
    return "";
  }

  return cleaned
    .replace(/^No\.?\s*/i, "")
    .replace(/^第\s*/u, "")
    .replace(/\s*号$/u, "")
    .replace(/\s*([/-])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeDocumentNumber(value: string) {
  const normalized = cleanDocumentNumberText(value);

  if (!normalized) {
    return false;
  }

  const compact = normalized.replace(/[^0-9A-Za-z]/g, "");

  if (compact.length < 6) {
    return false;
  }

  const digitCount = (compact.match(/\d/g) ?? []).length;
  return digitCount >= Math.max(4, Math.floor(compact.length * 0.6));
}

function deriveDocumentNumberConfidence({
  extractedConfidence,
  documentQualityConfidence,
  standardizedValue,
  localValue,
}: {
  extractedConfidence: number;
  documentQualityConfidence: number;
  standardizedValue: string;
  localValue: string;
}) {
  const baseConfidence = clampConfidence(extractedConfidence);
  const normalizedValue = standardizedValue || localValue;

  if (!normalizedValue || !looksLikeDocumentNumber(normalizedValue)) {
    return baseConfidence;
  }

  if (localValue) {
    return Math.max(
      baseConfidence,
      clampConfidence(averageConfidence([documentQualityConfidence, 0.9])),
    );
  }

  return Math.max(
    baseConfidence,
    clampConfidence(averageConfidence([documentQualityConfidence, 0.82])),
  );
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
      "문서 분석 중 알 수 없는 OpenAI 오류가 발생했습니다.",
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
      "서버에 OPENAI_API_KEY가 설정되어 있지 않습니다. 환경 변수를 확인해주세요.",
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
      `OpenAI API 키가 올바르지 않거나 만료되었습니다. 설정된 키를 확인해주세요.${formatDetailSuffix(
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
      `OpenAI 크레딧 또는 결제 한도가 부족합니다. Billing과 Usage를 확인해주세요.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  if (status === 429) {
    return new VerificationError(
      429,
      `OpenAI 호출 한도를 초과했습니다. 잠시 후 다시 시도해주세요.${formatDetailSuffix(
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
      `현재 OpenAI 계정으로 필요한 모델에 접근할 수 없습니다. 시도한 모델: ${attemptedModelSummary}.${formatDetailSuffix(
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
      `요청한 OpenAI 모델을 찾지 못했습니다. OPENAI_MODEL 또는 모델 접근 권한을 확인해주세요. 시도한 모델: ${attemptedModelSummary}.${formatDetailSuffix(
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
      `업로드한 이미지 형식 또는 이미지 데이터에 문제가 있어 처리하지 못했습니다. 다른 이미지를 시도해주세요.${formatDetailSuffix(
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
      `OpenAI 정책에 의해 요청이 차단되었습니다.${formatDetailSuffix(
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
      `서버의 OpenAI 요청 설정이 올바르지 않아 수정이 필요합니다.${formatDetailSuffix(
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
      `OpenAI 서버가 일시적으로 불안정하거나 사용할 수 없습니다. 잠시 후 다시 시도해주세요.${formatDetailSuffix(
        status,
        code,
      )}`,
      error.message,
    );
  }

  return new VerificationError(
    status >= 400 && status < 600 ? status : 502,
    `OpenAI 문서 분석 요청이 실패했습니다. 요청 설정과 업로드 파일을 확인해주세요.${formatDetailSuffix(
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

