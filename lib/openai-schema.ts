import { z } from "zod";

const boundedConfidence = z.coerce.number().min(0).max(1).catch(0).default(0);
const blankString = z.string().catch("").default("");
const blankStringArray = z.array(z.string().catch("")).catch([]).default([]);

export const openAiExtractionSchema = z.object({
  country_detected: blankString,
  document_type_detected: blankString,
  document_quality_confidence: boundedConfidence,
  document_quality_notes: blankString,
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
  gender: z.enum(["Male", "Female", "X", ""]).catch("").default(""),
  gender_confidence: boundedConfidence,
  gender_source: z
    .enum([
      "printed_field",
      "ocr_field",
      "country_label_mapping",
      "unknown",
    ])
    .catch("unknown")
    .default("unknown"),
  gender_evidence: blankString,
  gender_notes: blankString,
  document_number: blankString,
  document_number_confidence: boundedConfidence,
  date_of_birth: blankString,
  date_of_birth_confidence: boundedConfidence,
  date_of_expiry: blankString,
  date_of_expiry_confidence: boundedConfidence,
  place_of_birth: blankString,
  place_of_birth_confidence: boundedConfidence,
  nationality: blankString,
  nationality_confidence: boundedConfidence,
  romanization_primary_full_name: blankString,
  romanization_alternatives: blankStringArray,
  romanization_notes: blankString,
  overall_confidence: boundedConfidence,
  manual_review_required: z.boolean().catch(false).default(false),
  warnings: blankStringArray,
});

export type OpenAiExtraction = z.infer<typeof openAiExtractionSchema>;
