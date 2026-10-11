/* =====================================================================
   COUNTRY INSPECTION — flags, named list, Box1/Box2 rules
   ===================================================================== */

export const COUNTRY_CODE_COLUMN_HEADER = "Shpr Ctry";
export const BOX2_MESSAGE_COLUMN_HEADER = "VAT ID#/TIN#"; // Excel col AE

/** Country codes whose Box2 shows COUNTRYNAME_PHYSICAL above the AE value. */
const NAMED_PHYSICAL = new Set(["AT", "DE", "TH", "TR", "VN"]);

/** All country codes that trigger a red PHYSICAL INSPECTION Box1. */
const FLAGGED = new Set([
  "AF", "AT", "BD", "BE", "BG", "DE", "DZ", "GB", "GH", "IN", "KE", "LB",
  "MA", "NG", "NL", "PH", "PK", "SD", "SY", "TH", "TN", "TR", "TZ", "VN",
  "ZA", "EG", "HK", "JO", "OM",
]);

/** Code -> display name, used for COUNTRYNAME_PHYSICAL on the named list. */
const COUNTRY_NAMES: Record<string, string> = {
  AT: "AUSTRIA",
  DE: "GERMANY",
  TH: "THAILAND",
  TR: "TURKEY",
  VN: "VIETNAM",
};

export interface CountryInspection {
  level: "red" | "green";
  countryCode: string;
  /** Box1: "PHYSICAL INSPECTION" when red, "" when green. */
  box1Message: string;
  /** Box2 line 1: "COUNTRYNAME_PHYSICAL" only for the named list. "" otherwise. */
  namedPhysicalLine: string;
}

export function evaluateCountry(rawCode: unknown): CountryInspection {
  const code = String(rawCode ?? "").trim().toUpperCase();

  if (!FLAGGED.has(code)) {
    return { level: "green", countryCode: code, box1Message: "", namedPhysicalLine: "" };
  }

  const namedPhysicalLine = NAMED_PHYSICAL.has(code)
    ? `${COUNTRY_NAMES[code] ?? code}_PHYSICAL`
    : "";

  return {
    level: "red",
    countryCode: code,
    box1Message: "PHYSICAL INSPECTION",
    namedPhysicalLine,
  };
}

/** Read Box2's free-form AE-column value from a bill's extra_data. */
export function getAeBox2Value(extraData: Record<string, any> | undefined): string {
  if (!extraData) return "";
  const raw = extraData[BOX2_MESSAGE_COLUMN_HEADER];
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}