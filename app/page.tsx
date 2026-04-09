"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { CountryCombobox } from "@/components/country-combobox";
import { VerificationResults } from "@/components/verification-results";
import { findCountryOption } from "@/lib/country-options";
import type { VerificationKind, VerificationResult } from "@/types/verification";

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
].join(",");

const POI_DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "선택하세요" },
  { value: "Passport", label: "Passport" },
  { value: "ID Card", label: "ID Card" },
  { value: "Driver's License", label: "Driver's License" },
  { value: "Other Document", label: "Other Document" },
];

const POR_DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "선택하세요" },
  {
    value: "Utility bill (e.g. electricity, water, gas, etc.)",
    label: "Utility bill (e.g. electricity water, gas, etc...)",
  },
  { value: "Bills", label: "Bills" },
  { value: "Bank account statement", label: "Bank account statement" },
  { value: "Credit card statement", label: "Credit card statement" },
  { value: "Residence permit", label: "Residence permit" },
  { value: "Residence certificate", label: "Residence certificate" },
  { value: "Tax bill", label: "Tax bill" },
  { value: "Tax return", label: "Tax return" },
  {
    value: "Any government issued document",
    label: "Any government issued document",
  },
  {
    value: "Passport, ID card, or driver's license (if showing address)",
    label: "Passport, ID card, or driver's license (if showing address)",
  },
  { value: "ID Card", label: "ID Card" },
  { value: "Driver's License", label: "Driver's License" },
  { value: "Other Document", label: "Other Document" },
];

const modeCopy: Record<
  VerificationKind,
  {
    eyebrow: string;
    title: string;
    description: string;
    buttonLabel: string;
  }
> = {
  poi: {
    eyebrow: "POI 검증",
    title: "신분증 OCR 결과를 이름 매칭, 로컬 원문 보존, 검토용 신뢰도와 함께 확인합니다.",
    description:
      "고객 영문 성명과 발급국가, Document type을 입력한 뒤 신분증 앞면과 선택형 뒷면 이미지를 업로드하세요.",
    buttonLabel: "POI 검증하기",
  },
  por: {
    eyebrow: "POR 검증",
    title: "주소지 증명 서류를 OCR로 읽고, 주소를 표준화하며, 필요하면 Japan Post 우편번호 조회까지 수행합니다.",
    description:
      "발급국가와 POR용 Document type을 선택하고 서류 이미지를 업로드하면 표준화 주소와 로컬 OCR 원문을 함께 추출합니다.",
    buttonLabel: "POR 검증하기",
  },
};

export default function Home() {
  const [verificationKind, setVerificationKind] = useState<VerificationKind>("poi");

  const [poiEnglishName, setPoiEnglishName] = useState("");
  const [poiIssuedCountry, setPoiIssuedCountry] = useState("");
  const [poiDocumentType, setPoiDocumentType] = useState("");
  const [frontImageFile, setFrontImageFile] = useState<File | null>(null);
  const [backImageFile, setBackImageFile] = useState<File | null>(null);
  const [frontPreviewUrl, setFrontPreviewUrl] = useState("");
  const [backPreviewUrl, setBackPreviewUrl] = useState("");

  const [porIssuedCountry, setPorIssuedCountry] = useState("");
  const [porEnglishName, setPorEnglishName] = useState("");
  const [porDocumentType, setPorDocumentType] = useState("");
  const [porDocumentFile, setPorDocumentFile] = useState<File | null>(null);
  const [porPreviewUrl, setPorPreviewUrl] = useState("");

  const [result, setResult] = useState<VerificationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => () => {
      for (const previewUrl of [frontPreviewUrl, backPreviewUrl, porPreviewUrl]) {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
      }
    },
    [backPreviewUrl, frontPreviewUrl, porPreviewUrl],
  );

  useEffect(() => {
    if (result) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (verificationKind === "poi") {
      if (!poiEnglishName.trim()) {
        setErrorMessage("고객 영문 성명을 입력해주세요.");
        return;
      }

      if (!poiDocumentType) {
        setErrorMessage("Document type을 선택해주세요.");
        return;
      }

      const canonicalIssuedCountry = findCountryOption(poiIssuedCountry);

      if (!canonicalIssuedCountry) {
        setErrorMessage("Issued country를 목록에서 선택해주세요.");
        return;
      }

      if (!frontImageFile) {
        setErrorMessage("신분증 앞면 이미지를 업로드해주세요.");
        return;
      }

      await submitVerification({
        verificationKind,
        buildFormData: () => {
          const formData = new FormData();
          formData.append("verificationKind", "poi");
          formData.append("englishName", poiEnglishName.trim());
          formData.append("documentTypeHint", poiDocumentType);
          formData.append("countryHint", canonicalIssuedCountry);
          formData.append("frontImage", frontImageFile);

          if (backImageFile) {
            formData.append("backImage", backImageFile);
          }

          return formData;
        },
      });

      return;
    }

    if (!porEnglishName.trim()) {
      setErrorMessage("POR 영문 성명을 입력해주세요.");
      return;
    }

    if (!porDocumentType) {
      setErrorMessage("Document type을 선택해주세요.");
      return;
    }

    const canonicalIssuedCountry = findCountryOption(porIssuedCountry);

    if (!canonicalIssuedCountry) {
      setErrorMessage("Issued country를 목록에서 선택해주세요.");
      return;
    }

    if (!porDocumentFile) {
      setErrorMessage("POR 문서 이미지를 업로드해주세요.");
      return;
    }

    await submitVerification({
      verificationKind,
      buildFormData: () => {
        const formData = new FormData();
        formData.append("verificationKind", "por");
        formData.append("englishName", porEnglishName.trim());
        formData.append("documentTypeHint", porDocumentType);
        formData.append("countryHint", canonicalIssuedCountry);
        formData.append("documentImage", porDocumentFile);
        return formData;
      },
    });
  }

  async function submitVerification({
    buildFormData,
  }: {
    verificationKind: VerificationKind;
    buildFormData: () => FormData;
  }) {
    setIsSubmitting(true);
    setResult(null);

    try {
      const response = await fetch("/api/verify-id", {
        method: "POST",
        body: buildFormData(),
      });

      const payload = (await response.json()) as
        | VerificationResult
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          payload && "error" in payload ? payload.error : "검증에 실패했습니다.",
        );
      }

      setResult(payload as VerificationResult);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "검증 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKindChange(nextKind: VerificationKind) {
    if (nextKind === verificationKind) {
      return;
    }

    setVerificationKind(nextKind);
    setErrorMessage("");
    setResult(null);
  }

  const activeCopy = modeCopy[verificationKind];

  return (
    <main className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22rem] bg-[radial-gradient(circle_at_top_left,_rgba(23,124,104,0.23),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(220,112,53,0.2),_transparent_48%)] sm:h-[26rem]" />

      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-12 lg:px-10 lg:py-16">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_23rem] lg:gap-10">
          <div>
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-700 sm:text-xs sm:tracking-[0.32em]">
                {activeCopy.eyebrow}
              </p>
              <h1 className="mt-3 max-w-[15ch] text-balance text-[2rem] font-semibold leading-[1.03] text-stone-950 sm:mt-4 sm:max-w-none sm:text-5xl sm:leading-tight">
                {activeCopy.title}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-stone-700 sm:mt-5 sm:max-w-2xl sm:text-lg sm:leading-8">
                {activeCopy.description}
              </p>
            </div>

            <section className="mt-5 rounded-[1.5rem] border border-stone-200/80 bg-white/80 p-3 shadow-[0_16px_44px_rgba(34,31,23,0.07)] backdrop-blur sm:mt-8 sm:rounded-[1.8rem] sm:p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeCard
                  active={verificationKind === "poi"}
                  eyebrow="POI"
                  title="신분증 검증"
                  description="고객 영문 성명, 발급국가, Document type, 신분증 앞면/뒷면 이미지로 검증합니다."
                  onClick={() => handleKindChange("poi")}
                />
                <ModeCard
                  active={verificationKind === "por"}
                  eyebrow="POR"
                  title="주소지 증명 검증"
                  description="발급국가, POR용 Document type, 주소지 증명 서류 이미지로 검증합니다."
                  onClick={() => handleKindChange("por")}
                />
              </div>
            </section>

            <form
              onSubmit={handleSubmit}
              className="mt-5 rounded-[1.7rem] border border-stone-200/80 bg-white/85 p-4 shadow-[0_20px_60px_rgba(34,31,23,0.08)] backdrop-blur sm:mt-6 sm:rounded-[2rem] sm:p-6 sm:shadow-[0_28px_80px_rgba(34,31,23,0.08)]"
            >
              {verificationKind === "poi" ? (
                <PoiForm
                  englishName={poiEnglishName}
                  issuedCountry={poiIssuedCountry}
                  documentType={poiDocumentType}
                  frontImageFile={frontImageFile}
                  backImageFile={backImageFile}
                  onEnglishNameChange={setPoiEnglishName}
                  onIssuedCountryChange={setPoiIssuedCountry}
                  onDocumentTypeChange={setPoiDocumentType}
                  onFrontFileChange={(file) =>
                    updateSelectedFile({
                      file,
                      setFile: setFrontImageFile,
                      currentPreviewUrl: frontPreviewUrl,
                      setPreviewUrl: setFrontPreviewUrl,
                    })
                  }
                  onBackFileChange={(file) =>
                    updateSelectedFile({
                      file,
                      setFile: setBackImageFile,
                      currentPreviewUrl: backPreviewUrl,
                      setPreviewUrl: setBackPreviewUrl,
                    })
                  }
                />
              ) : (
                <PorForm
                  englishName={porEnglishName}
                  issuedCountry={porIssuedCountry}
                  documentType={porDocumentType}
                  documentFile={porDocumentFile}
                  onEnglishNameChange={setPorEnglishName}
                  onIssuedCountryChange={setPorIssuedCountry}
                  onDocumentTypeChange={setPorDocumentType}
                  onDocumentFileChange={(file) =>
                    updateSelectedFile({
                      file,
                      setFile: setPorDocumentFile,
                      currentPreviewUrl: porPreviewUrl,
                      setPreviewUrl: setPorPreviewUrl,
                    })
                  }
                />
              )}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-stone-400 sm:w-auto"
                >
                  {isSubmitting ? "검증 중..." : activeCopy.buttonLabel}
                </button>
                <p className="text-sm leading-6 text-stone-500">
                  OpenAI API 호출과 우편번호 조회는 모두 서버에서만 처리됩니다.
                </p>
              </div>

              {errorMessage ? (
                <div className="mt-5 rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-7 text-rose-900">
                  {errorMessage}
                </div>
              ) : null}
            </form>
          </div>

          <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:gap-6">
            {verificationKind === "poi" ? (
              <>
                <ImagePreviewCard
                  title="앞면 미리보기"
                  description="업로드한 신분증 앞면 이미지가 여기에 표시됩니다."
                  previewUrl={frontPreviewUrl}
                  alt="Selected front ID preview"
                />

                <ImagePreviewCard
                  title="뒷면 미리보기"
                  description="업로드한 신분증 뒷면 이미지가 여기에 표시됩니다."
                  previewUrl={backPreviewUrl}
                  alt="Selected back ID preview"
                />
              </>
            ) : (
              <ImagePreviewCard
                title="POR 문서 미리보기"
                description="업로드한 주소지 증명 서류 이미지가 여기에 표시됩니다."
                previewUrl={porPreviewUrl}
                alt="Selected POR document preview"
                className="sm:col-span-2 lg:col-span-1"
              />
            )}
          </aside>
        </div>

        <div ref={resultsRef} className="mt-10">
          {result ? <VerificationResults result={result} /> : null}
        </div>
      </section>
    </main>
  );
}

function PoiForm({
  englishName,
  issuedCountry,
  documentType,
  frontImageFile,
  backImageFile,
  onEnglishNameChange,
  onIssuedCountryChange,
  onDocumentTypeChange,
  onFrontFileChange,
  onBackFileChange,
}: {
  englishName: string;
  issuedCountry: string;
  documentType: string;
  frontImageFile: File | null;
  backImageFile: File | null;
  onEnglishNameChange: (value: string) => void;
  onIssuedCountryChange: (value: string) => void;
  onDocumentTypeChange: (value: string) => void;
  onFrontFileChange: (file: File | null) => void;
  onBackFileChange: (file: File | null) => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <FormField
        label="Customer English Full Name"
        description="필수 항목입니다. POI 이름 매칭 기준이 되는 고객 영문 성명입니다."
      >
        <input
          value={englishName}
          onChange={(event) => onEnglishNameChange(event.target.value)}
          placeholder="Giljung Kim"
          className={inputClassName}
          autoComplete="off"
        />
      </FormField>

      <FormField
        label="Document type"
        description="필수 항목입니다. 업로드한 신분증과 일치하는 Document type을 선택하세요."
      >
        <select
          value={documentType}
          onChange={(event) => onDocumentTypeChange(event.target.value)}
          className={inputClassName}
        >
          {POI_DOCUMENT_TYPE_OPTIONS.map((option) => (
            <option key={option.label} value={option.value} disabled={!option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Issued country"
        description="필수 항목입니다. 신분증 발급국가를 검색 후 선택하세요."
      >
        <CountryCombobox
          value={issuedCountry}
          onChange={onIssuedCountryChange}
          placeholder="국가를 검색하세요"
          className={inputClassName}
        />
      </FormField>

      <FormField
        label="Front ID Image"
        description="필수 항목입니다. 신분증 앞면 사진 또는 스캔본을 업로드하세요."
      >
        <FileUploadCard
          file={frontImageFile}
          emptyLabel="앞면 이미지를 선택하세요"
          onFileChange={onFrontFileChange}
        />
      </FormField>

      <FormField
        label="Back ID Image"
        description="선택 항목입니다. 뒷면에 추가 정보가 있으면 업로드하세요."
      >
        <FileUploadCard
          file={backImageFile}
          emptyLabel="뒷면 이미지를 선택하세요"
          onFileChange={onBackFileChange}
        />
      </FormField>
    </div>
  );
}

function PorForm({
  englishName,
  issuedCountry,
  documentType,
  documentFile,
  onEnglishNameChange,
  onIssuedCountryChange,
  onDocumentTypeChange,
  onDocumentFileChange,
}: {
  englishName: string;
  issuedCountry: string;
  documentType: string;
  documentFile: File | null;
  onEnglishNameChange: (value: string) => void;
  onIssuedCountryChange: (value: string) => void;
  onDocumentTypeChange: (value: string) => void;
  onDocumentFileChange: (file: File | null) => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <FormField
        label="Customer English Full Name"
        description="필수 항목입니다. POR 이름 판독과 이름 정합도 계산에 사용됩니다."
      >
        <input
          value={englishName}
          onChange={(event) => onEnglishNameChange(event.target.value)}
          placeholder="Giljung Kim"
          className={inputClassName}
          autoComplete="off"
        />
      </FormField>

      <FormField
        label="Document type"
        description="필수 항목입니다. 주소지 증명에 해당하는 POR Document type을 선택하세요."
      >
        <select
          value={documentType}
          onChange={(event) => onDocumentTypeChange(event.target.value)}
          className={inputClassName}
        >
          {POR_DOCUMENT_TYPE_OPTIONS.map((option) => (
            <option key={option.label} value={option.value} disabled={!option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Issued country"
        description="필수 항목입니다. POR 문서의 발급국가를 검색 후 선택하세요."
      >
        <CountryCombobox
          value={issuedCountry}
          onChange={onIssuedCountryChange}
          placeholder="국가를 검색하세요"
          className={inputClassName}
        />
      </FormField>

      <FormField
        label="POR Document Upload"
        description="필수 항목입니다. 주소지 증명 서류 이미지를 업로드하세요."
      >
        <FileUploadCard
          file={documentFile}
          emptyLabel="POR 문서를 선택하세요"
          onFileChange={onDocumentFileChange}
        />
      </FormField>
    </div>
  );
}

function ModeCard({
  active,
  eyebrow,
  title,
  description,
  onClick,
}: {
  active: boolean;
  eyebrow: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[1.2rem] border px-4 py-4 text-left transition sm:px-5 ${
        active
          ? "border-teal-300 bg-teal-50/90 shadow-[0_16px_36px_rgba(17,94,89,0.12)]"
          : "border-stone-200 bg-stone-50/80 hover:border-stone-300 hover:bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-teal-700">
        {eyebrow}
      </p>
      <p className="mt-2 text-base font-semibold text-stone-950">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
    </button>
  );
}

function FormField({
  children,
  description,
  label,
}: {
  children: React.ReactNode;
  description: string;
  label: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-stone-900">{label}</span>
      <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
      <div className="mt-3">{children}</div>
    </label>
  );
}

function FileUploadCard({
  file,
  emptyLabel,
  onFileChange,
}: {
  file: File | null;
  emptyLabel: string;
  onFileChange: (file: File | null) => void;
}) {
  return (
    <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-[1.2rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-center transition hover:border-teal-500 hover:bg-teal-50/60 sm:min-h-32 sm:rounded-[1.4rem] sm:py-5">
      <span className="max-w-full break-all text-sm font-semibold text-stone-800">
        {file ? file.name : emptyLabel}
      </span>
      <span className="mt-2 text-xs leading-6 text-stone-500">
        JPG, PNG, WEBP, HEIC, 최대 8MB
      </span>
      <input
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        onChange={(event) => {
          onFileChange(event.target.files?.[0] ?? null);
        }}
      />
    </label>
  );
}

function ImagePreviewCard({
  title,
  description,
  previewUrl,
  alt,
  className = "",
}: {
  title: string;
  description: string;
  previewUrl: string;
  alt: string;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[1.5rem] border border-stone-200/80 bg-white/82 p-4 shadow-[0_18px_48px_rgba(34,31,23,0.07)] sm:p-5 sm:shadow-[0_24px_65px_rgba(34,31,23,0.07)] ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
      <div className="mt-3 overflow-hidden rounded-[1.2rem] border border-stone-200 bg-stone-100 sm:mt-4 sm:rounded-[1.5rem]">
        {previewUrl ? (
          <div className="relative h-52 w-full sm:h-72">
            <Image
              src={previewUrl}
              alt={alt}
              fill
              unoptimized
              className="object-cover"
            />
          </div>
        ) : (
          <div className="flex h-52 items-center justify-center px-5 text-center text-sm leading-6 text-stone-500 sm:h-72 sm:px-6 sm:leading-7">
            이미지를 업로드하면 여기에 미리보기가 표시됩니다.
          </div>
        )}
      </div>
    </section>
  );
}

function updateSelectedFile({
  file,
  setFile,
  currentPreviewUrl,
  setPreviewUrl,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
  currentPreviewUrl: string;
  setPreviewUrl: (previewUrl: string) => void;
}) {
  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
  }

  setFile(file);
  setPreviewUrl(file ? URL.createObjectURL(file) : "");
}

const inputClassName =
  "w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100 sm:rounded-[1.2rem]";
