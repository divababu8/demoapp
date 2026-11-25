"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthHeader, supabase } from "@/lib/supabaseClient";
import {
  COUNTRY_CODE_COLUMN_HEADER,
  BOX2_MESSAGE_COLUMN_HEADER,
  evaluateCountry,
  getAeBox2Value,
} from "@/lib/countryInspection";

const AWB_REGEX = /^\d{8,}$/;
// For humans: wait 300ms after they stop typing (lets them type 12-14 digits)
const HUMAN_DEBOUNCE_MS = 300; 
// For scanners: auto-submit 30ms after the last keystroke (scanners type faster than 30ms)
const SCANNER_DEBOUNCE_MS = 30; 

interface ScanResult {
  found: true;
  justScanned: boolean;
  searchCount: number;
  scannedRaw?: string;
  matchedAwb?: string;
  bill: {
    id: string;
    awb_number: string;
    scan_status: "pending" | "scanned";
    extra_data: Record<string, any>;
    manifest_number: string;
    flight_number: string | null;
    manifest_upload_date: string;
  };
}

interface ScanStats {
  scanned: number;
  total: number;
  shortage: number;
  overage: number;
}

const OVERAGE_HOURS = 10;

export default function ScanningPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<"ok" | "warn" | "err" | null>(null);
  const [stats, setStats] = useState<ScanStats>({ scanned: 0, total: 0, shortage: 0, overage: 0 });
  const [indexSize, setIndexSize] = useState(0);
  
  const [showAlreadyScannedAlert, setShowAlreadyScannedAlert] = useState(false);

  const indexRef = useRef<Map<string, string>>(new Map());
  const latestManifestIdRef = useRef<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedRef = useRef<string | null>(null);
  const lastKeystrokeTime = useRef<number>(0); // Tracks typing speed

  useEffect(() => { inputRef.current?.focus(); }, []);

  /* ---------- Load client-side index (latest manifest only) ---------- */
  const loadIndex = useCallback(async () => {
    const { data: latestManifest } = await supabase
      .from("manifests")
      .select("id")
      .order("upload_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestManifest) {
      indexRef.current = new Map();
      latestManifestIdRef.current = null;
      setIndexSize(0);
      return;
    }

    if (latestManifestIdRef.current === latestManifest.id && indexRef.current.size > 0) return;

    const { data } = await supabase
      .from("bills")
      .select("id, awb_number")
      .eq("manifest_id", latestManifest.id);

    const map = new Map<string, string>();
    (data ?? []).forEach((r: any) => {
      const awb = String(r.awb_number);
      map.set(awb, r.id);
    });

    indexRef.current = map;
    latestManifestIdRef.current = latestManifest.id;
    setIndexSize((data ?? []).length);
  }, []);

  useEffect(() => {
    loadIndex();
    const ch = supabase
      .channel("scanning-index-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "manifests" }, loadIndex)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadIndex]);

  /* ---------- Live stats ---------- */
  useEffect(() => {
    async function loadStats() {
      const [reportRes, ageRes, latestManifestRes] = await Promise.all([
        supabase.from("manifest_report").select("manifest_id, total_bills, scanned_count, pending_count"),
        supabase.from("manifest_pending_age").select("manifest_id, oldest_pending_at"),
        supabase.from("manifests").select("id").order("upload_date", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const ageByManifest = new Map<string, string>();
      (ageRes.data ?? []).forEach((r: any) => ageByManifest.set(r.manifest_id, r.oldest_pending_at));

      const latestId = latestManifestRes.data?.id ?? null;

      let scanned = 0, total = 0, shortage = 0, overage = 0;
      const now = Date.now();
      (reportRes.data ?? []).forEach((m: any) => {
        const isLatest = latestId !== null && m.manifest_id === latestId;
        if (latestId === null || isLatest) {
          scanned += m.scanned_count ?? 0;
          total += m.total_bills ?? 0;
          shortage += m.pending_count ?? 0;
          const oldest = ageByManifest.get(m.manifest_id);
          if (oldest && (now - new Date(oldest).getTime()) / 36e5 >= OVERAGE_HOURS) {
            overage += m.pending_count ?? 0;
          }
        }
      });

      setStats({ scanned, total, shortage, overage });
    }
    loadStats();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleReload() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadStats, 350);
    }

    const ch = supabase
      .channel("scanning-stats-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "manifests" }, scheduleReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
      supabase.removeChannel(ch);
    };
  }, []);

  /* ---------- Submit ---------- */
  const submit = useCallback(async (raw: string) => {
    const awb = raw.trim().replace(/\s+/g, "");
    if (!awb) return;

    if (!AWB_REGEX.test(awb)) {
      setNotFound(`"${awb}" is not a valid tracking number.`);
      setResult(null); setFlash("err"); beep("err");
      lastSubmittedRef.current = awb;
      return;
    }

    const mySeq = ++requestSeq.current;
    setInput("");
    lastSubmittedRef.current = awb;
    setPending(true);
    setNotFound(null);
    setShowAlreadyScannedAlert(false);
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
        setResult(null); setFlash("err"); beep("err");
        return;
      }

      const data = await res.json();

      if (!data.found) {
        setNotFound(data.message ?? `Tracking number ${awb} not found.`);
        setResult(null); setFlash("err"); beep("err");
        return;
      }

      setResult(data as ScanResult);
      setNotFound(null);
      setFlash(data.justScanned ? "ok" : "warn");
      beep(data.justScanned ? "ok" : "warn");

      if (!data.justScanned) {
        setShowAlreadyScannedAlert(true);
      }
    } catch {
      if (mySeq !== requestSeq.current) return;
      setNotFound("Network error — could not reach the server.");
      setResult(null); setFlash("err"); beep("err");
    } finally {
      if (mySeq === requestSeq.current) setPending(false);
    }
  }, []);

  /* ---------- Input handlers ---------- */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    const now = Date.now();
    
    // Calculate how long it's been since the last keystroke
    const timeSinceLastKeystroke = now - lastKeystrokeTime.current;
    lastKeystrokeTime.current = now;

    setInput(value);

    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);

    const trimmed = value.trim().replace(/\s+/g, "");
    if (trimmed.length >= 8 && AWB_REGEX.test(trimmed)) {
      
      // If time since last keystroke < 30ms, it's a barcode scanner (typing extremely fast).
      // If it's > 30ms, it's a human typing.
      const isScanner = timeSinceLastKeystroke < 30;
      const delay = isScanner ? SCANNER_DEBOUNCE_MS : HUMAN_DEBOUNCE_MS;

      autoSubmitTimer.current = setTimeout(() => {
        // For humans, we check if they stopped typing for the full HUMAN_DEBOUNCE_MS.
        // If they pressed another key, this timer is cleared. 
        // Since humans want to press Enter, we ONLY auto-submit here if it's a scanner.
        
        if (isScanner) {
          if (pending && lastSubmittedRef.current === trimmed) return;
          submit(trimmed);
        }
        // If it's a human, we do NOT submit automatically. We wait for them to press Enter.
      }, delay);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
      submit(input); // Manual Enter always triggers submission
    }
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
    lastSubmittedRef.current = null;
    setShowAlreadyScannedAlert(false);
    lastKeystrokeTime.current = 0; // Reset typing speed
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    requestSeq.current++;
    inputRef.current?.focus();
  }

  /* ---------- Derived ---------- */
  const inspection = useMemo(() => {
    if (!result) return null;
    const rawCode = result.bill.extra_data?.[COUNTRY_CODE_COLUMN_HEADER];
    return evaluateCountry(rawCode);
  }, [result]);

  const aeBox2Value = useMemo(() => {
    if (!result) return "";
    return getAeBox2Value(result.bill.extra_data);
  }, [result]);

  const box2Lines = useMemo(() => {
    const lines: string[] = [];
    if (inspection?.namedPhysicalLine) lines.push(inspection.namedPhysicalLine);
    if (aeBox2Value) lines.push(aeBox2Value);
    return lines;
  }, [inspection, aeBox2Value]);

  const vatTinValue = result?.bill.extra_data?.["VAT ID#/TIN#"];
  const hasQidP2pOrOnlineQidInVatTin = /CID|P2P|ONLINE_QID/i.test(String(vatTinValue ?? ""));
  const isRed = inspection?.level === "red" || hasQidP2pOrOnlineQidInVatTin;
  const box1Text = inspection?.level === "red" ? (inspection?.box1Message ?? "") : "";
  const box1Class = isRed ? "insp-box-red" : "insp-box-green";

  const trackingNumberText = result ? result.bill.awb_number : "—";
  const flightNoText = result ? (result.bill.flight_number || "—") : "—";
  const manifestCodeText = result ? result.bill.manifest_number : "—";

  const statusLabel = !result
    ? "—"
    : result.justScanned
      ? "SCANNED NOW"
      : "ALREADY SCANNED";

  const scanPct = stats.total === 0 ? 0 : Math.round((stats.scanned / stats.total) * 100);

  return (
    <div className="scan-page scan-page-fit">
      {/* ===== MODAL OVERLAY ===== */}
      {showAlreadyScannedAlert && result && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}>
          <div style={{
            background: "white",
            borderRadius: "16px",
            padding: "32px",
            width: "100%",
            maxWidth: "440px",
            textAlign: "center",
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)"
          }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "50%",
              background: "#fef3c7", color: "#d97706",
              display: "grid", placeItems: "center", margin: "0 auto 16px"
            }}>
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 2 20h20L12 3z" />
                <path d="M12 9v5" />
                <circle cx="12" cy="17" r=".6" fill="currentColor" />
              </svg>
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--ink)", marginBottom: "8px" }}>
              Already Scanned
            </h2>
            <p style={{ fontSize: "0.95rem", color: "var(--ink-muted)", marginBottom: "24px" }}>
              Tracking Number <strong style={{ color: "var(--ink)" }}>{result.bill.awb_number}</strong> was already scanned (Search Count: {result.searchCount}).
            </p>
            <button
              className="btn btn-primary"
              style={{ width: "100%", height: "48px", fontSize: "1rem" }}
              onClick={() => setShowAlreadyScannedAlert(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="page-header scan-page-header">
        <div>
          <h1 className="page-title">Scan Shipments</h1>
        </div>
        <div className="page-header-actions">
          <span className="live-pill" title="Bills available for instant lookup in the current manifest">
            Index: {indexSize} bill{indexSize === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="scan-panel scan-page-panel">
        <div className="scan-panel-row">
          <div className="scan-panel-input-wrap">
            <input
              ref={inputRef}
              value={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Scan barcode or type tracking number"
              autoFocus inputMode="numeric" autoComplete="off" spellCheck={false}
              className={`scan-input${flash ? ` scan-input-${flash}` : ""}`}
            />
            {pending && (
              <span className="scan-pending-indicator">
                <span className="mini-spinner" /> Looking up…
              </span>
            )}
          </div>

          <button type="button" className="btn btn-outline scan-clear-btn" onClick={clearAll}>
            Reset
          </button>
        </div>
      </div>

      {notFound && <p className="scan-alert scan-page-alert">{notFound}</p>}

      <div className="scan-field-row scan-page-row scan-field-row-tracking">
        <div className="scan-field-group">
          <div className="scan-field-label">Tracking Number</div>
          <div className="scan-readonly mono scan-readonly-hero">{trackingNumberText}</div>
        </div>
        <div className="scan-field-group">
          <div className="scan-field-label">Status</div>
          <div className={`scan-readonly mono scan-readonly-status${result ? (result.justScanned ? " scan-readonly-ok" : " scan-readonly-warn") : ""}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="scan-field-group scan-page-row scan-field-desc">
        <div className="scan-field-label">Manifest Description</div>
        <div className={`insp-textarea ${result ? box1Class : "insp-box-green"}`}>
          {result ? box1Text : "—"}
        </div>
        {result && box2Lines.length > 0 && (
          <div className={`insp-box2 ${isRed ? "insp-box2-red" : ""}`}>
            {box2Lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>

      <div className="scan-field-row scan-page-row">
        <div className="scan-field-group">
          <div className="scan-field-label">Flight No</div>
          <div className="scan-readonly mono scan-readonly-hero">{flightNoText}</div>
        </div>
        <div className="scan-field-group">
          <div className="scan-field-label">Manifest Code</div>
          <div className="scan-readonly mono scan-readonly-hero">{manifestCodeText}</div>
        </div>
      </div>

      <div className="scan-stats-row scan-page-row">
        <div className="scan-stat-pill scan-stat-hero">
          <div className="scan-stat-total-badge">
            Total <strong>{stats.total}</strong>
          </div>
          <div className="scan-stat-hero-value">
            {stats.scanned}
            <span className="scan-stat-hero-sep">/</span>
            <span className="scan-stat-hero-total">{stats.total}</span>
          </div>
          <div className="scan-stat-label">Scanned</div>
          <div className="scan-stat-pct">{scanPct}% complete</div>
        </div>

        <div className="scan-stat-pill">
          <div className="scan-stat-value warning">{stats.shortage}</div>
          <div className="scan-stat-label">Shortage</div>
        </div>

        <div className="scan-stat-pill">
          <div className="scan-stat-value danger">{stats.overage}</div>
          <div className="scan-stat-label">Overage</div>
        </div>
      </div>
    </div>
  );
}