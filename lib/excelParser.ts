import * as XLSX from "xlsx";

/* =====================================================================
   COLUMN HEADER CONSTANTS
   Tuned to the actual manifest Excel headers in this project.
   ===================================================================== */

/** Tracking/AWB column — first column in your file, header is
 *  literally "Tracking Number". We still list aliases in case a future
 *  template changes it, and because normalization makes matching robust
 *  to whitespace/tab/case differences. */
const AWB_HEADER_CANDIDATES = [
  "tracking number",   // ← YOUR exact header (primary match)
  "tracking no", "tracking no.", "tracking#", "tracking #",
  "awb number", "awb no", "awb no.", "awb#", "awb", "awbnumber",
  "air waybill", "waybill", "waybill number",
  "master tracking nbr", "master tracking number",
];

/** Country code column — used by country-inspection rules. */
export const COUNTRY_CODE_COLUMN_HEADER = "Shpr Ctry";

/** Manifest ref / flight column — optional. Falls back to filename. */
export const MANIFEST_FLIGHT_COLUMN_HEADER = "Manifest Ref";

/* =====================================================================
   NORMALIZATION
   ===================================================================== */

/** Strip whitespace (incl. tabs & non-breaking spaces), lowercase,
 *  remove BOM/zero-width chars. This is what makes the parser immune
 *  to " Tracking Number " vs "tracking number" vs "Tracking  Number". */
function normalizeHeader(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/\u00a0/g, " ")            // non-breaking space -> space
    .replace(/[\u200b-\u200d\uFEFF]/g, "") // zero-width + BOM
    .replace(/[\t\r\n]+/g, " ")          // tabs / newlines -> space
    .replace(/\s+/g, " ")                // collapse runs of whitespace
    .trim()
    .toLowerCase();
}

function cleanValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\u00a0/g, " ").trim();
}

/** Tracking numbers: strip ALL whitespace, uppercase. */
function cleanAwb(v: unknown): string {
  return cleanValue(v).replace(/\s+/g, "").toUpperCase();
}

/* =====================================================================
   HEADER ROW DETECTION
   Scans the first 10 rows; the row with the most recognizable header
   words wins. This survives a title/branding row above the real header.
   ===================================================================== */
function findHeaderRow(aoa: any[][]): { rowIndex: number; headers: string[] } {
  const scanUpTo = Math.min(aoa.length, 10);
  let bestRow = 0;
  let bestScore = -1;

  for (let r = 0; r < scanUpTo; r++) {
    const row = aoa[r] ?? [];
    const normalized = row.map(normalizeHeader);
    const score = normalized.filter((h) =>
      h.length > 0 &&
      (AWB_HEADER_CANDIDATES.some((c) => h.includes(c)) ||
       h.includes(normalizeHeader(COUNTRY_CODE_COLUMN_HEADER)) ||
       h.includes(normalizeHeader(MANIFEST_FLIGHT_COLUMN_HEADER)) ||
       /^(shpr|recip|service|commit|flight|manifest|hs|commodity|country|pieces|weight|tracking)/.test(h))
    ).length;

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  return {
    rowIndex: bestRow,
    headers: (aoa[bestRow] ?? []).map(cleanValue),
  };
}

/* =====================================================================
   FIND COLUMN INDEX BY HEADER (exact → substring)
   ===================================================================== */
function findColumnIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  // Exact match first
  for (let i = 0; i < normalized.length; i++) {
    if (candidates.includes(normalized[i])) return i;
  }
  // Then substring match
  for (let i = 0; i < normalized.length; i++) {
    if (candidates.some((c) => normalized[i].includes(c))) return i;
  }
  return -1;
}

/* =====================================================================
   FLIGHT + MANIFEST NUMBER PARSER
   "QR 1019 FDX 20261003 00004 SAMPLE" ->
     flight   = "QR 1019"
     manifest = "FDX 20261003 00004"
   ===================================================================== */
export function parseFlightAndManifest(source: string): {
  flightNumber: string | null;
  manifestNumber: string;
} {
  const cleaned = cleanValue(source)
    .replace(/\.xlsx?$/i, "")
    .trim();
  const parts = cleaned.split(/\s+/);

  const flightNumber = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : (parts[0] ?? null);
  const manifestNumber = parts.slice(2, 5).join(" ") || cleaned;

  return {
    flightNumber: flightNumber || null,
    manifestNumber: manifestNumber || cleaned || "UNKNOWN",
  };
}

/* =====================================================================
   PUBLIC API
   ===================================================================== */
export interface ParsedRow {
  awb_number: string;
  extra_data: Record<string, any>;
}

export interface ParseResult {
  manifestNumber: string;
  flightNumber: string | null;
  rows: ParsedRow[];
}

export function parseManifestExcel(
  filename: string,
  buffer: ArrayBuffer
): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("Excel file has no sheets.");

  const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (aoa.length === 0) throw new Error("Excel file is empty.");

  const { rowIndex: headerRowIndex, headers } = findHeaderRow(aoa);

  // --- Manifest source string (column > filename) ---
  const manifestColIdx = findColumnIndex(headers, [
    normalizeHeader(MANIFEST_FLIGHT_COLUMN_HEADER),
  ]);
  let manifestSource = filename;
  if (manifestColIdx >= 0) {
    for (let r = headerRowIndex + 1; r < aoa.length; r++) {
      const v = cleanValue(aoa[r]?.[manifestColIdx]);
      if (v) { manifestSource = v; break; }
    }
  }
  const { flightNumber, manifestNumber } = parseFlightAndManifest(manifestSource);

  // --- AWB / Tracking column ---
  // Primary: match "Tracking Number" (your header)
  let awbColIdx = findColumnIndex(headers, AWB_HEADER_CANDIDATES);

  // Fallback: use the very first column (column A) if it has data
  if (awbColIdx < 0) {
    for (let c = 0; c < headers.length; c++) {
      const sample = cleanValue(aoa[headerRowIndex + 1]?.[c]);
      if (sample) { awbColIdx = c; break; }
    }
  }

  if (awbColIdx < 0) {
    throw new Error(
      `Could not find a Tracking/AWB column. Headers found: [${headers.join(" | ")}]. ` +
      `Add a "Tracking Number" column (column A) and try again.`
    );
  }

  // --- Build rows ---
  const rows: ParsedRow[] = [];
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.length === 0) continue;

    const awb = cleanAwb(row[awbColIdx]);
    if (!awb) continue;

    const extra_data: Record<string, any> = {};
    headers.forEach((h, c) => {
      if (!h) return;
      extra_data[h] = cleanValue(row[c]);
    });

    rows.push({ awb_number: awb, extra_data });
  }

  if (rows.length === 0) {
    throw new Error(
      `No data rows found below the header. ` +
      `Tracking column detected: "${headers[awbColIdx] ?? "?"}" (index ${awbColIdx}). ` +
      `Verify the file actually has data in that column.`
    );
  }

  return { manifestNumber, flightNumber, rows };
}