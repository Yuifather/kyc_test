import { formatConfidence, getConfidenceTone } from "@/lib/confidence";
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

const statusPanelClasses: Record<VerificationResult["review_status"], string> = {
  불가: "border-rose-300 bg-rose-100/90 text-rose-950",
  검토: "border-amber-300 bg-amber-100/90 text-amber-950",
  정상: "border-emerald-300 bg-emerald-100/90 text-emerald-950",
};

interface DetailRow {
  label: string;
  value: string;
  localValue?: string;
  localReading?: string;
  confidence: number;
}

export function VerificationResults({ result }: { result: VerificationResult }) {
  const rows = result.kind === "poi" ? buildPoiRows(result) : buildPorRows(result);

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
        <div className="grid gap-3 border-b border-stone-200/70 pb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 sm:grid-cols-[0.95fr_1.1fr_1.1fr_auto]">
          <p>항목</p>
          <p>OCR 항목</p>
          <p>로컬 항목</p>
          <p className="sm:text-right">Confidence</p>
        </div>

        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <ResultRow key={row.label} row={row} />
          ))}
        </div>
      </section>
    </div>
  );
}

function buildPoiRows(result: PoiVerificationResult): DetailRow[] {
  return [
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
      localReading: result.local_first_name_furigana,
      confidence: result.first_name_confidence,
    },
    {
      label: "Last name",
      value: result.last_name,
      localValue: result.local_last_name,
      localReading: result.local_last_name_furigana,
      confidence: result.last_name_confidence,
    },
    {
      label: "Middle name",
      value: result.middle_name,
      localValue: result.local_middle_name,
      localReading: result.local_middle_name_furigana,
      confidence: result.middle_name_confidence,
    },
    {
      label: "Gender",
      value: result.gender,
      localValue: result.local_gender,
      confidence: result.gender_confidence,
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
}

function buildPorRows(result: PorVerificationResult): DetailRow[] {
  return [
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
    },
  ];
}

function ResultRow({ row }: { row: DetailRow }) {
  return (
    <div className="grid gap-3 rounded-[1.15rem] border border-stone-200/70 bg-white/85 p-3.5 shadow-[0_14px_34px_rgba(36,33,25,0.06)] sm:grid-cols-[0.95fr_1.1fr_1.1fr_auto] sm:items-start sm:rounded-[1.35rem] sm:p-4">
      <div>
        <p className="text-sm font-semibold text-stone-900">{row.label}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          OCR 항목
        </p>
        <p className="mt-1 text-sm leading-7 text-stone-700">
          {row.value || <span className="text-stone-400">값 없음</span>}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
          로컬 항목
        </p>
        <p className="mt-1 text-sm leading-7 text-stone-700">
          {row.localValue || <span className="text-stone-400">값 없음</span>}
        </p>
        {row.localReading ? (
          <p className="mt-1 text-xs leading-6 text-stone-500">후리가나: {row.localReading}</p>
        ) : null}
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
