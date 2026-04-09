import { z } from "zod";

const boundedConfidence = z.coerce.number().min(0).max(1).catch(0).default(0);
const blankString = z.string().catch("").default("");
const blankStringArray = z.array(z.string().catch("")).catch([]).default([]);

const genderEnum = z.enum(["Male", "Female", "X", ""]).catch("").default("");
const genderSourceEnum = z
  .enum([
    "printed_field",
    "ocr_field",
    "country_label_mapping",
    "unknown",
  ])
  .catch("unknown")
  .default("unknown");

const commonFields = {
  document_type: blankString,
  local_document_type: blankString,
  document_type_confidence: boundedConfidence,
  document_number: blankString,
  local_document_number: blankString,
  document_number_confidence: boundedConfidence,
  issued_country: blankString,
  local_issued_country: blankString,
  issued_country_confidence: boundedConfidence,
  date_of_expiry: blankString,
  local_date_of_expiry: blankString,
  date_of_expiry_confidence: boundedConfidence,
  document_quality_confidence: boundedConfidence,
  document_quality_notes: blankString,
  document_integrity_status: z
    .enum(["clean", "suspected", "tampered"])
    .catch("clean")
    .default("clean"),
  document_integrity_notes: blankString,
  overall_confidence: boundedConfidence,
  manual_review_required: z.boolean().catch(false).default(false),
  warnings: blankStringArray,
} as const;

export const openAiPoiExtractionSchema = z.object({
  ...commonFields,
  first_name: blankString,
  local_first_name: blankString,
  first_name_confidence: boundedConfidence,
  local_first_name_confidence: boundedConfidence,
  last_name: blankString,
  local_last_name: blankString,
  last_name_confidence: boundedConfidence,
  local_last_name_confidence: boundedConfidence,
  middle_name: blankString,
  local_middle_name: blankString,
  middle_name_confidence: boundedConfidence,
  local_middle_name_confidence: boundedConfidence,
  local_full_name: blankString,
  local_full_name_confidence: boundedConfidence,
  gender: genderEnum,
  local_gender: blankString,
  gender_confidence: boundedConfidence,
  gender_source: genderSourceEnum,
  gender_evidence: blankString,
  gender_notes: blankString,
  date_of_birth: blankString,
  local_date_of_birth: blankString,
  date_of_birth_confidence: boundedConfidence,
  place_of_birth: blankString,
  local_place_of_birth: blankString,
  place_of_birth_confidence: boundedConfidence,
  nationality: blankString,
  local_nationality: blankString,
  nationality_confidence: boundedConfidence,
  romanization_primary_full_name: blankString,
  romanization_alternatives: blankStringArray,
  romanization_notes: blankString,
  first_name_romanization_candidates: blankStringArray,
  middle_name_romanization_candidates: blankStringArray,
  last_name_romanization_candidates: blankStringArray,
});

export const openAiPorExtractionSchema = z.object({
  ...commonFields,
  country: blankString,
  local_country: blankString,
  country_confidence: boundedConfidence,
  state: blankString,
  local_state: blankString,
  state_confidence: boundedConfidence,
  city: blankString,
  local_city: blankString,
  city_confidence: boundedConfidence,
  address_1: blankString,
  local_address_1: blankString,
  address_1_confidence: boundedConfidence,
  address_2: blankString,
  local_address_2: blankString,
  address_2_confidence: boundedConfidence,
  postal_code: blankString,
  local_postal_code: blankString,
  postal_code_confidence: boundedConfidence,
  local_full_address: blankString,
  local_full_address_confidence: boundedConfidence,
  address_notes: blankString,
});

export type OpenAiPoiExtraction = z.infer<typeof openAiPoiExtractionSchema>;
export type OpenAiPorExtraction = z.infer<typeof openAiPorExtractionSchema>;
