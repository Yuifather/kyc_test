import {
  formatConfidence,
  getConfidenceLabel,
  getConfidenceTone,
  getMatchLabel,
  getMatchTone,
} from "@/lib/confidence";
import type {
  ConfidenceTone,
  PoiVerificationResult,
  PorVerificationResult,
  VerificationResult,
} from "@/types/verification";

const toneClasses: Record<ConfidenceTone, string> = {
  low: "border-rose-200 bg-rose-100 text-rose-800",
  review: "border-amber-200 bg-amber-100 text-amber-900",
  good: "border-emerald-200 bg-emerald-100 text-emerald-900",
};

const rowBaseClass =
  "grid gap-3 rounded-[1.1rem] border border-stone-200/70 bg-white/85 p-3.5 shadow-[0_14px_34px_rgba(36,33,25,0.06)] sm:grid-cols-[1.1fr_1.1fr_1.2fr_auto] sm:rounded-[1.35rem] sm:p-4 sm:shadow-[0_16px_40px_rgba(36,33,25,0.06)]";

interface DetailRow {
  label: string;
  value: string;
  localValue?: string;
  confidence: number;
  note?: string;
}

export function VerificationResults({ result }: { result: VerificationResult }) {
  return result.kind === "poi" ? (
    <PoiResults result={result} />
  ) : (
    <PorResults result={result} />
  );
}

function PoiResults({ result }: { result: PoiVerificationResult }) {
  const detailRows: DetailRow[] = [
    {
      label: "Document type",
      value: result.document_type,
      localValue: result.local_document_type,
      confidence: result.document_type_confidence,
    },
    {
      label: "Document number",
      value: result.document_number,
      localValue: result.local_document_number,
      confidence: result.document_number_confidence,
    },
    {
      label: "Issued country",
      value: result.issued_country,
      localValue: result.local_issued_country,
      confidence: result.issued_country_confidence,
    },
    {
      label: "Date of expiry",
      value: result.date_of_expiry,
      localValue: result.local_date_of_expiry,
      confidence: result.date_of_expiry_confidence,
    },
    {
      label: "First name",
      value: result.first_name,
      localValue: result.local_first_name,
      confidence: result.first_name_confidence,
    },
    {
      label: "Last name",
      value: result.last_name,
      localValue: result.local_last_name,
      confidence: result.last_name_confidence,
    },
    {
      label: "Middle name",
      value: result.middle_name,
      localValue: result.local_middle_name,
      confidence: result.middle_name_confidence,
    },
    {
      label: "Local full name",
      value: "",
      localValue: result.local_full_name,
      confidence: result.local_full_name_confidence,
      note: "Preserved local-script full name when visible on the document.",
    },
    {
      label: "Gender",
      value: result.gender,
      localValue: result.local_gender,
      confidence: result.gender_confidence,
      note:
        result.gender_evidence || result.gender_notes
          ? `${result.gender_evidence || "No direct evidence returned."} ${result.gender_notes}`.trim()
          : "",
    },
    {
      label: "Date of birth",
      value: result.date_of_birth,
      localValue: result.local_date_of_birth,
      confidence: result.date_of_birth_confidence,
    },
    {
      label: "Place of birth",
      value: result.place_of_birth,
      localValue: result.local_place_of_birth,
      confidence: result.place_of_birth_confidence,
    },
    {
      label: "Nationality",
      value: result.nationality,
      localValue: result.local_nationality,
      confidence: result.nationality_confidence,
    },
  ];

  return (
    <div className="space-y-6">
      <ManualReviewBanner required={result.manual_review_required} />

      <section className="rounded-[1.6rem] border border-stone-200/80 bg-white/88 p-4 shadow-[0_22px_54px_rgba(34,31,23,0.08)] sm:rounded-[2rem] sm:p-6 sm:shadow-[0_28px_70px_rgba(34,31,23,0.08)]">
        <div className="mb-4 flex flex-col items-start gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-700 sm:text-xs sm:tracking-[0.28em]">
              POI name match verdict
            </p>
            <h2 className="mt-2 break-words text-xl font-semibold text-stone-950 sm:text-3xl">
              {getMatchLabel(result.name_match_result)}
            </h2>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <StatusBadge tone={getMatchTone(result.name_match_result)}>
              {getMatchLabel(result.name_match_result)}
            </StatusBadge>
            <StatusBadge tone={getConfidenceTone(result.name_match_confidence)}>
              {getConfidenceLabel(result.name_match_confidence)}{" "}
              {formatConfidence(result.name_match_confidence)}
            </StatusBadge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_1.2fr]">
          <InfoCard
            eyebrow="User input"
            title={result.user_input_english_name || "Not provided"}
            body="English full name entered by the user."
          />
          <InfoCard
            eyebrow="Primary romanization"
            title={result.romanization_primary_full_name || "Not confidently extracted"}
            body={result.romanization_notes || "No extra romanization notes returned."}
          />
        </div>

        <div className="mt-4 rounded-[1.2rem] border border-stone-200/70 bg-stone-50/90 p-4 sm:mt-5 sm:rounded-[1.5rem]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
            Alternatives
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result.romanization_alternatives.length ? (
              result.romanization_alternatives.map((value) => (
                <span
                  key={value}
                  className="rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-stone-700"
                >
                  {value}
                </span>
              ))
            ) : (
              <span className="text-sm text-stone-500">
                No alternative romanizations were returned.
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-[1.2rem] border border-stone-200/70 bg-teal-50/80 p-4 sm:mt-5 sm:rounded-[1.5rem]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
            Reason
          </p>
          <p className="mt-2 text-sm leading-7 text-stone-700">{result.name_match_reason}</p>
        </div>
      </section>

      <CommonResultPanels
        result={result}
        primaryMetrics={[
          { label: "Issued country", value: result.issued_country || "Unknown" },
          { label: "Document type", value: result.document_type || "Unknown" },
        ]}
        secondaryMetrics={[
          { label: "Name match", value: formatConfidence(result.name_match_confidence) },
          {
            label: "Manual review",
            value: result.manual_review_required ? "Required" : "Not required",
          },
        ]}
        detailRows={detailRows}
      />

      <WarningsPanel warnings={result.warnings} />
    </div>
  );
}

function PorResults({ result }: { result: PorVerificationResult }) {
  const detailRows: DetailRow[] = [
    {
      label: "Document type",
      value: result.document_type,
      localValue: result.local_document_type,
      confidence: result.document_type_confidence,
    },
    {
      label: "Document number",
      value: result.document_number,
      localValue: result.local_document_number,
      confidence: result.document_number_confidence,
    },
    {
      label: "Issued country",
      value: result.issued_country,
      localValue: result.local_issued_country,
      confidence: result.issued_country_confidence,
    },
    {
      label: "Date of expiry",
      value: result.date_of_expiry,
      localValue: result.local_date_of_expiry,
      confidence: result.date_of_expiry_confidence,
    },
    {
      label: "Country",
      value: result.country,
      localValue: result.local_country,
      confidence: result.country_confidence,
    },
    {
      label: "State",
      value: result.state,
      localValue: result.local_state,
      confidence: result.state_confidence,
    },
    {
      label: "City",
      value: result.city,
      localValue: result.local_city,
      confidence: result.city_confidence,
    },
    {
      label: "Address 1",
      value: result.address_1,
      localValue: result.local_address_1,
      confidence: result.address_1_confidence,
    },
    {
      label: "Address 2",
      value: result.address_2,
      localValue: result.local_address_2,
      confidence: result.address_2_confidence,
    },
    {
      label: "Postal code",
      value: result.postal_code,
      localValue: result.local_postal_code,
      confidence: result.postal_code_confidence,
      note: `Postal code source: ${formatPostalCodeSource(result.postal_code_source)}.`,
    },
    {
      label: "Local full address",
      value: "",
      localValue: result.local_full_address,
      confidence: result.local_full_address_confidence,
      note: result.address_notes || "Preserved full local OCR address when visible.",
    },
  ];

  return (
    <div className="space-y-6">
      <ManualReviewBanner required={result.manual_review_required} />

      <section className="rounded-[1.6rem] border border-stone-200/80 bg-white/88 p-4 shadow-[0_22px_54px_rgba(34,31,23,0.08)] sm:rounded-[2rem] sm:p-6 sm:shadow-[0_28px_70px_rgba(34,31,23,0.08)]">
        <div className="mb-4 flex flex-col items-start gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-700 sm:text-xs sm:tracking-[0.28em]">
              POR address extraction
            </p>
            <h2 className="mt-2 break-words text-xl font-semibold text-stone-950 sm:text-3xl">
              {result.country && result.state && result.city
                ? "Address segmented"
                : "Address needs review"}
            </h2>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <StatusBadge tone={getConfidenceTone(result.overall_confidence)}>
              {getConfidenceLabel(result.overall_confidence)}{" "}
              {formatConfidence(result.overall_confidence)}
            </StatusBadge>
            <StatusBadge tone={getConfidenceTone(result.postal_code_confidence)}>
              Postal {formatConfidence(result.postal_code_confidence)}
            </StatusBadge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_1.25fr]">
          <InfoCard
            eyebrow="Standardized address"
            title={[result.country, result.state, result.city]
              .filter(Boolean)
              .join(" / ") || "Not confidently segmented"}
            body={
              [result.address_1, result.address_2].filter(Boolean).join(" ") ||
              "No standardized address lines were returned."
            }
          />
          <InfoCard
            eyebrow="Postal code"
            title={result.postal_code || "Not confirmed"}
            body={`Source: ${formatPostalCodeSource(result.postal_code_source)}. ${
              result.address_notes || "No extra address segmentation notes returned."
            }`}
          />
        </div>
      </section>

      <CommonResultPanels
        result={result}
        primaryMetrics={[
          { label: "Issued country", value: result.issued_country || "Unknown" },
          { label: "Document type", value: result.document_type || "Unknown" },
        ]}
        secondaryMetrics={[
          {
            label: "Postal code source",
            value: formatPostalCodeSource(result.postal_code_source),
          },
          {
            label: "Manual review",
            value: result.manual_review_required ? "Required" : "Not required",
          },
        ]}
        detailRows={detailRows}
      />

      <WarningsPanel warnings={result.warnings} />
    </div>
  );
}

function CommonResultPanels({
  result,
  primaryMetrics,
  secondaryMetrics,
  detailRows,
}: {
  result: VerificationResult;
  primaryMetrics: Array<{ label: string; value: string }>;
  secondaryMetrics: Array<{ label: string; value: string }>;
  detailRows: DetailRow[];
}) {
  const qualityTone = getConfidenceTone(result.document_quality_confidence);
  const overallTone = getConfidenceTone(result.overall_confidence);

  return (
    <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr] lg:gap-6">
      <div className="space-y-6">
        <article className="rounded-[1.4rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6 sm:shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Document quality
              </p>
              <h3 className="mt-2 text-xl font-semibold text-stone-950">
                {formatConfidence(result.document_quality_confidence)}
              </h3>
            </div>
            <StatusBadge tone={qualityTone}>
              {getConfidenceLabel(result.document_quality_confidence)}
            </StatusBadge>
          </div>

          <p className="mt-4 text-sm leading-7 text-stone-700">
            {result.document_quality_notes}
          </p>

          <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2">
            {primaryMetrics.map((metric) => (
              <MiniMetric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
        </article>

        <article className="rounded-[1.4rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6 sm:shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Overall extraction confidence
              </p>
              <h3 className="mt-2 text-xl font-semibold text-stone-950">
                {formatConfidence(result.overall_confidence)}
              </h3>
            </div>
            <StatusBadge tone={overallTone}>
              {getConfidenceLabel(result.overall_confidence)}
            </StatusBadge>
          </div>

          <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2">
            {secondaryMetrics.map((metric) => (
              <MiniMetric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
        </article>
      </div>

      <article className="rounded-[1.4rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6 sm:shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Detailed extraction
            </p>
            <h3 className="mt-2 text-xl font-semibold text-stone-950">
              Standardized and local OCR fields
            </h3>
          </div>
        </div>

        <div className="mt-4 space-y-3 sm:mt-5">
          {detailRows.map((row) => (
            <div key={row.label} className={rowBaseClass}>
              <div>
                <p className="text-sm font-semibold text-stone-900">{row.label}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  Standardized
                </p>
                <p className="mt-1 text-sm leading-7 text-stone-700">
                  {row.value || (
                    <span className="text-stone-400">Not confidently extracted</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  Local OCR
                </p>
                <p className="mt-1 text-sm leading-7 text-stone-700">
                  {row.localValue || (
                    <span className="text-stone-400">No local OCR value</span>
                  )}
                </p>
                {row.note ? (
                  <p className="mt-1 text-xs leading-6 text-stone-500">{row.note}</p>
                ) : null}
              </div>
              <div className="justify-self-start sm:justify-self-end">
                <StatusBadge tone={getConfidenceTone(row.confidence)}>
                  {formatConfidence(row.confidence)}
                </StatusBadge>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function ManualReviewBanner({ required }: { required: boolean }) {
  if (!required) {
    return null;
  }

  return (
    <div className="rounded-[1.2rem] border border-amber-300/80 bg-amber-100/90 p-4 text-sm text-amber-950 shadow-[0_18px_40px_rgba(193,137,40,0.12)] sm:rounded-[1.5rem]">
      Manual review is recommended. One or more extracted fields remain uncertain.
    </div>
  );
}

function WarningsPanel({ warnings }: { warnings: string[] }) {
  return (
    <section className="rounded-[1.4rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6 sm:shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
        Warnings
      </p>
      <h3 className="mt-2 text-xl font-semibold text-stone-950">Review notes</h3>
      <div className="mt-4 space-y-3 sm:mt-5">
        {warnings.length ? (
          warnings.map((warning) => (
            <div
              key={warning}
              className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-950"
            >
              {warning}
            </div>
          ))
        ) : (
          <div className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-7 text-emerald-950">
            No additional warnings were generated for this document.
          </div>
        )}
      </div>
    </section>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: ConfidenceTone;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] sm:text-xs sm:tracking-[0.18em] ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

function InfoCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-stone-200/70 bg-stone-50/90 p-4 sm:rounded-[1.5rem]">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
        {eyebrow}
      </p>
      <p className="mt-2 break-words text-base font-semibold text-stone-950 sm:text-lg">
        {title}
      </p>
      <p className="mt-2 text-sm leading-7 text-stone-600">{body}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.1rem] border border-stone-200/70 bg-stone-50/90 p-4 sm:rounded-[1.3rem]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function formatPostalCodeSource(source: PorVerificationResult["postal_code_source"]) {
  switch (source) {
    case "ocr":
      return "OCR";
    case "lookup":
      return "Japan Post lookup";
    case "none":
    default:
      return "Not confirmed";
  }
}
