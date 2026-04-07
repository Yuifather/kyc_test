import { formatConfidence, getConfidenceTone } from "@/lib/confidence";
import { normalizeLooseText } from "@/lib/name-normalizer";
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

const neutralBadgeClass = "border-stone-200 bg-stone-100 text-stone-500";

const statusPanelClasses: Record<VerificationResult["review_status"], string> = {
  불가: "border-rose-300 bg-rose-100/90 text-rose-950",
  검토: "border-amber-300 bg-amber-100/90 text-amber-950",
  정상: "border-emerald-300 bg-emerald-100/90 text-emerald-950",
};

interface DetailRow {
  label: string;
  standardizedValue: string;
  localValue?: string;
  localReading?: string;
  confidence: number;
  nameConsistency?: number | null;
}

export function VerificationResults({ result }: { result: VerificationResult }) {
  const isPoi = result.kind === "poi";
  const rows = isPoi ? buildPoiRows(result) : buildPorRows(result);
  const gridClass = isPoi
    ? "sm:grid-cols-[0.9fr_1fr_1fr_auto_auto]"
    : "sm:grid-cols-[0.95fr_1.15fr_1.15fr_auto]";

  return (
    <div className="space-y-5">
      <section
        className={`rounded-[1.5rem] border p-5 shadow-[0_18px_40px_rgba(34,31,23,0.08)] sm:rounded-[1.8rem] sm:p-6 ${statusPanelClasses[result.review_status]}`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.22em]">종합평가</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold sm:text-3xl">{result.review_status}</h2>
          <span className="rounded-full border border-current/25 bg-white/45 px-4 py-1.5 text-sm font-semibold">
            {result.review_status}
          </span>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6">
        <div
          className={`grid gap-3 border-b border-stone-200/70 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 ${gridClass}`}
        >
          <p>항목</p>
          <p>표준화 항목</p>
          <p>로컬 항목</p>
          {isPoi ? <p className="sm:text-right">이름 정합성</p> : null}
          <p className="sm:text-right">Confidence</p>
        </div>

        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <ResultRow key={row.label} row={row} showNameConsistency={isPoi} />
          ))}
        </div>
      </section>
    </div>
  );
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
      localReading: result.local_first_name_furigana,
      confidence: result.first_name_confidence,
      nameConsistency: nameConsistency.firstName,
    },
    {
      label: "Last name",
      standardizedValue: standardizedNames.lastName,
      localValue: result.local_last_name,
      localReading: result.local_last_name_furigana,
      confidence: result.last_name_confidence,
      nameConsistency: nameConsistency.lastName,
    },
    {
      label: "Middle name",
      standardizedValue: standardizedNames.middleName,
      localValue: result.local_middle_name,
      localReading: result.local_middle_name_furigana,
      confidence: result.middle_name_confidence,
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
      confidence: result.postal_code_confidence,
    },
  ];
}

function ResultRow({
  row,
  showNameConsistency,
}: {
  row: DetailRow;
  showNameConsistency: boolean;
}) {
  const gridClass = showNameConsistency
    ? "sm:grid-cols-[0.9fr_1fr_1fr_auto_auto]"
    : "sm:grid-cols-[0.95fr_1.15fr_1.15fr_auto]";

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

      {showNameConsistency ? (
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

function derivePoiStandardizedNames(result: PoiVerificationResult) {
  const shouldUppercaseNames = isJapaneseIssuedCountry(result);
  const firstName = hasLatinScript(result.first_name) ? result.first_name : "";
  const lastName = hasLatinScript(result.last_name) ? result.last_name : "";
  const middleName = hasLatinScript(result.middle_name) ? result.middle_name : "";

  if (firstName || lastName || middleName) {
    return applyJapanesePoiNameCasing(
      {
        firstName,
        lastName,
        middleName,
      },
      shouldUppercaseNames,
    );
  }

  const fallbackFullName = pickRomanizedPoiFullName(result);

  if (!fallbackFullName) {
    return {
      firstName: "",
      middleName: "",
      lastName: "",
    };
  }

  return applyJapanesePoiNameCasing(
    splitRomanizedPoiFullName(fallbackFullName, result.user_input_english_name),
    shouldUppercaseNames,
  );
}

function derivePoiNameConsistency(
  result: PoiVerificationResult,
  standardizedNames: { firstName: string; middleName: string; lastName: string },
) {
  const inputName = splitInputName(result.user_input_english_name);

  return {
    firstName: scoreNameConsistency(standardizedNames.firstName, inputName.firstName),
    lastName: scoreNameConsistency(standardizedNames.lastName, inputName.lastName),
    middleName: scoreNameConsistency(standardizedNames.middleName, inputName.middleName),
  };
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

function splitInputName(value: string) {
  const tokens = tokenizeRomanizedName(value);

  if (!tokens.length) {
    return { firstName: "", middleName: "", lastName: "" };
  }

  if (tokens.length === 1) {
    return { firstName: tokens[0] ?? "", middleName: "", lastName: "" };
  }

  return {
    firstName: tokens[0] ?? "",
    middleName: tokens.slice(1, -1).join(" "),
    lastName: tokens.at(-1) ?? "",
  };
}

function pickRomanizedPoiFullName(result: PoiVerificationResult) {
  const candidates = [
    result.romanization_primary_full_name,
    ...result.romanization_alternatives,
    result.user_input_english_name,
  ];

  return candidates.find((value) => hasLatinScript(value))?.trim() ?? "";
}

function splitRomanizedPoiFullName(fullName: string, userInput: string) {
  const tokens = tokenizeRomanizedName(fullName);

  if (!tokens.length) {
    return { firstName: "", middleName: "", lastName: "" };
  }

  if (tokens.length === 1) {
    return { firstName: tokens[0] ?? "", middleName: "", lastName: "" };
  }

  const candidates = [
    {
      firstName: tokens[0] ?? "",
      middleName: tokens.slice(1, -1).join(" "),
      lastName: tokens.at(-1) ?? "",
    },
    {
      firstName: tokens.slice(1).join(" "),
      middleName: "",
      lastName: tokens[0] ?? "",
    },
    {
      firstName: tokens.at(-1) ?? "",
      middleName: tokens.slice(1, -1).join(" "),
      lastName: tokens[0] ?? "",
    },
  ];

  const normalizedUserInput = normalizeLooseText(userInput);

  if (!normalizedUserInput) {
    return candidates[0] ?? { firstName: "", middleName: "", lastName: "" };
  }

  return (
    [...candidates]
      .sort(
        (left, right) =>
          scoreRomanizedNameCandidate(right, normalizedUserInput) -
          scoreRomanizedNameCandidate(left, normalizedUserInput),
      )
      .at(0) ?? { firstName: "", middleName: "", lastName: "" }
  );
}

function scoreRomanizedNameCandidate(
  candidate: { firstName: string; middleName: string; lastName: string },
  normalizedUserInput: string,
) {
  const normalizedFullName = normalizeLooseText(
    [candidate.firstName, candidate.middleName, candidate.lastName]
      .filter(Boolean)
      .join(" "),
  );
  const normalizedWithoutMiddle = normalizeLooseText(
    [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
  );

  if (normalizedFullName && normalizedFullName === normalizedUserInput) {
    return 3;
  }

  if (normalizedWithoutMiddle && normalizedWithoutMiddle === normalizedUserInput) {
    return 2;
  }

  const userTokens = normalizedUserInput.split(" ").filter(Boolean).sort().join(" ");
  const candidateTokens = normalizedFullName.split(" ").filter(Boolean).sort().join(" ");

  if (userTokens && userTokens === candidateTokens) {
    return 1;
  }

  return 0;
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

  return normalizedValues.some((value) => ["japan", "jp", "日本"].includes(value));
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
  const localValue = row.localValue?.trim() ?? "";
  const localReading = row.localReading?.trim() ?? "";

  if (localValue && localReading) {
    return `${localValue} (${localReading})`;
  }

  return localValue || localReading;
}
