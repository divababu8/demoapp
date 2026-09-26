import * as XLSX from "xlsx";

// ---------------------------------------------------------------------
// CONFIG — adjust this ONE constant to match your exact Excel header text.
// Must match the header cell in row 1 exactly (case-sensitive).
// ---------------------------------------------------------------------
export const AWB_COLUMN_HEADER = "Tracking Number"; // matches your real Excel header exactly

export interface ParsedRow {
  awb_number: string;
  extra_data: Record<string, string | number | null>;
}

export interface ParsedFile {
  manifestNumber: string;
  rows: ParsedRow[];
}

// Derive manifest number from filename: "Manifest_26092026_01.xlsx" -> "Manifest_26092026_01"
export function manifestNumberFromFilename(filename: string): string {
  return filename.replace(/\.(xlsx|xls)$/i, "").trim();
}

// Parses a single Excel file (as ArrayBuffer) into manifest number + row data.
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

  // raw array-of-arrays keeps header row separate and preserves column order
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null, // blank cells become null instead of being omitted
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

  const rows: ParsedRow[] = dataRows.map((row) => {
    const awb = row[awbColIndex];
    if (awb === null || awb === undefined || String(awb).trim() === "") {
      throw new Error(`Missing AWB number in "${filename}" — every row must have one.`);
    }

    const extra_data: Record<string, string | number | null> = {};
    headers.forEach((header, idx) => {
      if (idx === awbColIndex || header === "") return; // skip AWB col + blank header cols
      const cell = row[idx];
      extra_data[header] = cell === undefined ? null : cell;
    });

    return {
      awb_number: String(awb).trim(),
      extra_data,
    };
  });

  return {
    manifestNumber: manifestNumberFromFilename(filename),
    rows,
  };
}
