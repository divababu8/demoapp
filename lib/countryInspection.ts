// ---------------------------------------------------------------------
// CONFIG — which Excel column holds the country code that drives the
// Manifest description box on the Scanning page.
// Confirmed: column G, "Shpr Ctry" (Shipper/origin country).
// ---------------------------------------------------------------------
export const COUNTRY_CODE_COLUMN_HEADER = "Shpr Ctry";

export const COUNTRY_NAMES: Record<string, string> = {
  AF: "Afghanistan",
  AT: "Austria",
  BD: "Bangladesh",
  BE: "Belgium",
  BG: "Bulgaria",
  DE: "Germany",
  DZ: "Algeria",
  GB: "United Kingdom",
  GH: "Ghana",
  IN: "India",
  KE: "Kenya",
  LB: "Lebanon",
  MA: "Morocco",
  NG: "Nigeria",
  NL: "Netherlands",
  PH: "Philippines",
  PK: "Pakistan",
  SD: "Sudan",
  SY: "Syria",
  TH: "Thailand",
  TN: "Tunisia",
  TR: "Turkey",
  TZ: "Tanzania",
  VN: "Vietnam",
  ZA: "South Africa",
  EG: "Egypt",
  HK: "Hong Kong",
  JO: "Jordan",
  OM: "Oman",
};

// Full list: any of these codes -> red / "PHYSICAL INSPECTION" in box 1.
export const PHYSICAL_INSPECTION_LIST = new Set(Object.keys(COUNTRY_NAMES));

// Subset of the full list: these also get the country name spelled out in
// box 2 (e.g. "AUSTRIA_PHYSICAL"). Everything else in the full list just
// shows "COMMERCIAL" in box 2 instead.
export const NAMED_PHYSICAL_LIST = new Set(["AT", "DE", "TH", "TR", "VN"]);

export interface InspectionResult {
  level: "green" | "red";
  countryCode: string;
  countryName: string | null;
  /** Manifest description box (box 1): "" when green, "PHYSICAL INSPECTION" when red. */
  box1Message: string;
  /** Second box: "" when green, "COMMERCIAL" or "{COUNTRY}_PHYSICAL" when red. */
  box2Message: string;
}

export function evaluateCountry(rawCode: string | null | undefined): InspectionResult {
  const code = (rawCode ?? "").trim().toUpperCase();
  const countryName = COUNTRY_NAMES[code] ?? null;

  if (!code || !PHYSICAL_INSPECTION_LIST.has(code)) {
    return { level: "green", countryCode: code, countryName, box1Message: "", box2Message: "" };
  }

  return {
    level: "red",
    countryCode: code,
    countryName,
    box1Message: "PHYSICAL INSPECTION",
    box2Message: NAMED_PHYSICAL_LIST.has(code) && countryName
      ? `${countryName.toUpperCase()}_PHYSICAL`
      : "COMMERCIAL",
  };
}
