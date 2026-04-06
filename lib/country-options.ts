export const COUNTRY_OPTIONS = [
  "Afghanistan",
  "\u00c5land Islands",
  "Albania",
  "Algeria",
  "American Samoa",
  "Andorra",
  "Angola",
  "Anguilla",
  "Antarctica",
  "Antigua and Barbuda",
  "Argentina",
  "Armenia",
  "Aruba",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belgium",
  "Belize",
  "Benin",
  "Bermuda",
  "Bhutan",
  "Bolivia (Plurinational State of)",
  "Bonaire, Sint Eustatius and Saba",
  "Bosnia and Herzegovina",
  "Botswana",
  "Bouvet Island",
  "Brazil",
  "British Indian Ocean Territory",
  "Brunei Darussalam",
  "Bulgaria",
  "Burkina Faso",
  "Cabo Verde",
  "Cambodia",
  "Cameroon",
  "Cayman Islands",
  "Chad",
  "Chile",
  "China",
  "Christmas Island",
  "Cocos (Keeling) Islands",
  "Colombia",
  "Comoros",
  "Congo",
  "Cook Islands",
  "Costa Rica",
  "C\u00f4te d'Ivoire",
  "Croatia",
  "Cura\u00e7ao",
  "Cyprus",
  "Czechia",
  "Denmark",
  "Djibouti",
  "Dominica",
  "Dominican Republic",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Equatorial Guinea",
  "Eritrea",
  "Estonia",
  "Eswatini",
  "Ethiopia",
  "Falkland Islands (Malvinas)",
  "Faroe Islands",
  "Fiji",
  "Finland",
  "France",
  "French Guiana",
  "French Polynesia",
  "French Southern Territories",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Gibraltar",
  "Greece",
  "Greenland",
  "Grenada",
  "Guadeloupe",
  "Guam",
  "Guatemala",
  "Guernsey",
  "Guinea",
  "Guyana",
  "Haiti",
  "Heard Island and McDonald Islands",
  "Holy See (Vatican)",
  "Honduras",
  "Hong Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Ireland",
  "Isle of Man",
  "Israel",
  "Italy",
  "Jamaica",
  "Japan",
  "Jersey",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kiribati",
  "Korea, Republic of",
  "Kuwait",
  "Kyrgyzstan",
  "Lao People's Democratic Republic",
  "Latvia",
  "Lesotho",
  "Liberia",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Macao",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Malta",
  "Marshall Islands",
  "Martinique",
  "Mauritania",
  "Mauritius",
  "Mayotte",
  "Mexico",
  "Micronesia (Federated States of)",
  "Moldova, Republic of",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Montserrat",
  "Morocco",
  "Mozambique",
  "Namibia",
  "Nauru",
  "Nepal",
  "Netherlands",
  "New Caledonia",
  "New Zealand",
  "Niger",
  "Nigeria",
  "Niue",
  "Norfolk Island",
  "North Macedonia",
  "Northern Mariana Islands",
  "Norway",
  "Oman",
  "Pakistan",
  "Palau",
  "Palestine",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Philippines",
  "Pitcairn",
  "Poland",
  "Portugal",
  "Puerto Rico",
  "Qatar",
  "R\u00e9union",
  "Romania",
  "Russian Federation",
  "Rwanda",
  "Saint Barth\u00e9lemy",
  "Saint Helena, Ascension and Tristan da Cunha",
  "Saint Kitts and Nevis",
  "Saint Lucia",
  "Saint Martin (French part)",
  "Saint Vincent and the Grenadines",
  "Samoa",
  "San Marino",
  "Sao Tome and Principe",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leone",
  "Singapore",
  "Sint Maarten (Dutch part)",
  "Slovakia",
  "Slovenia",
  "Solomon Islands",
  "South Africa",
  "South Georgia and the South Sandwich Islands",
  "Spain",
  "Sri Lanka",
  "Suriname",
  "Svalbard and Jan Mayen",
  "Sweden",
  "Switzerland",
  "Taiwan, Province of China",
  "Tajikistan",
  "Tanzania, United Republic of",
  "Thailand",
  "Timor-Leste",
  "Togo",
  "Tokelau",
  "Tonga",
  "Trinidad and Tobago",
  "Tunisia",
  "T\u00fcrkiye",
  "Turkmenistan",
  "Turks and Caicos Islands",
  "Tuvalu",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom of Great Britain and Northern Ireland",
  "United States Minor Outlying Islands",
  "Uruguay",
  "Uzbekistan",
  "Vanuatu",
  "Viet Nam",
  "Virgin Islands (British)",
  "Virgin Islands (U.S.)",
  "Wallis and Futuna",
  "Western Sahara",
  "Zambia",
] as const;

type CountryOption = (typeof COUNTRY_OPTIONS)[number];

const COUNTRY_ALIASES: Partial<Record<CountryOption, readonly string[]>> = {
  "Korea, Republic of": [
    "South Korea",
    "Republic of Korea",
    "KR",
    "\uB300\uD55C\uBBFC\uAD6D",
  ],
};

const COUNTRY_SEARCH_INDEX = COUNTRY_OPTIONS.map((name) => ({
  name,
  normalizedName: normalizeCountrySearchText(name),
  normalizedAliases: (COUNTRY_ALIASES[name] ?? [])
    .map((alias) => normalizeCountrySearchText(alias))
    .filter(Boolean),
}));

export function findCountryOption(value: string) {
  const normalizedQuery = normalizeCountrySearchText(value);

  if (!normalizedQuery) {
    return "";
  }

  for (const country of COUNTRY_SEARCH_INDEX) {
    if (
      country.normalizedName === normalizedQuery ||
      country.normalizedAliases.includes(normalizedQuery)
    ) {
      return country.name;
    }
  }

  return "";
}

export function searchCountryOptions(query: string, limit = 8) {
  const normalizedQuery = normalizeCountrySearchText(query);

  if (!normalizedQuery) {
    return COUNTRY_OPTIONS.slice(0, limit);
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const matches: Array<{ name: CountryOption; score: number }> = [];

  for (const country of COUNTRY_SEARCH_INDEX) {
    const searchTerms = [country.normalizedName, ...country.normalizedAliases];
    let bestScore = -1;

    for (const searchTerm of searchTerms) {
      const exact = searchTerm === normalizedQuery;
      const startsWith = searchTerm.startsWith(normalizedQuery);
      const includes = searchTerm.includes(normalizedQuery);
      const matchedTokenCount = queryTokens.filter((token) =>
        searchTerm.includes(token),
      ).length;
      const allTokensMatched = matchedTokenCount === queryTokens.length;

      if (!exact && !startsWith && !includes && !allTokensMatched) {
        continue;
      }

      let score = 0;

      if (exact) {
        score += 1000;
      }

      if (startsWith) {
        score += 250;
      }

      if (includes) {
        score += 120;
      }

      if (allTokensMatched) {
        score += 80;
      }

      if (searchTerm === country.normalizedName) {
        score += 6;
      } else {
        score += 16;
      }

      score += matchedTokenCount * 12;
      score -= searchTerm.length * 0.01;
      bestScore = Math.max(bestScore, score);
    }

    if (bestScore >= 0) {
      matches.push({
        name: country.name,
        score: bestScore,
      });
    }
  }

  return matches
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    })
    .slice(0, limit)
    .map((country) => country.name);
}

function normalizeCountrySearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}
