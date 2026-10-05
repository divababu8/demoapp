"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthHeader, supabase } from "@/lib/supabaseClient";
import { COUNTRY_CODE_COLUMN_HEADER, evaluateCountry } from "@/lib/countryInspection";

const AWB_REGEX = /^\d{4,20}$/;

/* =====================================================================
   TYPES
   ===================================================================== */
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
  shortage: number;
  overage: number;
}

const OVERAGE_HOURS = 10;

/* =====================================================================
   PAGE
   ===================================================================== */
export default function ScanningPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<"ok" | "warn" | "err" | null>(null);
  const [stats, setStats] = useState<ScanStats>({ scanned: 0, shortage: 0, overage: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  /* ---------- Scan count / shortage / overage — live totals ---------- */
  useEffect(() => {
    async function loadStats() {
      const [reportRes, ageRes] = await Promise.all([
        supabase.from("manifest_report").select("manifest_id, scanned_count, pending_count"),
        supabase.from("manifest_pending_age").select("manifest_id, oldest_pending_at"),
      ]);

      const ageByManifest = new Map<string, string>();
      (ageRes.data ?? []).forEach((r: any) => ageByManifest.set(r.manifest_id, r.oldest_pending_at));

      let scanned = 0;
      let shortage = 0;
      let overage = 0;
      const now = Date.now();

      (reportRes.data ?? []).forEach((m: any) => {
        scanned += m.scanned_count ?? 0;
        shortage += m.pending_count ?? 0;
        const oldest = ageByManifest.get(m.manifest_id);
        if (oldest && (now - new Date(oldest).getTime()) / 36e5 >= OVERAGE_HOURS) {
          overage += m.pending_count ?? 0;
        }
      });

      setStats({ scanned, shortage, overage });
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
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
  }, []);

  /* ---------- Re-fetch full bill if the RPC returned a partial one ----------
     The scan_bill() RPC returns a minimal bill on repeat lookups (this is
     what caused blank Tracking Number / Manifest Code on "Already scanned").
     This fetches the full bill directly from the `bills` table joined with
     `manifests`, and merges it in, so all fields always populate identically
     whether it's a first-time scan or a repeat.                              */
  async function hydrateBill(partial: ScanResult): Promise<ScanResult> {
    const needsFetch =
      !partial.bill?.awb_number ||
      !partial.bill?.manifest_number ||
      !partial.bill?.flight_number ||
      !partial.bill?.extra_data ||
      Object.keys(partial.bill.extra_data ?? {}).length === 0;

    if (!needsFetch) return partial;

    // We need to find the bill by AWB. `matchedAwb` is the true stored AWB
    // (the RPC tells us which one it matched); fall back to what we typed.
    const awbToLookup = partial.matchedAwb || partial.bill?.awb_number;
    if (!awbToLookup) return partial;

    const { data } = await supabase
      .from("bills")
      .select("id, awb_number, scan_status, extra_data, manifest_id, manifests(manifest_number, flight_number, upload_date)")
      .eq("awb_number", awbToLookup)
      .maybeSingle();

    if (!data) return partial;

    const m: any = (data as any).manifests ?? {};

    return {
      ...partial,
      bill: {
        id: data.id,
        awb_number: data.awb_number,
        scan_status: data.scan_status,
        extra_data: data.extra_data ?? {},
        manifest_number: m.manifest_number ?? partial.bill.manifest_number ?? "—",
        flight_number: m.flight_number ?? null,
        manifest_upload_date: m.upload_date ?? partial.bill.manifest_upload_date ?? "—",
      },
    };
  }

  /* ---------- Submit ---------- */
  const submit = useCallback(async (raw: string) => {
    const awb = raw.trim();
    if (!awb) return;

    if (!AWB_REGEX.test(awb)) {
      setNotFound(`"${awb}" is not a valid number — enter the full tracking number only.`);
      setResult(null); setFlash("err"); beep("err");
      return;
    }

    const mySeq = ++requestSeq.current;
    setInput(""); setPending(true); setNotFound(null);
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
        setNotFound(data.message ?? `Tracking number ${awb} not found.`);
        setResult(null); setFlash("err"); beep("err"); return;
      }

      // Hydrate — ensures full bill detail is present even on repeat scans
      const full = await hydrateBill(data as ScanResult);
      if (mySeq !== requestSeq.current) return;

      setResult(full);
      setNotFound(null);
      setFlash(full.justScanned ? "ok" : "warn");
      beep(full.justScanned ? "ok" : "warn");
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
      submit(input);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
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
    requestSeq.current++;
    inputRef.current?.focus();
  }

  /* ---------- Derived ---------- */
  const inspection = useMemo(() => {
    if (!result) return null;
    const rawCode = result.bill.extra_data?.[COUNTRY_CODE_COLUMN_HEADER];
    return evaluateCountry(rawCode);
  }, [result]);

  const trackingNumberText = result ? result.bill.awb_number : "—";
  const flightNoText = result ? (result.bill.flight_number || "—") : "—";
  const manifestCodeText = result ? result.bill.manifest_number : "—";

  const statusLabel = !result
    ? "—"
    : result.justScanned
      ? "SCANNED NOW"
      : `ALREADY SCANNED (searched ${result.searchCount}×)`;

  return (
    <div className="scan-page">
      <div className="page-header scan-page-header">
        <div>
          <h1 className="page-title">Scan Shipments</h1>
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
              placeholder="Scan barcode or type tracking number, then Enter"
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
            onClick={() => submit(input)}
            disabled={pending || input.trim().length === 0}
          >
            Submit
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
      </div>

      {notFound && <p className="scan-alert scan-page-alert">{notFound}</p>}

      <div className="scan-field-row scan-page-row">
        <div className="scan-field-group">
          <div className="scan-field-label">Tracking Number</div>
          <div className="scan-readonly mono">{trackingNumberText}</div>
        </div>
        <div className="scan-field-group">
          <div className="scan-field-label">Status</div>
          <div className={`scan-readonly mono${result ? (result.justScanned ? " scan-readonly-ok" : " scan-readonly-warn") : ""}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      <div className="scan-field-group scan-page-row">
        <div className="scan-field-label">Manifest Description</div>
        <textarea
          readOnly
          rows={2}
          value={
            inspection
              ? inspection.level === "red"
                ? inspection.box1Message
                : `${inspection.countryCode || "—"} — CLEARED`
              : "—"
          }
          className={`insp-textarea ${inspection ? (inspection.level === "red" ? "insp-box-red" : "insp-box-green") : "insp-box-green"}`}
        />
        {inspection && inspection.level === "red" && inspection.box2Message && (
          <div className="insp-box2 insp-box2-red">{inspection.box2Message}</div>
        )}
      </div>

      <div className="scan-field-row scan-page-row">
        <div className="scan-field-group">
          <div className="scan-field-label">Flight No</div>
          <div className="scan-readonly mono">{flightNoText}</div>
        </div>
        <div className="scan-field-group">
          <div className="scan-field-label">Manifest Code</div>
          <div className="scan-readonly mono scan-readonly-big">{manifestCodeText}</div>
        </div>
      </div>

      <div className="scan-stats-row scan-page-row">
        <div className="scan-stat-pill">
          <div className="scan-stat-value">{stats.scanned}</div>
          <div className="scan-stat-label">Scan Count</div>
        </div>
        <div className="scan-stat-pill">
          <div className="scan-stat-value">{stats.shortage}</div>
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