import { strFromU8, unzipSync } from "fflate";

import type { PostalCodeSource } from "@/types/verification";

const JAPAN_POST_ZIP_URL =
  "https://www.post.japanpost.jp/zipcode/dl/utf/zip/utf_ken_all.zip";
const JAPAN_LABEL = "\u65e5\u672c";
const NO_LISTING_TOWN = "\u4ee5\u4e0b\u306b\u63b2\u8f09\u304c\u306a\u3044\u5834\u5408";
const CHOME_SUFFIX = "\u4e01\u76ee";
const CITY_SUFFIX_PATTERN = /[\u5e02\u533a\u90e1]$/u;
const MUNICIPALITY_SUFFIX_PATTERN = /[\u753a\u6751]$/u;
const LEADING_TOWN_PATTERN =
  /^([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30fc\u3005\u30f6\u30f5]+)(?=\d|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30fc\u3005\u30f6\u30f5]|$)/u;

interface PostalCodeLookupInput {
  issuedCountry: string;
  country: string;
  localCountry: string;
  localState: string;
  localCity: string;
  localAddress1: string;
  localAddress2: string;
}

interface PostalCodeLookupResult {
  postalCode: string;
  confidence: number;
  source: PostalCodeSource;
  warning?: string;
}

let japanPostDataPromise: Promise<Map<string, Set<string>>> | undefined;

export async function lookupJapanPostalCode({
  issuedCountry,
  country,
  localCountry,
  localState,
  localCity,
  localAddress1,
  localAddress2,
}: PostalCodeLookupInput): Promise<PostalCodeLookupResult> {
  if (!shouldUseJapanPostLookup({ issuedCountry, country, localCountry })) {
    return { postalCode: "", confidence: 0, source: "none" };
  }

  const state = normalizeJapaneseLookupText(localState);
  const cityCandidates = buildCityCandidates(localCity, localAddress1);
  const townCandidates = buildTownCandidates(localAddress1, localAddress2);

  if (!state || !cityCandidates.length || !townCandidates.length) {
    return {
      postalCode: "",
      confidence: 0,
      source: "none",
      warning:
        "Postal code lookup was skipped because the Japanese address could not be segmented clearly enough.",
    };
  }

  const postalMap = await loadJapanPostPostalMap();
  const postalCodes = new Set<string>();

  for (const cityCandidate of cityCandidates) {
    for (const townCandidate of townCandidates) {
      const matches = postalMap.get(createLookupKey(state, cityCandidate, townCandidate));

      if (!matches) {
        continue;
      }

      for (const postalCode of matches) {
        postalCodes.add(postalCode);
      }
    }
  }

  if (postalCodes.size === 1) {
    return {
      postalCode: Array.from(postalCodes)[0] ?? "",
      confidence: 0.91,
      source: "lookup",
    };
  }

  if (postalCodes.size > 1) {
    return {
      postalCode: "",
      confidence: 0,
      source: "none",
      warning:
        "Postal code lookup returned multiple Japan Post candidates, so the postal code was left blank.",
    };
  }

  return {
    postalCode: "",
    confidence: 0,
    source: "none",
    warning:
      "Postal code could not be resolved from the Japan Post dataset using the current address split.",
  };
}

async function loadJapanPostPostalMap() {
  japanPostDataPromise ??= fetchAndBuildPostalMap();
  return japanPostDataPromise;
}

async function fetchAndBuildPostalMap() {
  const response = await fetch(JAPAN_POST_ZIP_URL, {
    headers: {
      "User-Agent": "kyc-test/1.0",
    },
    cache: "force-cache",
  });

  if (!response.ok) {
    throw new Error(`Japan Post dataset download failed with status ${response.status}.`);
  }

  const zipEntries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const csvEntry = Object.entries(zipEntries).find(([name]) =>
    name.toLowerCase().endsWith(".csv"),
  );

  if (!csvEntry) {
    throw new Error("Japan Post dataset did not contain a CSV file.");
  }

  const csvText = strFromU8(csvEntry[1]);
  const postalMap = new Map<string, Set<string>>();

  for (const line of csvText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const columns = splitCsvLine(line);

    if (columns.length < 9) {
      continue;
    }

    const postalCode = formatPostalCode(columns[2] ?? "");
    const state = normalizeJapaneseLookupText(columns[6] ?? "");
    const city = normalizeJapaneseLookupText(columns[7] ?? "");
    const town = normalizeJapaneseLookupText(columns[8] ?? "");

    if (!postalCode || !state || !city || !town || town === NO_LISTING_TOWN) {
      continue;
    }

    const key = createLookupKey(state, city, town);
    const existing = postalMap.get(key) ?? new Set<string>();
    existing.add(postalCode);
    postalMap.set(key, existing);
  }

  return postalMap;
}

function shouldUseJapanPostLookup({
  issuedCountry,
  country,
  localCountry,
}: {
  issuedCountry: string;
  country: string;
  localCountry: string;
}) {
  const normalizedValues = [issuedCountry, country, localCountry]
    .map((value) => value.normalize("NFKC").toLowerCase().trim())
    .filter(Boolean);

  return normalizedValues.some((value) =>
    ["japan", "jp", JAPAN_LABEL].includes(value),
  );
}

function buildCityCandidates(localCity: string, localAddress1: string) {
  const city = normalizeJapaneseLookupText(localCity);
  const address1 = normalizeJapaneseLookupText(localAddress1);
  const candidates = new Set<string>();

  if (city) {
    candidates.add(city);
  }

  if (city && address1 && MUNICIPALITY_SUFFIX_PATTERN.test(address1) && !CITY_SUFFIX_PATTERN.test(city)) {
    candidates.add(`${city}${address1}`);
  }

  return Array.from(candidates);
}

function buildTownCandidates(localAddress1: string, localAddress2: string) {
  const address1 = normalizeJapaneseLookupText(localAddress1);
  const address2 = normalizeJapaneseLookupText(localAddress2);
  const candidates = new Set<string>();
  const address1IsMunicipality = MUNICIPALITY_SUFFIX_PATTERN.test(address1);

  if (address1 && !address1IsMunicipality) {
    candidates.add(address1);
  }

  const leadingTown = extractLeadingTown(address2);

  if (leadingTown) {
    candidates.add(leadingTown);
  }

  const chomeMatch = address2.match(/^(\d{1,2})(?:-|$)/);

  if (address1 && !address1IsMunicipality && chomeMatch) {
    const chome = Number(chomeMatch[1]);

    if (chome >= 1 && chome < 100) {
      candidates.add(`${address1}${toJapaneseNumeral(chome)}${CHOME_SUFFIX}`);
    }
  }

  return Array.from(candidates);
}

function extractLeadingTown(address2: string) {
  const match = address2.match(LEADING_TOWN_PATTERN);
  return match?.[1] ? normalizeJapaneseLookupText(match[1]) : "";
}

function createLookupKey(state: string, city: string, town: string) {
  if (!state || !city || !town) {
    return "";
  }

  return `${state}|${city}|${town}`;
}

function normalizeJapaneseLookupText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
    .replace(/["']/g, "")
    .trim();
}

function formatPostalCode(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length !== 7) {
    return "";
  }

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (character === "," && !insideQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
}

function toJapaneseNumeral(value: number) {
  const numerals = [
    "",
    "\u4e00",
    "\u4e8c",
    "\u4e09",
    "\u56db",
    "\u4e94",
    "\u516d",
    "\u4e03",
    "\u516b",
    "\u4e5d",
  ];
  const ten = "\u5341";

  if (value <= 10) {
    return value === 10 ? ten : numerals[value] ?? "";
  }

  if (value < 20) {
    return `${ten}${numerals[value - 10] ?? ""}`;
  }

  if (value % 10 === 0 && value < 100) {
    return `${numerals[Math.floor(value / 10)] ?? ""}${ten}`;
  }

  if (value < 100) {
    return `${numerals[Math.floor(value / 10)] ?? ""}${ten}${numerals[value % 10] ?? ""}`;
  }

  return String(value);
}
