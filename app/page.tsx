"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { CountryCombobox } from "@/components/country-combobox";
import { VerificationResults } from "@/components/verification-results";
import { findCountryOption } from "@/lib/country-options";
import type { VerificationResult } from "@/types/verification";

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
].join(",");

const DOCUMENT_TYPE_OPTIONS = [
  { value: "", label: "Select..." },
  { value: "Passport", label: "Passport" },
  { value: "ID Card", label: "ID Card" },
  { value: "Driver's License", label: "Driver's License" },
  { value: "Other Document", label: "Other Document" },
];

export default function Home() {
  const [englishName, setEnglishName] = useState("");
  const [issuedCountry, setIssuedCountry] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(imageFile);
    setPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [imageFile]);

  useEffect(() => {
    if (result) {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (!englishName.trim()) {
      setErrorMessage("Enter the user's English full name.");
      return;
    }

    if (!documentType) {
      setErrorMessage("Select the document type.");
      return;
    }

    const canonicalIssuedCountry = findCountryOption(issuedCountry);

    if (!canonicalIssuedCountry) {
      setErrorMessage("Select the issued country from the dropdown list.");
      return;
    }

    if (!imageFile) {
      setErrorMessage("Upload an ID image file.");
      return;
    }

    setIsSubmitting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("englishName", englishName.trim());
      formData.append("documentTypeHint", documentType);
      formData.append("countryHint", canonicalIssuedCountry);
      formData.append("image", imageFile);

      const response = await fetch("/api/verify-id", {
        method: "POST",
        body: formData,
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

  return (
    <main className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22rem] bg-[radial-gradient(circle_at_top_left,_rgba(23,124,104,0.23),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(220,112,53,0.2),_transparent_48%)] sm:h-[26rem]" />

      <section className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-12 lg:px-10 lg:py-16">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_23rem] lg:gap-10">
          <div>
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-700 sm:text-xs sm:tracking-[0.32em]">
                Server-side OCR verification
              </p>
              <h1 className="mt-3 max-w-[13ch] text-balance text-[2rem] font-semibold leading-[1.03] text-stone-950 sm:mt-4 sm:max-w-none sm:text-5xl sm:leading-tight">
                ID name match verification with OCR, romanization, and review-ready confidence.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-stone-700 sm:mt-5 sm:max-w-2xl sm:text-lg sm:leading-8">
                Enter the English name, choose the document type, search the issuing
                country, and upload the ID image to compare the extracted romanized
                name against the user input.
              </p>
            </div>

            <form
              onSubmit={handleSubmit}
              className="mt-5 rounded-[1.7rem] border border-stone-200/80 bg-white/85 p-4 shadow-[0_20px_60px_rgba(34,31,23,0.08)] backdrop-blur sm:mt-8 sm:rounded-[2rem] sm:p-6 sm:shadow-[0_28px_80px_rgba(34,31,23,0.08)]"
            >
              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  label="User Entered English Full Name"
                  description="Required. This is the name that will be matched against OCR + romanization output."
                >
                  <input
                    value={englishName}
                    onChange={(event) => setEnglishName(event.target.value)}
                    placeholder="Giljung Kim"
                    className={inputClassName}
                    autoComplete="off"
                  />
                </FormField>

                <FormField
                  label="Document type"
                  description="Required. Select the type that matches the uploaded image."
                >
                  <select
                    value={documentType}
                    onChange={(event) => setDocumentType(event.target.value)}
                    className={inputClassName}
                  >
                    {DOCUMENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value} disabled={!option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  label="Issued country"
                  description="Required. Search and select the issuing country from the supported list."
                >
                  <CountryCombobox
                    value={issuedCountry}
                    onChange={setIssuedCountry}
                    placeholder="Type to search countries"
                    className={inputClassName}
                  />
                </FormField>

                <FormField
                  label="ID Image Upload"
                  description="Required. Upload one photo or scan of the ID document."
                >
                  <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-[1.2rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-center transition hover:border-teal-500 hover:bg-teal-50/60 sm:min-h-32 sm:rounded-[1.4rem] sm:py-5">
                    <span className="max-w-full break-all text-sm font-semibold text-stone-800">
                      {imageFile ? imageFile.name : "Choose an image file"}
                    </span>
                    <span className="mt-2 text-xs leading-6 text-stone-500">
                      JPG, PNG, WEBP, HEIC up to 8MB
                    </span>
                    <input
                      type="file"
                      accept={ACCEPTED_IMAGE_TYPES}
                      className="sr-only"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0] ?? null;
                        setImageFile(nextFile);
                      }}
                    />
                  </label>
                </FormField>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-stone-400 sm:w-auto"
                >
                  {isSubmitting ? "Validating..." : "Validate"}
                </button>
                <p className="text-sm leading-6 text-stone-500">
                  OpenAI API is called only from the server route. The browser never
                  receives the API key.
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
            <section className="rounded-[1.5rem] border border-stone-200/80 bg-white/82 p-4 shadow-[0_18px_48px_rgba(34,31,23,0.07)] sm:p-5 sm:shadow-[0_24px_65px_rgba(34,31,23,0.07)]">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
                Preview
              </p>
              <div className="mt-3 overflow-hidden rounded-[1.2rem] border border-stone-200 bg-stone-100 sm:mt-4 sm:rounded-[1.5rem]">
                {previewUrl ? (
                  <div className="relative h-52 w-full sm:h-72">
                    <Image
                      src={previewUrl}
                      alt="Selected ID preview"
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-52 items-center justify-center px-5 text-center text-sm leading-6 text-stone-500 sm:h-72 sm:px-6 sm:leading-7">
                    Upload an ID image to see the preview here.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-stone-200/80 bg-white/82 p-4 shadow-[0_18px_48px_rgba(34,31,23,0.07)] sm:p-5 sm:shadow-[0_24px_65px_rgba(34,31,23,0.07)]">
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

const inputClassName =
  "w-full rounded-[1rem] border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100 sm:rounded-[1.2rem]";
