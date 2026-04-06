export type MatchResult =
  | "exact_match"
  | "likely_match"
  | "possible_match"
  | "mismatch"
  | "manual_review";

export type ConfidenceTone = "low" | "review" | "good";

export type GenderValue = "Male" | "Female" | "X" | "";

export type GenderSource =
  | "printed_field"
  | "ocr_field"
  | "country_label_mapping"
  | "unknown";

export interface NameMatchEvaluation {
  result: MatchResult;
  confidence: number;
  reason: string;
  matchedValue: string;
  score: number;
}

export interface LocalImageQualityCheck {
  confidence: number;
  notes: string[];
  warnings: string[];
  width: number;
  height: number;
}

export interface VerificationResult {
  user_input_english_name: string;
  country_detected: string;
  document_type_detected: string;
  document_quality_confidence: number;
  document_quality_notes: string;
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
  gender: GenderValue;
  gender_confidence: number;
  gender_source: GenderSource;
  gender_evidence: string;
  gender_notes: string;
  document_number: string;
  document_number_confidence: number;
  date_of_birth: string;
  date_of_birth_confidence: number;
  date_of_expiry: string;
  date_of_expiry_confidence: number;
  place_of_birth: string;
  place_of_birth_confidence: number;
  nationality: string;
  nationality_confidence: number;
  romanization_primary_full_name: string;
  romanization_alternatives: string[];
  romanization_notes: string;
  name_match_result: MatchResult;
  name_match_confidence: number;
  name_match_reason: string;
  overall_confidence: number;
  manual_review_required: boolean;
  warnings: string[];
}
