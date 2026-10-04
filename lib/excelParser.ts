import * as XLSX from "xlsx";

// ---------------------------------------------------------------------
// CONFIG — adjust these to match your exact Excel header text.
// Must match the header cell in row 1 exactly (case-sensitive).
// ---------------------------------------------------------------------
export const AWB_COLUMN_HEADER = "Tracking Number";

// Column that holds the combined "FLIGHTCARRIER FLIGHTNO MANIFESTCARRIER
// DATE SEQ [...extra]" string, e.g. "QR 1019 FDX 20261003 00004 SAMPLE".
// I could not tell from what you've shared whether this lives in its own
// Excel column or is really the filename pattern you already had — this
// constant covers the "real column" case; if no column with this exact
// header exists in the file, the parser automatically falls back to
// parsing the FILENAME with the identical logic instead, so it works
// either way until you confirm. Set this to your real header if it is a
// column; leave it as-is (it just won't be found) if you want it to
// always come from the filename.
export const MANIFEST_FLIGHT_COLUMN_HEADER = "Manifest Ref";

export interface ParsedRow {
  awb_number: string;
  extra_data: Record<string, string | number | null>;
}

export interface ParsedFile {
  manifestNumber: string;
  flightNumber: string;
  rows: ParsedRow[];
}

// Splits "QR 1019 FDX 20261003 00004 SAMPLE[.xlsx]" into:
//   flightNumber   = "QR 1019"              (first 2 tokens)
//   manifestNumber = "FDX 20261003 00004"    (next 3 tokens)
// Anything after that (e.g. "SAMPLE") is ignored.
// Falls back to using the whole string as the manifest number (no flight
// number) if it doesn't have at least 5 space-separated tokens, so an
// unexpected format never crashes the upload — it just can't split it.
export function parseFlightAndManifest(raw: string): { flightNumber: string; manifestNumber: string } {
  const base = raw.replace(/\.(xlsx|xls)$/i, "").trim();
  const tokens = base.split(/\s+/).filter(Boolean);

  if (tokens.length < 5) {
    return { flightNumber: "", manifestNumber: base };
  }

  return {
    flightNumber: `${tokens[0]} ${tokens[1]}`,
    manifestNumber: `${tokens[2]} ${tokens[3]} ${tokens[4]}`,
  };
}

// Parses a single Excel file (as ArrayBuffer) into manifest/flight number + row data.
// - First row = headers (fixed across all files)
// - AWB_COLUMN_HEADER column -> becomes the real `awb_number` column
// - Every other header -> becomes a key inside extra_data (JSONB)
// - Blank cells -> stored as null (not omitted), so the table renderer
//   always knows the column exists even when empty for that row.
export function parseManifestExcel(
  filename: string,
  fileBuffer: ArrayBuffer
): ParsedFile {
  const workbook = XLSX.read(fileBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });

  if (raw.length === 0) {
    throw new Error(`File "${filename}" is empty.`);
  }

  const headers = raw[0].map((h) => (h === null ? "" : String(h).trim()));
  const awbColIndex = headers.indexOf(AWB_COLUMN_HEADER);

  if (awbColIndex === -1) {
    throw new Error(
      `Column "${AWB_COLUMN_HEADER}" not found in "${filename}". ` +
      `Found headers: ${headers.join(", ")}`
    );
  }

  const dataRows = raw.slice(1).filter((row) => row.some((cell) => cell !== null));

  // Flight/manifest number: prefer the dedicated column's value from the
  // first data row (it's a manifest-level attribute, so every row in the
  // file should carry the same value) — fall back to the filename if that
  // column doesn't exist or its first value is blank.
  const manifestRefColIndex = headers.indexOf(MANIFEST_FLIGHT_COLUMN_HEADER);
  const columnValue =
    manifestRefColIndex !== -1 && dataRows.length > 0
      ? dataRows[0][manifestRefColIndex]
      : null;
  const sourceString =
    columnValue !== null && columnValue !== undefined && String(columnValue).trim() !== ""
      ? String(columnValue).trim()
      : filename;

  const { flightNumber, manifestNumber } = parseFlightAndManifest(sourceString);

  const rows: ParsedRow[] = dataRows.map((row) => {
    const awb = row[awbColIndex];
    if (awb === null || awb === undefined || String(awb).trim() === "") {
      throw new Error(`Missing AWB number in "${filename}" — every row must have one.`);
    }

    const extra_data: Record<string, string | number | null> = {};
    headers.forEach((header, idx) => {
      if (idx === awbColIndex || header === "") return;
      const cell = row[idx];
      extra_data[header] = cell === undefined ? null : cell;
    });

    return {
      awb_number: String(awb).trim(),
      extra_data,
    };
  });

  return {
    manifestNumber,
    flightNumber,
    rows,
  };
}
