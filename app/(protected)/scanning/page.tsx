"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAuthHeader, supabase } from "@/lib/supabaseClient";
import {
  COUNTRY_CODE_COLUMN_HEADER,
  BOX2_MESSAGE_COLUMN_HEADER,
  evaluateCountry,
} from "@/lib/countryInspection";

const AWB_REGEX = /^\d{8,32}$/;
const AUTO_SUBMIT_DEBOUNCE_MS = 140;

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

interface ScanStats { scanned: number; shortage: number; overage: number; }

const OVERAGE_HOURS = 10;

export default function ScanningPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useState<"ok" | "warn" | "err" | null>(null);
  const [stats, setStats] = useState<ScanStats>({ scanned: 0, shortage: 0, overage: 0 });
  const [indexSize, setIndexSize] = useState(0);

  const indexRef = useRef<Map<string, string>>(new Map());
  const latestManifestIdRef = useRef<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedRef = useRef<string | null>(null);

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
      if (awb.length > 8) map.set(awb.slice(-8), r.id);
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
      const [reportRes, ageRes] = await Promise.all([
        supabase.from("manifest_report").select("manifest_id, scanned_count, pending_count"),
        supabase.from("manifest_pending_age").select("manifest_id, oldest_pending_at"),
      ]);
      const ageByManifest = new Map<string, string>();
      (ageRes.data ?? []).forEach((r: any) => ageByManifest.set(r.manifest_id, r.oldest_pending_at));

      let scanned = 0, shortage = 0, overage = 0;
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
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
      supabase.removeChannel(ch);
    };
  }, []);

  /* ---------- Submit ---------- */
  const submit = useCallback(async (raw: string) => {
    const awb = raw.trim();
    if (!awb) return;

    if (!AWB_REGEX.test(awb)) {
      setNotFound(`"${awb}" is not a valid tracking number.`);
      setResult(null); setFlash("err"); beep("err");
      lastSubmittedRef.current = awb;
      return;
    }

    const map = indexRef.current;
    const exactHit = map.has(awb);
    const suffixHit = !exactHit && awb.length > 8 && map.has(awb.slice(-8));

    if (map.size > 0 && !exactHit && !suffixHit) {
      setNotFound(`Tracking number ${awb} not found in the current manifest (${indexSize} bills loaded).`);
      setResult(null); setFlash("err"); beep("err");
      lastSubmittedRef.current = awb;
      return;
    }

    const mySeq = ++requestSeq.current;
    setInput("");
    lastSubmittedRef.current = awb;
    setPending(true);
    setNotFound(null);
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
    } catch {
      if (mySeq !== requestSeq.current) return;
      setNotFound("Network error — could not reach the server.");
      setResult(null); setFlash("err"); beep("err");
    } finally {
      if (mySeq === requestSeq.current) setPending(false);
    }
  }, [indexSize]);

  /* ---------- Input handlers ---------- */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInput(value);

    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);

    const trimmed = value.trim();
    if (trimmed.length >= 8 && AWB_REGEX.test(trimmed)) {
      autoSubmitTimer.current = setTimeout(() => {
        if (pending && lastSubmittedRef.current === trimmed) return;
        submit(trimmed);
      }, AUTO_SUBMIT_DEBOUNCE_MS);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
      submit(input);
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

  // Box2 message — always read from AE (VAT ID#/TIN#), regardless of country
  const box2Message = useMemo(() => {
    if (!result) return "";
    const raw = result.bill.extra_data?.[BOX2_MESSAGE_COLUMN_HEADER];
    if (raw === null || raw === undefined) return "";
    return String(raw).trim();
  }, [result]);

  const trackingNumberText = result ? result.bill.awb_number : "—";
  const flightNoText = result ? (result.bill.flight_number || "—") : "—";
  const manifestCodeText = result ? result.bill.manifest_number : "—";

  const statusLabel = !result
    ? "—"
    : result.justScanned
      ? "SCANNED NOW"
      : `ALREADY SCANNED (searched ${result.searchCount}×)`;

  // Box1: red with inspection message if country flagged; empty green otherwise
  const isRed = inspection?.level === "red";
  const box1Text = isRed ? (inspection?.box1Message ?? "") : "";
  const box1Class = isRed ? "insp-box-red" : "insp-box-green";

  return (
    <div className="scan-page">
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
          value={result ? box1Text : "—"}
          className={`insp-textarea ${result ? box1Class : "insp-box-green"}`}
        />
        {result && box2Message && (
          <div className={`insp-box2 ${isRed ? "insp-box2-red" : ""}`}>
            {box2Message}
          </div>
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