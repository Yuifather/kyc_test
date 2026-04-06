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
  localReading?: string;
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
      label: "Local full name",
      value: "",
      localValue: result.local_full_name,
      localReading: result.local_full_name_furigana,
      confidence: result.local_full_name_confidence,
      note: "문서에서 보이는 경우 로컬 원문 전체 이름을 그대로 보존합니다.",
    },
    {
      label: "Gender",
      value: result.gender,
      localValue: result.local_gender,
      confidence: result.gender_confidence,
      note:
        result.gender_evidence || result.gender_notes
          ? `${result.gender_evidence || "직접 확인된 근거 문구가 없습니다."} ${result.gender_notes}`.trim()
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
      <ReviewStatusBanner status={result.review_status} />

      <section className="rounded-[1.6rem] border border-stone-200/80 bg-white/88 p-4 shadow-[0_22px_54px_rgba(34,31,23,0.08)] sm:rounded-[2rem] sm:p-6 sm:shadow-[0_28px_70px_rgba(34,31,23,0.08)]">
        <div className="mb-4 flex flex-col items-start gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-700 sm:text-xs sm:tracking-[0.28em]">
              POI 이름 매칭 결과
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
            eyebrow="사용자 입력"
            title={result.user_input_english_name || "입력값 없음"}
            body="사용자가 입력한 영문 전체 이름입니다."
          />
          <InfoCard
            eyebrow="주 영문화 이름"
            title={result.romanization_primary_full_name || "신뢰도 있게 추출되지 않았습니다."}
            body={result.romanization_notes || "추가 영문화 메모가 없습니다."}
          />
        </div>

        <div className="mt-4 rounded-[1.2rem] border border-stone-200/70 bg-stone-50/90 p-4 sm:mt-5 sm:rounded-[1.5rem]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
            대체 영문화 후보
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
                대체 영문화 후보가 반환되지 않았습니다.
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-[1.2rem] border border-stone-200/70 bg-teal-50/80 p-4 sm:mt-5 sm:rounded-[1.5rem]">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700">
            판단 사유
          </p>
          <p className="mt-2 text-sm leading-7 text-stone-700">{result.name_match_reason}</p>
        </div>
      </section>

      <CommonResultPanels
        result={result}
        primaryMetrics={[
          { label: "Issued country", value: result.issued_country || "미확인" },
          { label: "Document type", value: result.document_type || "미확인" },
        ]}
        secondaryMetrics={[
          { label: "이름 매칭", value: formatConfidence(result.name_match_confidence) },
          { label: "최종 판정", value: result.review_status },
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
      note: `우편번호 출처: ${formatPostalCodeSource(result.postal_code_source)}.`,
    },
    {
      label: "Local full address",
      value: "",
      localValue: result.local_full_address,
      confidence: result.local_full_address_confidence,
      note:
        result.address_notes || "문서에서 보이는 경우 로컬 OCR 전체 주소를 그대로 보존합니다.",
    },
  ];

  return (
    <div className="space-y-6">
      <ReviewStatusBanner status={result.review_status} />

      <section className="rounded-[1.6rem] border border-stone-200/80 bg-white/88 p-4 shadow-[0_22px_54px_rgba(34,31,23,0.08)] sm:rounded-[2rem] sm:p-6 sm:shadow-[0_28px_70px_rgba(34,31,23,0.08)]">
        <div className="mb-4 flex flex-col items-start gap-3 sm:mb-5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-700 sm:text-xs sm:tracking-[0.28em]">
              POR 주소 추출 결과
            </p>
            <h2 className="mt-2 break-words text-xl font-semibold text-stone-950 sm:text-3xl">
              {result.country && result.state && result.city
                ? "주소 분리 완료"
                : "주소 재검토 필요"}
            </h2>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <StatusBadge tone={getConfidenceTone(result.overall_confidence)}>
              {getConfidenceLabel(result.overall_confidence)}{" "}
              {formatConfidence(result.overall_confidence)}
            </StatusBadge>
            <StatusBadge tone={getConfidenceTone(result.postal_code_confidence)}>
              우편번호 {formatConfidence(result.postal_code_confidence)}
            </StatusBadge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_1.25fr]">
          <InfoCard
            eyebrow="표준화 주소"
            title={
              [result.country, result.state, result.city].filter(Boolean).join(" / ") ||
              "신뢰도 있게 분리되지 않았습니다."
            }
            body={
              [result.address_1, result.address_2].filter(Boolean).join(" ") ||
              "표준화된 주소 라인이 반환되지 않았습니다."
            }
          />
          <InfoCard
            eyebrow="우편번호"
            title={result.postal_code || "확인되지 않음"}
            body={`출처: ${formatPostalCodeSource(result.postal_code_source)}. ${
              result.address_notes || "추가 주소 분리 메모가 없습니다."
            }`}
          />
        </div>
      </section>

      <CommonResultPanels
        result={result}
        primaryMetrics={[
          { label: "Issued country", value: result.issued_country || "미확인" },
          { label: "Document type", value: result.document_type || "미확인" },
        ]}
        secondaryMetrics={[
          {
            label: "우편번호 출처",
            value: formatPostalCodeSource(result.postal_code_source),
          },
          { label: "최종 판정", value: result.review_status },
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
                문서 품질
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
                전체 추출 신뢰도
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
              상세 추출 결과
            </p>
            <h3 className="mt-2 text-xl font-semibold text-stone-950">
              표준화 값과 로컬 OCR 값
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
                  표준화
                </p>
                <p className="mt-1 text-sm leading-7 text-stone-700">
                  {row.value || (
                    <span className="text-stone-400">신뢰도 있게 추출되지 않았습니다.</span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                  로컬 OCR
                </p>
                <p className="mt-1 text-sm leading-7 text-stone-700">
                  {row.localValue || (
                    <span className="text-stone-400">로컬 OCR 값이 없습니다.</span>
                  )}
                </p>
                {row.localReading ? (
                  <p className="mt-1 text-xs leading-6 text-stone-500">
                    후리가나: {row.localReading}
                  </p>
                ) : null}
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

function ReviewStatusBanner({
  status,
}: {
  status: VerificationResult["review_status"];
}) {
  const tone = getReviewStatusTone(status);

  return (
    <div
      className={`rounded-[1.2rem] border p-4 text-sm shadow-[0_18px_40px_rgba(34,31,23,0.08)] sm:rounded-[1.5rem] ${getReviewStatusBannerClasses(
        tone,
      )}`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em]">최종 판정</p>
      <p className="mt-2 text-base font-semibold sm:text-lg">{status}</p>
      <p className="mt-2 leading-7">{getReviewStatusDescription(status)}</p>
    </div>
  );
}

function WarningsPanel({ warnings }: { warnings: string[] }) {
  return (
    <section className="rounded-[1.4rem] border border-stone-200/70 bg-white/88 p-4 shadow-[0_18px_45px_rgba(34,31,23,0.07)] sm:rounded-[1.8rem] sm:p-6 sm:shadow-[0_22px_55px_rgba(34,31,23,0.07)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
        경고
      </p>
      <h3 className="mt-2 text-xl font-semibold text-stone-950">검토 메모</h3>
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
            이 문서에 대한 추가 경고는 없습니다.
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
      return "Japan Post 조회";
    case "none":
    default:
      return "확인되지 않음";
  }
}

function getReviewStatusTone(status: VerificationResult["review_status"]): ConfidenceTone {
  switch (status) {
    case "사람이 확인 안해도 괜찮다":
      return "good";
    case "사람이 확인해야하는 문서다":
      return "review";
    case "이건 무조건 잘못된 문서다":
    default:
      return "low";
  }
}

function getReviewStatusBannerClasses(tone: ConfidenceTone) {
  switch (tone) {
    case "good":
      return "border-emerald-300/80 bg-emerald-100/90 text-emerald-950";
    case "review":
      return "border-amber-300/80 bg-amber-100/90 text-amber-950";
    case "low":
    default:
      return "border-rose-300/80 bg-rose-100/90 text-rose-950";
  }
}

function getReviewStatusDescription(status: VerificationResult["review_status"]) {
  switch (status) {
    case "사람이 확인 안해도 괜찮다":
      return "핵심 OCR 필드가 비교적 안정적으로 추출되어 추가 확인 없이 진행 가능한 상태입니다.";
    case "사람이 확인해야하는 문서다":
      return "문서는 읽혔지만 일부 핵심 필드나 신뢰도가 경계선이어서 사람이 한 번 확인하는 편이 안전합니다.";
    case "이건 무조건 잘못된 문서다":
    default:
      return "핵심 필드가 비어 있거나 결과가 서로 모순되어 현재 상태로는 올바른 문서로 보기 어렵습니다.";
  }
}
