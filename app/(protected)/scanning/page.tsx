"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthHeader } from "@/lib/supabaseClient";

/* =====================================================================
   Column mapping — mirrors the Shipments page so the same raw Excel
   headers get the same friendly labels here.
   ===================================================================== */
const FLIGHT_KEYS = [
  "VAT ID#/TIN#",
  "Flight No",
  "Flight No.",
  "Flight",
  "FLIGHT",
  "flight_no",
  "flightNo",
];

const AIRPORT_KEYS = [
  "Recip Ctry",
  "Airport",
  "Airport Code",
  "Destination",
  "Port",
  "AIRPORT",
  "airport",
];

const LABEL_MAP: Record<string, string> = {
  "Shpr Co.": "Shipper Company",
  "Shpr Name": "Shipper Name",
  "Shpr Addr": "Shipper Address",
  "Shpr City": "Shipper City",
  "ShprState": "Shipper State",
  "Shpr Ctry": "Shipper Country",
  "Shpr Zip": "Shipper ZIP",
  "Shpr Phone": "Shipper Phone",
  "Recip Co.": "Recipient Company",
  "Recip Name": "Recipient Name",
  "Recip Addr": "Recipient Address",
  "Recip City": "Recipient City",
  "Recip State": "Recipient State",
  "Recip Ctry": "Recipient Country",
  "Recip Zip": "Recipient ZIP",
  "Recip Phone": "Recipient Phone",
  "Shpr Ref Notes": "Shipper Ref Notes",
  "No Pieces": "Pieces",
  "Master Tracking Nbr": "Master Tracking #",
  "Special Handling Codes": "Special Handling",
  "Shpmt Weight": "Weight",
  "HSCODE": "HS Code",
  "Commodity Desc": "Commodity",
  "Custom Value": "Customs Value",
  "VAT ID#/TIN#": "Flight No",
  "CountryofOriginCoded": "Country of Origin",
  "CertificateNumber": "Certificate #",
  "TransactionType": "Transaction Type",
  "ImporterCode": "Importer Code",
  "INCOTERMSCoded": "Incoterms",
  "fright Costs": "Freight Cost",
  "ExemptionTypeCoded": "Exemption Type",
  "ApprovalNumber": "Approval #",
  "SettlementIndicator": "Settlement",
  "Brand": "Brand",
  "Model": "Model",
  "MOPHRegNo": "MOPH Reg #",
  "PaymentMode": "Payment Mode",
  "DecSubmitType": "Declaration Type",
  "Commit Date": "Commit Date",
  "Commit Time": "Commit Time",
};

/* AWB validity: digits only, 8–15 characters. Adjust if yours differ. */
const AWB_REGEX = /^\d{8,15}$/;
const AWB_AUTOSUBMIT_MIN = 8; // auto-fire after this many digits

/* =====================================================================
   TYPES
   ===================================================================== */
interface ScanResult {
  found: true;
  justScanned: boolean;
  searchCount: number;
  bill: {
    id: string;
    awb_number: string;
    scan_status: "pending" | "scanned";
    extra_data: Record<string, any>;
    manifest_number: string;
    manifest_upload_date: string;
    // Optional extra fields we fetch for the detail panel
    scan_count_in_manifest?: number;
    manifest_total_bills?: number;
    manifest_scanned_count?: number;
    manifest_pending_count?: number;
    overage?: boolean;
  };
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function pickByKeys(
  data: Record<string, any> | undefined,
  keys: string[]
): string {
  if (!data) return "–";
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "–";
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* =====================================================================
   PAGE
   ===================================================================== */
export default function ScanningPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<"ok" | "warn" | "err" | null>(null);
  const [lastAwb, setLastAwb] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  const autoSubmittedRef = useRef<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* ---------------- submit handler ---------------- */
  const submit = useCallback(
    async (raw: string) => {
      const awb = raw.trim();
      if (!awb) return;

      // Local validation — never send garbage to the server
      if (!AWB_REGEX.test(awb)) {
        setNotFound(
          `"${awb}" is not a valid AWB number — enter the full number only.`
        );
        setResult(null);
        setFlash("err");
        beep("err");
        return;
      }

      const mySeq = ++requestSeq.current;
      setInput("");
      setPending(true);
      setNotFound(null);
      setLastAwb(awb);
      inputRef.current?.focus();

      try {
        const authHeader = await getAuthHeader();
        const res = await fetch("/api/bills/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ awb_number: awb }),
        });

        // Discard stale responses — another request has superseded this one
        if (mySeq !== requestSeq.current) return;

        if (res.status === 401) {
          setNotFound("Your session expired — please log in again.");
          setResult(null);
          setFlash("err");
          beep("err");
          return;
        }

        const data = await res.json();

        if (!data.found) {
          setNotFound(data.message ?? `AWB ${awb} not found.`);
          setResult(null);
          setFlash("err");
          beep("err");
          return;
        }

        setResult(data as ScanResult);
        setNotFound(null);
        setFlash(data.justScanned ? "ok" : "warn");
        beep(data.justScanned ? "ok" : "warn");
      } catch {
        if (mySeq !== requestSeq.current) return;
        setNotFound(
          "Network error — could not reach the server. Check your connection and try again."
        );
        setResult(null);
        setFlash("err");
        beep("err");
      } finally {
        if (mySeq === requestSeq.current) setPending(false);
      }
    },
    []
  );

  /* ---------------- Enter to submit ---------------- */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      autoSubmittedRef.current = null;
      submit(input);
    }
  }

  /* ---------------- auto-submit on full AWB ---------------- */
  // Fires only when the current value:
  //   1. matches the AWB regex exactly (digits, correct length),
  //   2. hasn't already been auto-submitted (avoid double-fire),
  //   3. isn't currently being looked up (pending === false).
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInput(val);

    const trimmed = val.trim();
    if (
      !pending &&
      AWB_REGEX.test(trimmed) &&
      trimmed.length >= AWB_AUTOSUBMIT_MIN &&
      autoSubmittedRef.current !== trimmed
    ) {
      autoSubmittedRef.current = trimmed;
      submit(trimmed);
    }

    // Reset the "already auto-submitted" guard when the value gets shorter
    if (trimmed.length < AWB_AUTOSUBMIT_MIN) {
      autoSubmittedRef.current = null;
    }
  }

  /* ---------------- audio feedback ---------------- */
  function beep(kind: "ok" | "warn" | "err") {
    try {
      const Ctx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;
      if (kind === "ok") {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.06);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (kind === "warn") {
        osc.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.16);
      } else {
        osc.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.22);
      }
    } catch {
      /* non-critical */
    }
  }

  /* ---------------- clear ---------------- */
  function clearAll() {
    setInput("");
    setResult(null);
    setNotFound(null);
    setFlash(null);
    autoSubmittedRef.current = null;
    requestSeq.current++; // invalidate any in-flight request
    inputRef.current?.focus();
  }

  /* ---------------- derived detail rows ---------------- */
  const flightNo = useMemo(
    () => pickByKeys(result?.bill.extra_data, FLIGHT_KEYS),
    [result]
  );
  const airport = useMemo(
    () => pickByKeys(result?.bill.extra_data, AIRPORT_KEYS),
    [result]
  );

  const scanCountLabel = useMemo(() => {
    if (!result) return "–";
    const total = result.bill.manifest_total_bills;
    const scanned = result.bill.manifest_scanned_count;
    if (total === undefined || scanned === undefined) return "–";
    return `${scanned}/${total}`;
  }, [result]);

  /* Rows shown in the detail panel, in fixed order */
  const detailRows: Array<{ label: string; value: string }> = result
    ? [
        { label: "Tracking Number", value: result.bill.awb_number },
        {
          label: "Status",
          value: result.bill.scan_status === "scanned" ? "Scanned" : "Not scanned",
        },
        { label: "Manifest #", value: result.bill.manifest_number },
        {
          label: "Manifest Description",
          value: result.bill.manifest_number, // no description column exists yet
        },
        { label: "Flight No", value: flightNo },
        { label: "Airport", value: airport },
        { label: "Scan Count", value: scanCountLabel },
        {
          label: "Shortage",
          value:
            result.bill.manifest_pending_count !== undefined
              ? String(result.bill.manifest_pending_count)
              : "–",
        },
        {
          label: "Overage",
          value: result.bill.overage ? "Yes" : "No",
        },
        { label: "Search Count", value: String(result.searchCount) },
        {
          label: "Uploaded",
          value: fmtDateTime(result.bill.manifest_upload_date),
        },
      ]
    : [];

  /* All remaining extra_data keys (excluding ones already shown above) */
  const extraDetailRows: Array<{ key: string; label: string; value: string }> =
    result
      ? Object.entries(result.bill.extra_data ?? {})
          .filter(([k]) => !FLIGHT_KEYS.includes(k) && !AIRPORT_KEYS.includes(k))
          .map(([k, v]) => ({
            key: k,
            label: LABEL_MAP[k] ?? k,
            value: v === null || v === undefined ? "–" : String(v),
          }))
      : [];

  /* ---------------- render ---------------- */
  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Scanning</h1>
          <p className="page-subtitle">
            Scan an AWB with a barcode reader, or type it and press Enter.
          </p>
        </div>
        <div className="page-header-actions">
          <span className="live-pill">
            <span className="live-dot" /> Live
          </span>
        </div>
      </div>

      {/* ============ SCAN INPUT + SEARCH ============ */}
      <div className="scan-panel">
        <div className="scan-panel-row">
          <div className="scan-panel-input-wrap">
            <input
              ref={inputRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Scan barcode or type AWB, then Enter"
              autoFocus
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className={`scan-input${flash ? ` scan-input-${flash}` : ""}`}
            />
            {pending && (
              <span className="scan-pending-indicator">
                <span className="mini-spinner" />
                Looking up…
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary scan-search-btn"
            onClick={() => {
              autoSubmittedRef.current = null;
              submit(input);
            }}
            disabled={pending || input.trim().length === 0}
          >
            Search
          </button>

          <button
            type="button"
            className="btn btn-outline scan-clear-btn"
            onClick={clearAll}
            disabled={pending && input.trim().length === 0}
          >
            Clear
          </button>
        </div>

        <div className="scan-hint">
          Auto-submits when a valid AWB is detected. Press Enter for manual
          lookup.
        </div>
      </div>

      {/* ============ NOT FOUND / ERROR ============ */}
      {notFound && <p className="scan-alert">{notFound}</p>}

      {/* ============ RESULT ============ */}
      {result && (
        <>
          {/* Status banner */}
          <div
            className={`scan-status-banner scan-status-${
              result.justScanned ? "ok" : "warn"
            }`}
          >
            <div className="scan-status-left">
              <span className="scan-status-icon">
                {result.justScanned ? (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="m8 12 3 3 5-6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 2 20h20L12 3z" />
                    <path d="M12 9v5" />
                    <circle cx="12" cy="17" r=".6" fill="currentColor" />
                  </svg>
                )}
              </span>
              <div>
                <div className="scan-status-title">
                  {result.justScanned
                    ? "Scan recorded"
                    : "Already scanned"}
                </div>
                <div className="scan-status-sub">
                  AWB {result.bill.awb_number} ·{" "}
                  {result.justScanned
                    ? "first successful scan"
                    : `previously scanned · this is lookup #${result.searchCount}`}
                </div>
              </div>
            </div>
            <span className="mono scan-status-manifest">
              {result.bill.manifest_number}
            </span>
          </div>

          {/* Primary detail grid */}
          <div className="panel-flush">
            <div className="panel-header">
              <div>
                <div className="panel-title">Shipment details</div>
                <div className="panel-sub">
                  Everything the manifest knows about this AWB
                </div>
              </div>
            </div>
            <div className="scan-detail-grid">
              {detailRows.map((row) => (
                <div className="scan-detail-item" key={row.label}>
                  <div className="scan-detail-label">{row.label}</div>
                  <div className="scan-detail-value">{row.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Secondary — all other extra_data columns */}
          {extraDetailRows.length > 0 && (
            <div className="panel-flush">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Additional fields</div>
                  <div className="panel-sub">
                    {extraDetailRows.length} more column
                    {extraDetailRows.length === 1 ? "" : "s"} from the manifest
                  </div>
                </div>
              </div>
              <div className="table-wrap" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
                <table className="data-table">
                  <tbody>
                    {extraDetailRows.map((r) => (
                      <tr key={r.key}>
                        <td
                          style={{
                            width: 260,
                            color: "var(--ink-muted)",
                            fontWeight: 500,
                          }}
                        >
                          {r.label}
                        </td>
                        <td>{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ IDLE STATE ============ */}
      {!result && !notFound && (
        <div className="scan-empty">
          <svg
            viewBox="0 0 24 24"
            width="40"
            height="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 8V5a1 1 0 0 1 1-1h3" />
            <path d="M16 4h3a1 1 0 0 1 1 1v3" />
            <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
            <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
            <path d="M4 12h16" />
          </svg>
          <div className="scan-empty-title">Ready to scan</div>
          <div className="scan-empty-sub">
            Scan a barcode or type an AWB number and press Enter.
          </div>
          {lastAwb && (
            <div className="scan-empty-last">
              Last scanned: <span className="mono">{lastAwb}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}