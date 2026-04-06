export type VerificationKind = "poi" | "por";

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

export type PostalCodeSource = "ocr" | "lookup" | "none";

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

export interface BaseVerificationResult {
  kind: VerificationKind;
  document_type: string;
  local_document_type: string;
  document_type_confidence: number;
  document_number: string;
  local_document_number: string;
  document_number_confidence: number;
  issued_country: string;
  local_issued_country: string;
  issued_country_confidence: number;
  date_of_expiry: string;
  local_date_of_expiry: string;
  date_of_expiry_confidence: number;
  document_quality_confidence: number;
  document_quality_notes: string;
  overall_confidence: number;
  manual_review_required: boolean;
  warnings: string[];
}

export interface PoiVerificationResult extends BaseVerificationResult {
  kind: "poi";
  user_input_english_name: string;
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
  gender: GenderValue;
  local_gender: string;
  gender_confidence: number;
  gender_source: GenderSource;
  gender_evidence: string;
  gender_notes: string;
  date_of_birth: string;
  local_date_of_birth: string;
  date_of_birth_confidence: number;
  place_of_birth: string;
  local_place_of_birth: string;
  place_of_birth_confidence: number;
  nationality: string;
  local_nationality: string;
  nationality_confidence: number;
  romanization_primary_full_name: string;
  romanization_alternatives: string[];
  romanization_notes: string;
  name_match_result: MatchResult;
  name_match_confidence: number;
  name_match_reason: string;
}

export interface PorVerificationResult extends BaseVerificationResult {
  kind: "por";
  country: string;
  local_country: string;
  country_confidence: number;
  state: string;
  local_state: string;
  state_confidence: number;
  city: string;
  local_city: string;
  city_confidence: number;
  address_1: string;
  local_address_1: string;
  address_1_confidence: number;
  address_2: string;
  local_address_2: string;
  address_2_confidence: number;
  postal_code: string;
  local_postal_code: string;
  postal_code_confidence: number;
  postal_code_source: PostalCodeSource;
  local_full_address: string;
  local_full_address_confidence: number;
  address_notes: string;
}

export type VerificationResult = PoiVerificationResult | PorVerificationResult;
