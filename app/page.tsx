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
  { value: "", label: "Select..." },
  { value: "Passport", label: "Passport" },
  { value: "ID Card", label: "ID Card" },
  { value: "Driver's License", label: "Driver's License" },
  { value: "Other Document", label: "Other Document" },
];

const POR_DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "Select..." },
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
    eyebrow: "POI verification",
    title: "Proof of identity OCR with name matching, local-script capture, and review-ready confidence.",
    description:
      "Enter the customer English name, select issuing country and document type, then upload front and optional back images of the identity document.",
    buttonLabel: "Validate POI",
  },
  por: {
    eyebrow: "POR verification",
    title: "Proof of residence OCR with standardized address parsing and Japan Post postal-code lookup.",
    description:
      "Select the issuing country and POR document type, upload the document, and extract both standardized address fields and local OCR text.",
    buttonLabel: "Validate POR",
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
        setErrorMessage("Enter the user's English full name.");
        return;
      }

      if (!poiDocumentType) {
        setErrorMessage("Select the document type.");
        return;
      }

      const canonicalIssuedCountry = findCountryOption(poiIssuedCountry);

      if (!canonicalIssuedCountry) {
        setErrorMessage("Select the issued country from the dropdown list.");
        return;
      }

      if (!frontImageFile) {
        setErrorMessage("Upload the front image of the ID.");
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

    if (!porDocumentType) {
      setErrorMessage("Select the document type.");
      return;
    }

    const canonicalIssuedCountry = findCountryOption(porIssuedCountry);

    if (!canonicalIssuedCountry) {
      setErrorMessage("Select the issued country from the dropdown list.");
      return;
    }

    if (!porDocumentFile) {
      setErrorMessage("Upload the POR document image.");
      return;
    }

    await submitVerification({
      verificationKind,
      buildFormData: () => {
        const formData = new FormData();
        formData.append("verificationKind", "por");
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
          payload && "error" in payload ? payload.error : "Verification failed.",
        );
      }

      setResult(payload as VerificationResult);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "A verification error occurred.",
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
                  title="Proof of Identity"
                  description="Customer name, issued country, document type, and front/back identity images."
                  onClick={() => handleKindChange("poi")}
                />
                <ModeCard
                  active={verificationKind === "por"}
                  eyebrow="POR"
                  title="Proof of Residence"
                  description="Issued country, POR document type, and address-proof upload with postal-code support."
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
                  issuedCountry={porIssuedCountry}
                  documentType={porDocumentType}
                  documentFile={porDocumentFile}
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
                  {isSubmitting ? "Validating..." : activeCopy.buttonLabel}
                </button>
                <p className="text-sm leading-6 text-stone-500">
                  OpenAI API is called only from the server route. Postal-code lookup
                  runs on the server as well.
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
                  title="Front Preview"
                  description="The required front-side identity image appears here."
                  previewUrl={frontPreviewUrl}
                  alt="Selected front ID preview"
                />

                <ImagePreviewCard
                  title="Back Preview"
                  description="The optional reverse-side identity image appears here."
                  previewUrl={backPreviewUrl}
                  alt="Selected back ID preview"
                />
              </>
            ) : (
              <ImagePreviewCard
                title="POR Preview"
                description="The uploaded proof-of-residence document appears here."
                previewUrl={porPreviewUrl}
                alt="Selected POR document preview"
                className="sm:col-span-2 lg:col-span-1"
              />
            )}

            <section className="rounded-[1.5rem] border border-stone-200/80 bg-white/82 p-4 shadow-[0_18px_48px_rgba(34,31,23,0.07)] sm:col-span-2 sm:p-5 sm:shadow-[0_24px_65px_rgba(34,31,23,0.07)] lg:col-span-1">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
                Security
              </p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-stone-700 sm:mt-4 sm:leading-7">
                <p>
                  Local development keeps the real key in the project root{" "}
                  <code>.env.local</code>.
                </p>
                <p>
                  Production deployment should move the same key into Vercel
                  Environment Variables.
                </p>
                <p>GitHub stores code only. The API key must never be committed.</p>
              </div>
            </section>
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
        description="Required. This is the user-entered English name used for POI name matching."
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
        description="Required. Select the POI document type that matches the upload."
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
        description="Required. Search and select the identity document issuing country."
      >
        <CountryCombobox
          value={issuedCountry}
          onChange={onIssuedCountryChange}
          placeholder="Type to search countries"
          className={inputClassName}
        />
      </FormField>

      <FormField
        label="Front ID Image"
        description="Required. Upload the front photo or scan of the identity document."
      >
        <FileUploadCard
          file={frontImageFile}
          emptyLabel="Choose the front image"
          onFileChange={onFrontFileChange}
        />
      </FormField>

      <FormField
        label="Back ID Image"
        description="Optional. Upload the reverse side if the document has additional fields on the back."
      >
        <FileUploadCard
          file={backImageFile}
          emptyLabel="Choose the back image"
          onFileChange={onBackFileChange}
        />
      </FormField>
    </div>
  );
}

function PorForm({
  issuedCountry,
  documentType,
  documentFile,
  onIssuedCountryChange,
  onDocumentTypeChange,
  onDocumentFileChange,
}: {
  issuedCountry: string;
  documentType: string;
  documentFile: File | null;
  onIssuedCountryChange: (value: string) => void;
  onDocumentTypeChange: (value: string) => void;
  onDocumentFileChange: (file: File | null) => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <FormField
        label="Document type"
        description="Required. Select the POR document type that proves the user's address."
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
        description="Required. Search and select the country that issued the POR document."
      >
        <CountryCombobox
          value={issuedCountry}
          onChange={onIssuedCountryChange}
          placeholder="Type to search countries"
          className={inputClassName}
        />
      </FormField>

      <FormField
        label="POR Document Upload"
        description="Required. Upload a proof-of-residence document image."
      >
        <FileUploadCard
          file={documentFile}
          emptyLabel="Choose the POR document"
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
        JPG, PNG, WEBP, HEIC up to 8MB
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
            Upload an image to see the preview here.
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
