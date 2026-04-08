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
    : "sm:grid-cols-[0.95fr_1.1fr_1.1fr_auto_auto]";

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
          <p className="sm:text-right">{isPoi ? "이름 정합성" : "조회"}</p>
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
  const standardizedNames = derivePoiStandardizedNames(result);
  const nameConsistency = derivePoiNameConsistency(result, standardizedNames);

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
    : "sm:grid-cols-[0.95fr_1.1fr_1.1fr_auto_auto]";

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
        {isPoi ? (
          typeof row.nameConsistency === "number" ? (
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
          )
        ) : row.lookupSource === "OCR" ? (
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

function derivePoiStandardizedNames(result: PoiVerificationResult) {
  const shouldUppercaseNames = isJapaneseIssuedCountry(result);
  return applyJapanesePoiNameCasing(
    splitRomanizedPoiFullName(result.user_input_english_name, shouldUppercaseNames),
    shouldUppercaseNames,
  );
}

function derivePoiNameConsistency(
  result: PoiVerificationResult,
  standardizedNames: { firstName: string; middleName: string; lastName: string },
) {
  const shouldUppercaseNames = isJapaneseIssuedCountry(result);
  const romanizationCandidates = uniqueNameList([
    result.romanization_primary_full_name,
    ...result.romanization_alternatives,
  ]);

  const bestScores: { firstName: number | null; middleName: number | null; lastName: number | null } =
    {
      firstName: null,
      middleName: null,
      lastName: null,
    };

  for (const candidate of romanizationCandidates) {
    const candidateSplits = [
      splitRomanizedPoiFullName(candidate, false),
      splitRomanizedPoiFullName(candidate, true),
    ];

    for (const candidateSplit of candidateSplits) {
      const normalizedCandidate = applyJapanesePoiNameCasing(candidateSplit, shouldUppercaseNames);

      bestScores.firstName = mergeNameConsistencyScore(
        bestScores.firstName,
        scoreNameConsistency(standardizedNames.firstName, normalizedCandidate.firstName),
      );
      bestScores.middleName = mergeNameConsistencyScore(
        bestScores.middleName,
        scoreNameConsistency(standardizedNames.middleName, normalizedCandidate.middleName),
      );
      bestScores.lastName = mergeNameConsistencyScore(
        bestScores.lastName,
        scoreNameConsistency(standardizedNames.lastName, normalizedCandidate.lastName),
      );
    }
  }

  return {
    firstName: bestScores.firstName,
    lastName: bestScores.lastName,
    middleName: bestScores.middleName,
  };
}

function buildStatusReasons(result: VerificationResult) {
  return result.kind === "poi"
    ? buildPoiStatusReasons(result)
    : buildPorStatusReasons(result);
}

function buildPoiStatusReasons(result: PoiVerificationResult) {
  if (result.review_status === "검토") {
    return [buildPoiReviewSummary()];
  }

  if (result.review_status === "불가") {
    return ["문서로 보기 어렵거나 이름 정보가 확인되지 않아 사람이 확인해야 합니다."];
  }

  return [];
}

function buildPorStatusReasons(result: PorVerificationResult) {
  if (result.review_status === "검토") {
    return [buildPorReviewSummary()];
  }

  if (result.review_status === "불가") {
    return ["문서로 보기 어렵거나 주소 정보가 확인되지 않아 사람이 확인해야 합니다."];
  }

  return [];
}

function buildPoiReviewSummary() {
  return "이름 겹침은 크지만 영문화 표기가 다소 모호하다.";
}

function buildPorReviewSummary() {
  return "주소는 보이지만 OCR 표기가 다소 모호하다.";
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

function isJapaneseIssuedCountry(result: PoiVerificationResult) {
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
