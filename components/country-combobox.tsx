"use client";

import { useDeferredValue, useId, useState } from "react";

import { findCountryOption, searchCountryOptions } from "@/lib/country-options";

const MAX_VISIBLE_OPTIONS = 8;

interface CountryComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
}

export function CountryCombobox({
  value,
  onChange,
  className,
  placeholder = "국가를 검색하세요",
}: CountryComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listboxId = useId();
  const deferredValue = useDeferredValue(value);
  const options = searchCountryOptions(
    deferredValue,
    deferredValue.trim() ? MAX_VISIBLE_OPTIONS : 12,
  );
  const activeOptionId =
    isOpen && options.length ? `${listboxId}-option-${highlightedIndex}` : undefined;

  function selectCountry(country: string) {
    onChange(country);
    setHighlightedIndex(0);
    setIsOpen(false);
  }

  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    const canonicalCountry = findCountryOption(value);

    if (canonicalCountry) {
      onChange(canonicalCountry);
    }

    setHighlightedIndex(0);
    setIsOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) =>
        options.length ? Math.min(current + 1, options.length - 1) : 0,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && isOpen && options.length) {
      event.preventDefault();
      selectCountry(options[highlightedIndex] ?? options[0]);
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div className="relative" onBlur={handleBlur}>
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-activedescendant={activeOptionId}
        value={value}
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setHighlightedIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={`${className} pr-12`}
      />
      <button
        type="button"
        aria-label="발급국가 목록 열기"
        onClick={() => {
          setHighlightedIndex(0);
          setIsOpen((current) => !current);
        }}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-stone-500 transition hover:text-stone-900"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen ? (
        <div className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-[1.2rem] border border-stone-200 bg-white shadow-[0_24px_65px_rgba(34,31,23,0.12)]">
          <div id={listboxId} role="listbox" className="max-h-72 overflow-auto py-2">
            {options.length ? (
              options.map((country, index) => (
                <button
                  key={country}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={highlightedIndex === index}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectCountry(country);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex w-full items-center px-4 py-3 text-left text-sm transition ${
                    highlightedIndex === index
                      ? "bg-teal-50 text-stone-950"
                      : "text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  {country}
                </button>
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-stone-500">
                지원 목록에서 일치하는 국가를 찾지 못했습니다.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
