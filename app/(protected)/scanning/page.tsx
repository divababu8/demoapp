"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthHeader } from "@/lib/supabaseClient";

/* =====================================================================
   Column mapping — mirrors the Shipments page so the same raw Excel
   headers get the same friendly labels here.
   ===================================================================== */
const FLIGHT_KEYS = [
  "VAT ID#/TIN#", "Flight No", "Flight No.", "Flight", "FLIGHT", "flight_no", "flightNo",
];

const AIRPORT_KEYS = [
  "Recip Ctry", "Airport", "Airport Code", "Destination", "Port", "AIRPORT", "airport",
];

const LABEL_MAP: Record<string, string> = {
  "Shpr Co.": "Shipper Company", "Shpr Name": "Shipper Name", "Shpr Addr": "Shipper Address",
  "Shpr City": "Shipper City", "ShprState": "Shipper State", "Shpr Ctry": "Shipper Country",
  "Shpr Zip": "Shipper ZIP", "Shpr Phone": "Shipper Phone", "Recip Co.": "Recipient Company",
  "Recip Name": "Recipient Name", "Recip Addr": "Recipient Address", "Recip City": "Recipient City",
  "Recip State": "Recipient State", "Recip Ctry": "Recipient Country", "Recip Zip": "Recipient ZIP",
  "Recip Phone": "Recipient Phone", "Shpr Ref Notes": "Shipper Ref Notes", "No Pieces": "Pieces",
  "Master Tracking Nbr": "Master Tracking #", "Special Handling Codes": "Special Handling",
  "Shpmt Weight": "Weight", "HSCODE": "HS Code", "Commodity Desc": "Commodity",
  "Custom Value": "Customs Value", "VAT ID#/TIN#": "Flight No", "CountryofOriginCoded": "Country of Origin",
  "CertificateNumber": "Certificate #", "TransactionType": "Transaction Type", "ImporterCode": "Importer Code",
  "INCOTERMSCoded": "Incoterms", "fright Costs": "Freight Cost", "ExemptionTypeCoded": "Exemption Type",
  "ApprovalNumber": "Approval #", "SettlementIndicator": "Settlement", "Brand": "Brand", "Model": "Model",
  "MOPHRegNo": "MOPH Reg #", "PaymentMode": "Payment Mode", "DecSubmitType": "Declaration Type",
  "Commit Date": "Commit Date", "Commit Time": "Commit Time",
};

const AWB_REGEX = /^\d{8,15}$/;
const AWB_AUTOSUBMIT_MIN = 8;

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
function pickByKeys(data: Record<string, any> | undefined, keys: string[]): string {
  if (!data) return "–";
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return "–";
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
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

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = useCallback(async (raw: string) => {
    const awb = raw.trim();
    if (!awb) return;

    if (!AWB_REGEX.test(awb)) {
      setNotFound(`"${awb}" is not a valid AWB number — enter the full number only.`);
      setResult(null); setFlash("err"); beep("err");
      return;
    }

    const mySeq = ++requestSeq.current;
    setInput(""); setPending(true); setNotFound(null); setLastAwb(awb);
    inputRef.current?.focus();

    try {
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/bills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ awb_number: awb }),
      });

      if (mySeq !== requestSeq.current) return;

      if (res.status === 401) {
        setNotFound("Your session expired — please log in again.");
        setResult(null); setFlash("err"); beep("err"); return;
      }

      const data = await res.json();

      if (!data.found) {
        setNotFound(data.message ?? `AWB ${awb} not found.`);
        setResult(null); setFlash("err"); beep("err"); return;
      }

      setResult(data as ScanResult);
      setNotFound(null);
      setFlash(data.justScanned ? "ok" : "warn");
      beep(data.justScanned ? "ok" : "warn");
    } catch {
      if (mySeq !== requestSeq.current) return;
      setNotFound("Network error — could not reach the server. Check your connection and try again.");
      setResult(null); setFlash("err"); beep("err");
    } finally {
      if (mySeq === requestSeq.current) setPending(false);
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      autoSubmittedRef.current = null;
      submit(input);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInput(val);
    const trimmed = val.trim();
    if (!pending && AWB_REGEX.test(trimmed) && trimmed.length >= AWB_AUTOSUBMIT_MIN && autoSubmittedRef.current !== trimmed) {
      autoSubmittedRef.current = trimmed;
      submit(trimmed);
    }
    if (trimmed.length < AWB_AUTOSUBMIT_MIN) autoSubmittedRef.current = null;
  }

  function beep(kind: "ok" | "warn" | "err") {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      const now = ctx.currentTime;
      if (kind === "ok") {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.06);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now); osc.stop(now + 0.2);
      } else if (kind === "warn") {
        osc.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now); osc.stop(now + 0.16);
      } else {
        osc.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now); osc.stop(now + 0.22);
      }
    } catch { /* non-critical */ }
  }

  function clearAll() {
    setInput(""); setResult(null); setNotFound(null); setFlash(null);
    autoSubmittedRef.current = null;
    requestSeq.current++;
    inputRef.current?.focus();
  }

  const flightNo = useMemo(() => pickByKeys(result?.bill.extra_data, FLIGHT_KEYS), [result]);
  const airport = useMemo(() => pickByKeys(result?.bill.extra_data, AIRPORT_KEYS), [result]);

  const scanCountLabel = useMemo(() => {
    if (!result) return "–";
    const total = result.bill.manifest_total_bills;
    const scanned = result.bill.manifest_scanned_count;
    if (total === undefined || scanned === undefined) return "–";
    return `${scanned}/${total}`;
  }, [result]);

  const detailRows: Array<{ label: string; value: string }> = result
    ? [
        { label: "Tracking Number", value: result.bill.awb_number },
        { label: "Status", value: result.bill.scan_status === "scanned" ? "Scanned" : "Not scanned" },
        { label: "Manifest #", value: result.bill.manifest_number },
        { label: "Flight No", value: flightNo },
        { label: "Airport", value: airport },
        { label: "Scan Count", value: scanCountLabel },
        { label: "Shortage", value: result.bill.manifest_pending_count !== undefined ? String(result.bill.manifest_pending_count) : "–" },
        { label: "Overage", value: result.bill.overage ? "Yes" : "No" },
        { label: "Search Count", value: String(result.searchCount) },
        { label: "Uploaded", value: fmtDateTime(result.bill.manifest_upload_date) },
      ]
    : [];

  const extraDetailRows: Array<{ key: string; label: string; value: string }> = result
    ? Object.entries(result.bill.extra_data ?? {})
        .filter(([k]) => !FLIGHT_KEYS.includes(k) && !AIRPORT_KEYS.includes(k))
        .map(([k, v]) => ({
          key: k,
          label: LABEL_MAP[k] ?? k,
          value: v === null || v === undefined ? "–" : String(v),
        }))
    : [];

  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Scanning</h1>
          <p className="page-subtitle">Scan an AWB with a barcode reader, or type it and press Enter.</p>
        </div>
        <div className="page-header-actions">
          <span className="live-pill" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-muted)',
            background: 'var(--surface)', padding: '8px 16px', borderRadius: '999px',
            border: '1px solid var(--border)'
          }}>
            <span className="live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} /> Live
          </span>
        </div>
      </div>

      {/* ============ SCAN INPUT ============ */}
      <div className="scan-panel">
        <div className="scan-panel-row">
          <div className="scan-panel-input-wrap">
            <input
              ref={inputRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Scan barcode or type AWB, then Enter"
              autoFocus inputMode="numeric" autoComplete="off" spellCheck={false}
              className={`scan-input${flash ? ` scan-input-${flash}` : ""}`}
            />
            {pending && (
              <span className="scan-pending-indicator">
                <span className="mini-spinner" /> Looking up…
              </span>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary scan-search-btn"
            onClick={() => { autoSubmittedRef.current = null; submit(input); }}
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
          Auto-submits when a valid AWB is detected. Press Enter for manual lookup.
        </div>
      </div>

      {/* ============ NOT FOUND / ERROR ============ */}
      {notFound && <p className="scan-alert">{notFound}</p>}

      {/* ============ RESULT ============ */}
      {result && (
        <>
          {/* Status banner — modernized */}
          <div className={`scan-status-banner scan-status-${result.justScanned ? "ok" : "warn"}`} style={{
            background: result.justScanned
              ? 'linear-gradient(135deg, #d1fae5 0%, #ffffff 100%)'
              : 'linear-gradient(135deg, #fef3c7 0%, #ffffff 100%)',
            border: '1px solid ' + (result.justScanned ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'),
            borderRadius: '16px',
            padding: '20px 24px',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
          }}>
            <div className="scan-status-left">
              <span className="scan-status-icon" style={{
                background: result.justScanned ? '#fff' : '#fff',
                color: result.justScanned ? '#059669' : '#d97706',
                border: '1px solid ' + (result.justScanned ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'),
                width: '48px', height: '48px', borderRadius: '14px',
                display: 'grid', placeItems: 'center'
              }}>
                {result.justScanned ? (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5" /><circle cx="12" cy="17" r=".6" fill="currentColor" />
                  </svg>
                )}
              </span>
              <div>
                <div className="scan-status-title" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink)' }}>
                  {result.justScanned ? "Scan recorded" : "Already scanned"}
                </div>
                <div className="scan-status-sub" style={{ fontSize: '0.85rem', color: 'var(--ink-muted)', marginTop: '2px' }}>
                  AWB {result.bill.awb_number} ·{" "}
                  {result.justScanned ? "first successful scan" : `previously scanned · this is lookup #${result.searchCount}`}
                </div>
              </div>
            </div>
            <span className="mono scan-status-manifest" style={{
              fontSize: '0.85rem', color: 'var(--ink-muted)',
              background: 'rgba(255,255,255,0.7)', padding: '6px 14px', borderRadius: '8px'
            }}>
              {result.bill.manifest_number}
            </span>
          </div>

          {/* Primary detail grid */}
          <div className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Shipment details</div>
                <div className="panel-sub">Everything the manifest knows about this AWB</div>
              </div>
            </div>
            <div className="scan-detail-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '1px',
              background: 'var(--border-soft)',
              borderRadius: '12px',
              overflow: 'hidden'
            }}>
              {detailRows.map((row) => (
                <div className="scan-detail-item" key={row.label} style={{ background: '#fff', padding: '16px 20px' }}>
                  <div className="scan-detail-label" style={{
                    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--ink-muted)', marginBottom: '6px'
                  }}>
                    {row.label}
                  </div>
                  <div className="scan-detail-value" style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)' }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Secondary — all other extra_data columns */}
          {extraDetailRows.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Additional fields</div>
                  <div className="panel-sub">
                    {extraDetailRows.length} more column{extraDetailRows.length === 1 ? "" : "s"} from the manifest
                  </div>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <tbody>
                    {extraDetailRows.map((r) => (
                      <tr key={r.key}>
                        <td style={{ width: 260, color: "var(--ink-muted)", fontWeight: 500 }}>
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
        <div className="scan-empty" style={{
          background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)',
          border: '2px dashed var(--border)',
          borderRadius: '20px',
          padding: '80px 24px',
          textAlign: 'center'
        }}>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--accent-indigo)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, marginBottom: '16px' }}>
            <path d="M4 8V5a1 1 0 0 1 1-1h3" /><path d="M16 4h3a1 1 0 0 1 1 1v3" />
            <path d="M20 16v3a1 1 0 0 1-1 1h-3" /><path d="M8 20H5a1 1 0 0 1-1-1v-3" />
            <path d="M4 12h16" />
          </svg>
          <div className="scan-empty-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>
            Ready to scan
          </div>
          <div className="scan-empty-sub" style={{ fontSize: '0.95rem', color: 'var(--ink-muted)' }}>
            Scan a barcode or type an AWB number and press Enter.
          </div>
          {lastAwb && (
            <div className="scan-empty-last" style={{ marginTop: '20px', fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
              Last scanned: <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>{lastAwb}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}