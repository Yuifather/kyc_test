import { strFromU8, unzipSync } from "fflate";

import type { PostalCodeSource } from "@/types/verification";

const JAPAN_POST_ZIP_URL =
  "https://www.post.japanpost.jp/zipcode/dl/utf/zip/utf_ken_all.zip";
const JAPAN_LABEL = "\u65e5\u672c";
const NO_LISTING_TOWN = "\u4ee5\u4e0b\u306b\u63b2\u8f09\u304c\u306a\u3044\u5834\u5408";
const CHOME_SUFFIX = "\u4e01\u76ee";
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
        "\uc77c\ubcf8 \uc8fc\uc18c\ub97c \ucda9\ubd84\ud788 \uba85\ud655\ud558\uac8c \ubd84\ub9ac\ud558\uc9c0 \ubabb\ud574 \uc6b0\ud3b8\ubc88\ud638 \uc870\ud68c\ub97c \uac74\ub108\ub6f0\uc5c8\uc2b5\ub2c8\ub2e4.",
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
        "Japan Post \uc870\ud68c \uacb0\uacfc\uac00 \uc5ec\ub7ec \uac74\uc774\ub77c Postal code\ub294 \ube48\uac12\uc73c\ub85c \ub450\uc5c8\uc2b5\ub2c8\ub2e4.",
    };
  }

  return {
    postalCode: "",
    confidence: 0,
    source: "none",
    warning:
      "\ud604\uc7ac \uc8fc\uc18c \ubd84\ub9ac \uacb0\uacfc\ub85c\ub294 Japan Post \ub370\uc774\ud130\uc5d0\uc11c Postal code\ub97c \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.",
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

  return normalizedValues.some((value) => ["japan", "jp", JAPAN_LABEL].includes(value));
}

function buildCityCandidates(localCity: string, localAddress1: string) {
  const city = normalizeJapaneseLookupText(localCity);
  const address1 = normalizeJapaneseLookupText(localAddress1);
  const candidates = new Set<string>();

  if (city) {
    candidates.add(city);
  }

  if (city && address1 && MUNICIPALITY_SUFFIX_PATTERN.test(address1)) {
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

    const strippedAddress1 = stripJapaneseTownPrefixV2(address1);
    if (strippedAddress1) {
      candidates.add(strippedAddress1);

      const splitAtAza = strippedAddress1.replace(/^(.+?)字.+$/u, "$1");
      if (splitAtAza && splitAtAza !== strippedAddress1) {
        candidates.add(splitAtAza);
      }
    }
  }

  const leadingTown = extractLeadingTown(address2);
  if (leadingTown) {
    candidates.add(leadingTown);

    const strippedLeadingTown = stripJapaneseTownPrefixV2(leadingTown);
    if (strippedLeadingTown) {
      candidates.add(strippedLeadingTown);
    }
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

function stripJapaneseTownPrefix(value: string) {
  return normalizeJapaneseLookupText(value).replace(/^(?:大字|字|小字|字之下|字ノ下)/u, "");
}

function stripJapaneseTownPrefixV2(value: string) {
  return stripJapaneseTownPrefix(value);
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
  const numerals = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const ten = "十";

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

