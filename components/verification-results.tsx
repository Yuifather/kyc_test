import { formatConfidence, getConfidenceTone } from "@/lib/confidence";
import { normalizeLooseText, uniqueNameList } from "@/lib/name-normalizer";
import type {
  ConfidenceTone,
  PoiVerificationResult,
  PorVerificationResult,
  VerificationResult,
} from "@/types/verification";

const confidenceClasses: Record<ConfidenceTone, string> = {
  low: "border-rose-200 bg-rose-100 text-rose-800",
  review: "border-amber-200 bg-amber-100 text-amber-900",
  good: "border-emerald-200 bg-emerald-100 text-emerald-900",
};

const sourceClasses = {
  ocr: "border-emerald-200 bg-emerald-100 text-emerald-900",
  lookup: "border-sky-200 bg-sky-100 text-sky-900",
};

const neutralBadgeClass = "border-stone-200 bg-stone-100 text-stone-500";

interface DetailRow {
  label: string;
  standardizedValue: string;
  localValue?: string;
  confidence: number;
  nameConsistency?: number | null;
  lookupSource?: "OCR" | "조회" | null;
}

export function VerificationResults({ result }: { result: VerificationResult }) {
  const isPoi = result.kind === "poi";
  const rows = isPoi ? buildPoiRows(result) : buildPorRows(result);
  const statusReasons = buildStatusReasons(result);
  const gridClass = isPoi
    ? "sm:grid-cols-[0.9fr_1fr_1fr_auto_auto]"
    : "sm:grid-cols-[0.95fr_1.05fr_1.05fr_auto_auto_auto]";

  return (
    <div className="space-y-5">
      <section
        className={`rounded-[1.5rem] border p-5 shadow-[0_18px_40px_rgba(34,31,23,0.08)] sm:rounded-[1.8rem] sm:p-6 ${getStatusPanelClass(
          result.review_status,
        )}`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em]">종합평가</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold sm:text-3xl">{result.review_status}</h2>
          <span className="rounded-full border border-current/25 bg-white/45 px-4 py-1.5 text-sm font-semibold">
            {result.review_status}
          </span>
        </div>
        {result.review_status !== "정상" && statusReasons.length ? (
          <div className="mt-4 space-y-2">
            {statusReasons.map((reason) => (
              <p key={reason} className="text-sm leading-6 text-current/85 sm:text-[15px]">
                {reason}
              </p>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-[1.5rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6">
        <div
          className={`grid gap-3 border-b border-stone-200/70 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 ${gridClass}`}
        >
          <p>항목</p>
          <p>표준화 항목</p>
          <p>로컬 항목</p>
          <p className="sm:text-right">이름 정합성</p>
          {!isPoi ? <p className="sm:text-right">조회</p> : null}
          <p className="sm:text-right">Confidence</p>
        </div>

        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <ResultRow key={row.label} row={row} variant={isPoi ? "poi" : "por"} />
          ))}
        </div>
      </section>
    </div>
  );
}

function getStatusPanelClass(reviewStatus: VerificationResult["review_status"]) {
  if (reviewStatus === "불가") {
    return "border-rose-300 bg-rose-100/90 text-rose-950";
  }

  if (reviewStatus === "검토") {
    return "border-amber-300 bg-amber-100/90 text-amber-950";
  }

  return "border-emerald-300 bg-emerald-100/90 text-emerald-950";
}

function buildPoiRows(result: PoiVerificationResult): DetailRow[] {
  const standardizedNames = deriveStandardizedNames(
    result.user_input_english_name,
    isJapaneseIssuedCountry(result),
  );
  const nameConsistency = deriveNameConsistency(result, standardizedNames);

  return [
    {
      label: "Document type",
      standardizedValue: result.document_type,
      localValue: result.local_document_type,
      confidence: result.document_type_confidence,
    },
    {
      label: "Document number",
      standardizedValue: result.document_number,
      localValue: result.local_document_number,
      confidence: result.document_number_confidence,
    },
    {
      label: "Issued country",
      standardizedValue: result.issued_country,
      localValue: result.local_issued_country,
      confidence: result.issued_country_confidence,
    },
    {
      label: "Date of expiry",
      standardizedValue: result.date_of_expiry,
      localValue: result.local_date_of_expiry,
      confidence: result.date_of_expiry_confidence,
    },
    {
      label: "First name",
      standardizedValue: standardizedNames.firstName,
      localValue: result.local_first_name,
      confidence: getDisplayedNameOcrConfidence(
        result.local_first_name,
        result.local_first_name_confidence,
        standardizedNames.firstName,
        result.first_name_confidence,
      ),
      nameConsistency: nameConsistency.firstName,
    },
    {
      label: "Last name",
      standardizedValue: standardizedNames.lastName,
      localValue: result.local_last_name,
      confidence: getDisplayedNameOcrConfidence(
        result.local_last_name,
        result.local_last_name_confidence,
        standardizedNames.lastName,
        result.last_name_confidence,
      ),
      nameConsistency: nameConsistency.lastName,
    },
    {
      label: "Middle name",
      standardizedValue: standardizedNames.middleName,
      localValue: result.local_middle_name,
      confidence: getDisplayedNameOcrConfidence(
        result.local_middle_name,
        result.local_middle_name_confidence,
        standardizedNames.middleName,
        result.middle_name_confidence,
      ),
      nameConsistency: nameConsistency.middleName,
    },
    {
      label: "Gender",
      standardizedValue: result.gender,
      localValue: result.local_gender,
      confidence: result.gender_confidence,
    },
    {
      label: "Date of birth",
      standardizedValue: result.date_of_birth,
      localValue: result.local_date_of_birth,
      confidence: result.date_of_birth_confidence,
    },
    {
      label: "Place of birth",
      standardizedValue: result.place_of_birth,
      localValue: result.local_place_of_birth,
      confidence: result.place_of_birth_confidence,
    },
    {
      label: "Nationality",
      standardizedValue: result.nationality,
      localValue: result.local_nationality,
      confidence: result.nationality_confidence,
    },
  ];
}

function buildPorRows(result: PorVerificationResult): DetailRow[] {
  const standardizedNames = deriveStandardizedNames(
    result.user_input_english_name,
    isJapaneseIssuedCountry(result),
  );
  const nameConsistency = deriveNameConsistency(result, standardizedNames);

  return [
    {
      label: "Document type",
      standardizedValue: result.document_type,
      localValue: result.local_document_type,
      confidence: result.document_type_confidence,
    },
    {
      label: "Document number",
      standardizedValue: result.document_number,
      localValue: result.local_document_number,
      confidence: result.document_number_confidence,
    },
    {
      label: "Issued country",
      standardizedValue: result.issued_country,
      localValue: result.local_issued_country,
      confidence: result.issued_country_confidence,
    },
    {
      label: "Date of expiry",
      standardizedValue: result.date_of_expiry,
      localValue: result.local_date_of_expiry,
      confidence: result.date_of_expiry_confidence,
    },
    {
      label: "First name",
      standardizedValue: standardizedNames.firstName,
      localValue: result.local_first_name,
      confidence: getDisplayedNameOcrConfidence(
        result.local_first_name,
        result.local_first_name_confidence,
        standardizedNames.firstName,
        result.first_name_confidence,
      ),
      nameConsistency: nameConsistency.firstName,
    },
    {
      label: "Last name",
      standardizedValue: standardizedNames.lastName,
      localValue: result.local_last_name,
      confidence: getDisplayedNameOcrConfidence(
        result.local_last_name,
        result.local_last_name_confidence,
        standardizedNames.lastName,
        result.last_name_confidence,
      ),
      nameConsistency: nameConsistency.lastName,
    },
    {
      label: "Middle name",
      standardizedValue: standardizedNames.middleName,
      localValue: result.local_middle_name,
      confidence: getDisplayedNameOcrConfidence(
        result.local_middle_name,
        result.local_middle_name_confidence,
        standardizedNames.middleName,
        result.middle_name_confidence,
      ),
      nameConsistency: nameConsistency.middleName,
    },
    {
      label: "Country",
      standardizedValue: result.country,
      localValue: result.local_country,
      confidence: result.country_confidence,
    },
    {
      label: "State",
      standardizedValue: result.state,
      localValue: result.local_state,
      confidence: result.state_confidence,
    },
    {
      label: "City",
      standardizedValue: result.city,
      localValue: result.local_city,
      confidence: result.city_confidence,
    },
    {
      label: "Address 1",
      standardizedValue: result.address_1,
      localValue: result.local_address_1,
      confidence: result.address_1_confidence,
    },
    {
      label: "Address 2",
      standardizedValue: result.address_2,
      localValue: result.local_address_2,
      confidence: result.address_2_confidence,
    },
    {
      label: "Postal code",
      standardizedValue: result.postal_code,
      localValue: result.local_postal_code,
      confidence: getDisplayedPostalCodeConfidence(result),
      lookupSource: getPostalCodeLookupSourceLabel(result),
    },
  ];
}

function getPostalCodeLookupSourceLabel(result: PorVerificationResult) {
  if (!result.postal_code) {
    return null;
  }

  if (result.postal_code_source === "ocr") {
    return "OCR";
  }

  if (result.postal_code_source === "lookup") {
    return "조회";
  }

  return null;
}

function ResultRow({
  row,
  variant,
}: {
  row: DetailRow;
  variant: "poi" | "por";
}) {
  const isPoi = variant === "poi";
  const gridClass = isPoi
    ? "sm:grid-cols-[0.9fr_1fr_1fr_auto_auto]"
    : "sm:grid-cols-[0.95fr_1.05fr_1.05fr_auto_auto_auto]";

  return (
    <div
      className={`grid gap-3 rounded-[1.15rem] border border-stone-200/70 bg-white/85 p-3.5 shadow-[0_14px_34px_rgba(36,33,25,0.06)] sm:items-start sm:rounded-[1.35rem] sm:p-4 ${gridClass}`}
    >
      <div>
        <p className="text-sm font-semibold text-stone-900">{row.label}</p>
      </div>

      <div>
        <p className="text-sm leading-7 text-stone-700">
          {row.standardizedValue || <span className="text-stone-400">값 없음</span>}
        </p>
      </div>

      <div>
        <p className="text-sm leading-7 text-stone-700">
          {formatLocalDisplayValue(row) || <span className="text-stone-400">값 없음</span>}
        </p>
      </div>

      <div className="justify-self-start sm:justify-self-end">
        {typeof row.nameConsistency === "number" ? (
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClasses[getConfidenceTone(
              row.nameConsistency,
            )]}`}
          >
            {formatConfidence(row.nameConsistency)}
          </span>
        ) : (
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${neutralBadgeClass}`}
          >
            -
          </span>
        )}
      </div>

      {!isPoi ? (
        <div className="justify-self-start sm:justify-self-end">
          {row.lookupSource === "OCR" ? (
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${sourceClasses.ocr}`}
            >
              OCR
            </span>
          ) : row.lookupSource === "조회" ? (
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${sourceClasses.lookup}`}
            >
              조회
            </span>
          ) : (
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${neutralBadgeClass}`}
            >
              -
            </span>
          )}
        </div>
      ) : null}

      <div className="justify-self-start sm:justify-self-end">
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClasses[getConfidenceTone(
            row.confidence,
          )]}`}
        >
          {formatConfidence(row.confidence)}
        </span>
      </div>
    </div>
  );
}

function deriveStandardizedNames(
  userInputEnglishName: string,
  shouldUppercaseNames: boolean,
) {
  return applyJapanesePoiNameCasing(
    splitRomanizedPoiFullName(userInputEnglishName, false),
    shouldUppercaseNames,
  );
}

function deriveNameConsistency(
  result: PoiVerificationResult | PorVerificationResult,
  standardizedNames: { firstName: string; middleName: string; lastName: string },
) {
  const shouldUppercaseNames = isJapaneseIssuedCountry(result);
  const bestScores: { firstName: number | null; middleName: number | null; lastName: number | null } =
    {
      firstName: null,
      middleName: null,
      lastName: null,
    };

  const firstNameCandidates = collectNameConsistencyCandidates(result, "firstName");
  const middleNameCandidates = collectNameConsistencyCandidates(result, "middleName");
  const lastNameCandidates = collectNameConsistencyCandidates(result, "lastName");

  bestScores.firstName = scoreNameCandidatesAgainstStandardized(
    standardizedNames.firstName,
    firstNameCandidates,
    shouldUppercaseNames,
    "firstName",
  );
  bestScores.middleName = scoreNameCandidatesAgainstStandardized(
    standardizedNames.middleName,
    middleNameCandidates,
    shouldUppercaseNames,
    "middleName",
  );
  bestScores.lastName = scoreNameCandidatesAgainstStandardized(
    standardizedNames.lastName,
    lastNameCandidates,
    shouldUppercaseNames,
    "lastName",
  );

  return {
    firstName: bestScores.firstName,
    lastName: bestScores.lastName,
    middleName: bestScores.middleName,
  };
}

function collectNameConsistencyCandidates(
  result: PoiVerificationResult | PorVerificationResult,
  field: "firstName" | "middleName" | "lastName",
) {
  const fieldCandidates =
    field === "firstName"
      ? result.first_name_romanization_candidates
      : field === "middleName"
        ? result.middle_name_romanization_candidates
        : result.last_name_romanization_candidates;
  const fieldStandardizedValue =
    field === "firstName"
      ? result.first_name
      : field === "middleName"
        ? result.middle_name
        : result.last_name;

  const baseCandidates = uniqueNameList([
    result.romanization_primary_full_name,
    ...result.romanization_alternatives,
    fieldStandardizedValue,
    ...fieldCandidates,
  ]);

  const expandedCandidates: string[] = [];

  for (const candidate of baseCandidates) {
    const candidateSplits = [
      splitRomanizedPoiFullName(candidate, false),
      splitRomanizedPoiFullName(candidate, true),
    ];

    expandedCandidates.push(candidate);

    for (const candidateSplit of candidateSplits) {
      const selectedValue =
        field === "firstName"
          ? candidateSplit.firstName
          : field === "middleName"
            ? candidateSplit.middleName
            : candidateSplit.lastName;

      if (selectedValue) {
        expandedCandidates.push(selectedValue);
      }
    }
  }

  return uniqueNameList(expandedCandidates).map((candidate) =>
    applyJapanesePoiNameCasing(
      {
        firstName: field === "firstName" ? candidate : "",
        middleName: field === "middleName" ? candidate : "",
        lastName: field === "lastName" ? candidate : "",
      },
      false,
    ),
  );
}

function scoreNameCandidatesAgainstStandardized(
  standardizedValue: string,
  candidates: Array<{ firstName: string; middleName: string; lastName: string }>,
  shouldUppercaseNames: boolean,
  field: "firstName" | "middleName" | "lastName",
) {
  let bestScore: number | null = null;

  for (const candidate of candidates) {
    const normalizedCandidate = applyJapanesePoiNameCasing(candidate, shouldUppercaseNames);
    const candidateValue =
      field === "firstName"
        ? normalizedCandidate.firstName
        : field === "middleName"
          ? normalizedCandidate.middleName
          : normalizedCandidate.lastName;

    bestScore = mergeNameConsistencyScore(
      bestScore,
      scoreNameConsistency(standardizedValue, candidateValue),
    );
  }

  return bestScore;
}

function buildStatusReasons(result: VerificationResult) {
  const warnings = result.warnings
    .map((warning) => warning.trim())
    .filter(Boolean);

  if (warnings.length) {
    return warnings;
  }

  if (result.review_status === "불가") {
    return result.kind === "poi"
      ? ["문서에서 이름 정보를 확인할 수 없어 사람이 확인해야 합니다."]
      : ["문서에서 주소 정보를 확인할 수 없어 사람이 확인해야 합니다."];
  }

  if (result.review_status === "검토") {
    return result.kind === "poi"
      ? ["OCR 정합도 또는 이름 로마자 판독이 불확실해 수동 검토가 필요합니다."]
      : ["OCR 정합도 또는 주소 분리가 불확실해 수동 검토가 필요합니다."];
  }

  return [];
}

function getDisplayedNameOcrConfidence(
  localValue: string,
  localConfidence: number,
  standardizedValue: string,
  standardizedConfidence: number,
) {
  if (localValue) {
    return localConfidence;
  }

  void standardizedValue;
  void standardizedConfidence;
  return 0;
}

function getDisplayedPostalCodeConfidence(result: PorVerificationResult) {
  if (result.postal_code_source === "ocr") {
    return result.postal_code_confidence;
  }

  return 0;
}

function scoreNameConsistency(standardizedValue: string, inputValue: string) {
  const normalizedStandardized = normalizeRomanizedField(standardizedValue);
  const normalizedInput = normalizeRomanizedField(inputValue);

  if (!normalizedStandardized && !normalizedInput) {
    return null;
  }

  if (!normalizedStandardized || !normalizedInput) {
    return 0;
  }

  if (normalizedStandardized === normalizedInput) {
    return 1;
  }

  if (
    collapseJapaneseRomanizationVariant(normalizedStandardized) ===
    collapseJapaneseRomanizationVariant(normalizedInput)
  ) {
    return 0.8;
  }

  return 0;
}

function mergeNameConsistencyScore(
  current: number | null,
  next: number | null,
) {
  if (current === null) {
    return next;
  }

  if (next === null) {
    return current;
  }

  return Math.max(current, next);
}

function normalizeRomanizedField(value: string) {
  return normalizeLooseText(value).replace(/\s+/g, "");
}

function collapseJapaneseRomanizationVariant(value: string) {
  return value
    .replace(/shi/g, "si")
    .replace(/chi/g, "ti")
    .replace(/tsu/g, "tu")
    .replace(/ji/g, "zi")
    .replace(/jya/g, "zya")
    .replace(/jyu/g, "zyu")
    .replace(/jyo/g, "zyo")
    .replace(/ou/g, "o")
    .replace(/oo/g, "o")
    .replace(/oh/g, "o");
}

function splitRomanizedPoiFullName(fullName: string, preferSurnameFirst: boolean) {
  const tokens = tokenizeRomanizedName(fullName);

  if (!tokens.length) {
    return { firstName: "", middleName: "", lastName: "" };
  }

  if (tokens.length === 1) {
    return { firstName: tokens[0] ?? "", middleName: "", lastName: "" };
  }

  if (preferSurnameFirst) {
    return {
      firstName: tokens.slice(1).join(" "),
      middleName: "",
      lastName: tokens[0] ?? "",
    };
  }

  return {
    firstName: tokens[0] ?? "",
    middleName: tokens.slice(1, -1).join(" "),
    lastName: tokens.at(-1) ?? "",
  };
}

function tokenizeRomanizedName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && hasLatinScript(token));
}

function hasLatinScript(value: string) {
  return /[\p{Script=Latin}]/u.test(value);
}

type JapaneseIssuedCountryLike = Pick<
  VerificationResult,
  "issued_country" | "local_issued_country" | "document_type" | "local_document_type"
>;

function isJapaneseIssuedCountry(result: JapaneseIssuedCountryLike) {
  const normalizedValues = [
    result.issued_country,
    result.local_issued_country,
    result.document_type,
    result.local_document_type,
  ]
    .map((value) => normalizeLooseText(value))
    .filter(Boolean);

  return normalizedValues.some((value) =>
    ["japan", "jp", "日本", "일본"].includes(value),
  );
}

function applyJapanesePoiNameCasing(
  value: { firstName: string; middleName: string; lastName: string },
  shouldUppercaseNames: boolean,
) {
  if (!shouldUppercaseNames) {
    return value;
  }

  return {
    firstName: value.firstName.toUpperCase(),
    middleName: value.middleName.toUpperCase(),
    lastName: value.lastName.toUpperCase(),
  };
}

function formatLocalDisplayValue(row: DetailRow) {
  return row.localValue?.trim() ?? "";
}
