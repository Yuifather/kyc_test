import {
  formatConfidence,
  getConfidenceLabel,
  getConfidenceTone,
  getMatchLabel,
  getMatchTone,
} from "@/lib/confidence";
import type { ConfidenceTone, VerificationResult } from "@/types/verification";

const toneClasses: Record<ConfidenceTone, string> = {
  low: "border-rose-200 bg-rose-100 text-rose-800",
  review: "border-amber-200 bg-amber-100 text-amber-900",
  good: "border-emerald-200 bg-emerald-100 text-emerald-900",
};

const rowBaseClass =
  "grid gap-3 rounded-[1.35rem] border border-stone-200/70 bg-white/85 p-4 shadow-[0_16px_40px_rgba(36,33,25,0.06)] sm:grid-cols-[1.2fr_1.7fr_auto]";

export function VerificationResults({ result }: { result: VerificationResult }) {
  const detailRows = [
    {
      label: "First name",
      value: result.first_name,
      confidence: result.first_name_confidence,
    },
    {
      label: "Local first name",
      value: result.local_first_name,
      confidence: result.local_first_name_confidence,
    },
    {
      label: "Last name",
      value: result.last_name,
      confidence: result.last_name_confidence,
    },
    {
      label: "Local last name",
      value: result.local_last_name,
      confidence: result.local_last_name_confidence,
    },
    {
      label: "Middle name",
      value: result.middle_name,
      confidence: result.middle_name_confidence,
    },
    {
      label: "Local middle name",
      value: result.local_middle_name,
      confidence: result.local_middle_name_confidence,
    },
    {
      label: "Gender",
      value: result.gender,
      confidence: result.gender_confidence,
      note:
        result.gender_evidence || result.gender_notes
          ? `${result.gender_evidence || "No direct evidence returned."} ${result.gender_notes}`.trim()
          : "",
    },
    {
      label: "Date of birth",
      value: result.date_of_birth,
      confidence: result.date_of_birth_confidence,
    },
    {
      label: "Place of birth",
      value: result.place_of_birth,
      confidence: result.place_of_birth_confidence,
    },
    {
      label: "Nationality",
      value: result.nationality,
      confidence: result.nationality_confidence,
    },
  ];

  const qualityTone = getConfidenceTone(result.document_quality_confidence);
  const overallTone = getConfidenceTone(result.overall_confidence);
  const matchTone = getMatchTone(result.name_match_result);

  return (
    <div className="space-y-6">
      {result.manual_review_required ? (
        <div className="rounded-[1.5rem] border border-amber-300/80 bg-amber-100/90 p-4 text-sm text-amber-950 shadow-[0_18px_40px_rgba(193,137,40,0.12)]">
          Manual review is recommended. One or more extracted fields remain uncertain.
        </div>
      ) : null}

      <section className="rounded-[2rem] border border-stone-200/80 bg-white/88 p-6 shadow-[0_28px_70px_rgba(34,31,23,0.08)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-700">
              Name Match Verdict
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950 sm:text-3xl">
              {getMatchLabel(result.name_match_result)}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone={matchTone}>{getMatchLabel(result.name_match_result)}</StatusBadge>
            <StatusBadge tone={getConfidenceTone(result.name_match_confidence)}>
              {getConfidenceLabel(result.name_match_confidence)} {formatConfidence(result.name_match_confidence)}
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

        <div className="mt-5 rounded-[1.5rem] border border-stone-200/70 bg-stone-50/90 p-4">
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

        <div className="mt-5 rounded-[1.5rem] border border-stone-200/70 bg-teal-50/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
            Reason
          </p>
          <p className="mt-2 text-sm leading-7 text-stone-700">
            {result.name_match_reason}
          </p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <article className="rounded-[1.8rem] border border-stone-200/70 bg-white/88 p-6 shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
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

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MiniMetric
                label="Country detected"
                value={result.country_detected || "Unknown"}
              />
              <MiniMetric
                label="Document type"
                value={result.document_type_detected || "Unknown"}
              />
            </div>
          </article>

          <article className="rounded-[1.8rem] border border-stone-200/70 bg-white/88 p-6 shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
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

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <MiniMetric
                label="Name match"
                value={formatConfidence(result.name_match_confidence)}
              />
              <MiniMetric
                label="Manual review"
                value={result.manual_review_required ? "Required" : "Not required"}
              />
            </div>
          </article>
        </div>

        <article className="rounded-[1.8rem] border border-stone-200/70 bg-white/88 p-6 shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Detailed extraction
              </p>
              <h3 className="mt-2 text-xl font-semibold text-stone-950">
                Field-by-field confidence
              </h3>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {detailRows.map((row) => (
              <div key={row.label} className={rowBaseClass}>
                <div>
                  <p className="text-sm font-semibold text-stone-900">{row.label}</p>
                </div>
                <div>
                  <p className="text-sm leading-7 text-stone-700">
                    {row.value || (
                      <span className="text-stone-400">Not confidently extracted</span>
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

      <section className="rounded-[1.8rem] border border-stone-200/70 bg-white/88 p-6 shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
          Warnings
        </p>
        <h3 className="mt-2 text-xl font-semibold text-stone-950">
          Review notes
        </h3>
        <div className="mt-5 space-y-3">
          {result.warnings.length ? (
            result.warnings.map((warning) => (
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
    </div>
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
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClasses[tone]}`}
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
    <div className="rounded-[1.5rem] border border-stone-200/70 bg-stone-50/90 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
        {eyebrow}
      </p>
      <p className="mt-2 text-lg font-semibold text-stone-950">{title}</p>
      <p className="mt-2 text-sm leading-7 text-stone-600">{body}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.3rem] border border-stone-200/70 bg-stone-50/90 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}
