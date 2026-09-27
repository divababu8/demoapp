"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/* =====================================================================
   COLUMN MAPPING
   --------------------------------------------------------------------
   Excel headers are messy and inconsistent. This section maps raw
   header text -> friendly display label + internal filter key.
   Storage keys in extra_data are NEVER changed — only the display.
   ===================================================================== */

/* Flight No lives in the "VAT ID#/TIN#" column of the Excel. */
const FLIGHT_KEYS = [
  "VAT ID#/TIN#",
  "Flight No",
  "Flight No.",
  "Flight",
  "FLIGHT",
  "flight_no",
  "flightNo",
];

/* Airport = recipient country in the current Excel template.
   Falls back to any of the common airport header names if present. */
const AIRPORT_KEYS = [
  "Recip Ctry",
  "Airport",
  "Airport Code",
  "Destination",
  "Port",
  "AIRPORT",
  "airport",
];

/* Friendly labels shown in the table header. */
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

/* Canonical column order — matches the real Excel template exactly, left
   to right, so the table reflects the file's actual layout instead of an
   alphabetically-sorted (and therefore scrambled-looking) column list.
   "Tracking Number" is excluded here since it's rendered as the dedicated
   AWB column, not a dynamic one. */
const CANONICAL_COLUMN_ORDER = [
  "Shpr Co.", "Shpr Name", "Shpr Addr", "Shpr City", "ShprState", "Shpr Ctry", "Shpr Zip",
  "Recip Co.", "Recip Name", "Recip Addr", "Recip City", "Recip State", "Recip Ctry", "Recip Zip",
  "Service", "Commit Date", "Commit Time", "Shpr Phone", "Recip Phone", "Shpr Ref Notes",
  "No Pieces", "Master Tracking Nbr", "Special Handling Codes", "Shpmt Weight", "UOM",
  "HSCODE", "Commodity Desc", "Custom Value", "Currency", "VAT ID#/TIN#", "Remarks",
  "CountryofOriginCoded", "CertificateNumber", "TransactionType", "ImporterCode",
  "INCOTERMSCoded", "fright Costs", "ExemptionTypeCoded", "ApprovalNumber",
  "SettlementIndicator", "Brand", "Model", "MOPHRegNo", "PaymentMode", "DecSubmitType",
];

/* Columns shown by default before "Show all columns" is clicked — keeps
   the table readable at a glance for 40+ columns without hiding data;
   the toggle below defaults to showing everything on page load. */
const DEFAULT_VISIBLE = new Set<string>([
  "Service",
  "No Pieces",
  "Shpmt Weight",
  "UOM",
  "Recip Name",
  "Recip City",
  "Recip Ctry",
  "Commit Date",
]);

/* =====================================================================
   TYPES
   ===================================================================== */
interface ManifestOption {
  id: string;
  manifest_number: string;
  upload_date: string;
}

interface ShipmentRow {
  id: string;
  awb_number: string;
  scan_status: "pending" | "scanned";
  scanned_at: string | null;
  created_at: string;
  extra_data: Record<string, any>;
  manifest_id: string;
  manifest_number: string;
  manifest_upload_date: string;
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pickByKeys(row: ShipmentRow, keys: string[]): string {
  for (const k of keys) {
    const v = row.extra_data?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "–";
}

const getFlight = (r: ShipmentRow) => pickByKeys(r, FLIGHT_KEYS);
const getAirport = (r: ShipmentRow) => pickByKeys(r, AIRPORT_KEYS);

/* =====================================================================
   PAGE
   ===================================================================== */
export default function ShipmentsPage() {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [manifests, setManifests] = useState<ManifestOption[]>([]);
  const [loading, setLoading] = useState(true);
  // Defaults to true so every uploaded column is visible on page load —
  // previously this defaulted to false and only 8 of ~42 columns showed
  // until the user found and clicked "Show all columns".
  const [showAllColumns, setShowAllColumns] = useState(true);

  /* ---- filters ---- */
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [manifestFilter, setManifestFilter] = useState<string>("all");
  const [flightFilter, setFlightFilter] = useState("");
  const [airportFilter, setAirportFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "scanned" | "pending">("all");
  const [customSearch, setCustomSearch] = useState("");

  /* ---------- loaders ---------- */
  async function loadManifests() {
    const { data } = await supabase
      .from("manifests")
      .select("id, manifest_number, upload_date")
      .order("upload_date", { ascending: true }); // oldest first
    setManifests(data ?? []);
  }

  async function loadRows() {
    setLoading(true);

    let q = supabase
      .from("bills")
      .select(
        "id, awb_number, scan_status, scanned_at, created_at, extra_data, manifest_id, manifests(manifest_number, upload_date)"
      )
      .gte("created_at", `${dateFrom}T00:00:00`)
      .lte("created_at", `${dateTo}T23:59:59`)
      .order("created_at", { ascending: true }) // oldest (today's first upload) on top
      .limit(2000);

    if (manifestFilter !== "all") q = q.eq("manifest_id", manifestFilter);
    if (statusFilter !== "all") q = q.eq("scan_status", statusFilter);

    const { data, error } = await q;
    if (error || !data) {
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(
      data.map((r: any) => ({
        id: r.id,
        awb_number: r.awb_number,
        scan_status: r.scan_status,
        scanned_at: r.scanned_at,
        created_at: r.created_at,
        extra_data: r.extra_data ?? {},
        manifest_id: r.manifest_id,
        manifest_number: r.manifests?.manifest_number ?? "–",
        manifest_upload_date: r.manifests?.upload_date ?? r.created_at,
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    loadManifests();
  }, []);

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, manifestFilter, statusFilter]);

  /* Realtime: refresh on any bills change, debounced. Each reload here
     re-fetches up to 2000 rows with every column, so without debouncing,
     rapid-fire scans (2 people scanning) would trigger that full reload
     on every single row change — this batches a burst into one reload
     shortly after things settle. */
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleReload() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadRows, 350);
    }

    const ch = supabase
      .channel("shipments-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, scheduleReload)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, manifestFilter, statusFilter]);

  /* ---------- derived: airport options ---------- */
  const airportOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const a = getAirport(r);
      if (a !== "–") set.add(a);
    });
    return Array.from(set).sort();
  }, [rows]);

  /* ---------- derived: filtered rows ---------- */
  const filtered = useMemo(() => {
    const flightQ = flightFilter.trim().toLowerCase();
    const searchQ = customSearch.trim().toLowerCase();

    return rows.filter((r) => {
      if (flightQ && !getFlight(r).toLowerCase().includes(flightQ)) return false;
      if (airportFilter !== "all" && getAirport(r) !== airportFilter) return false;
      if (searchQ) {
        const hay = [
          r.awb_number,
          r.manifest_number,
          getFlight(r),
          getAirport(r),
          ...Object.values(r.extra_data ?? {}).map((v) => (v == null ? "" : String(v))),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });
  }, [rows, flightFilter, airportFilter, customSearch]);

  /* ---------- derived: KPIs ---------- */
  const stats = useMemo(() => {
    const total = filtered.length;
    const scanned = filtered.filter((r) => r.scan_status === "scanned").length;
    return { total, scanned, pending: total - scanned };
  }, [filtered]);

  /* ---------- derived: extra columns ---------- */
  const allExtraKeys = useMemo(() => {
    const present = new Set<string>();
    filtered.forEach((r) =>
      Object.keys(r.extra_data ?? {}).forEach((k) => present.add(k))
    );
    // Flight and Airport are both rendered as their own dedicated columns
    // above — exclude both from the dynamic list so they don't also show
    // up a second time further right. (Previously only Flight was
    // excluded, so "Recip Ctry" could appear twice.)
    FLIGHT_KEYS.forEach((k) => present.delete(k));
    AIRPORT_KEYS.forEach((k) => present.delete(k));

    // Order by the real Excel column order, not alphabetically — keeps the
    // table matching the file's actual left-to-right layout. Any column
    // present in the data but not in the canonical list (e.g. a future
    // template change) is appended at the end rather than silently dropped.
    const known = CANONICAL_COLUMN_ORDER.filter((k) => present.has(k));
    const unknown = Array.from(present).filter(
      (k) => !CANONICAL_COLUMN_ORDER.includes(k)
    );
    return [...known, ...unknown];
  }, [filtered]);

  const visibleExtraKeys = useMemo(
    () =>
      showAllColumns
        ? allExtraKeys
        : allExtraKeys.filter((k) => DEFAULT_VISIBLE.has(k)),
    [allExtraKeys, showAllColumns]
  );

  /* ---------- actions ---------- */
  function handleReset() {
    setDateFrom(todayISO());
    setDateTo(todayISO());
    setManifestFilter("all");
    setFlightFilter("");
    setAirportFilter("all");
    setStatusFilter("all");
    setCustomSearch("");
  }

  /* ---------- render ---------- */
  const colSpan = 7 + visibleExtraKeys.length;

  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Shipments</h1>
          <p className="page-subtitle">
            All bills across manifests · {new Date(dateFrom).toLocaleDateString()} →{" "}
            {new Date(dateTo).toLocaleDateString()}
          </p>
        </div>
        <div className="page-header-actions">
          <span className="live-pill">
            <span className="live-dot" /> Live
          </span>
          <button
            className="btn btn-outline"
            onClick={() => setShowAllColumns((v) => !v)}
            type="button"
          >
            {showAllColumns ? "Show fewer columns" : "Show all columns"}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => window.print()}
            type="button"
          >
            Print
          </button>
        </div>
      </div>

      {/* ============ KPI CARDS ============ */}
      <div className="kpi-grid">
        <div className="kpi-card kpi-accent">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 7 9-4 9 4-9 4-9-4z" />
                <path d="M3 7v10l9 4 9-4V7" />
                <path d="M12 11v10" />
              </svg>
            </div>
            <div className="kpi-value">{stats.total}</div>
          </div>
          <div className="kpi-label">Total bills</div>
          <div className="kpi-hint">In current view</div>
        </div>

        <div className="kpi-card kpi-success">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12 3 3 5-6" />
              </svg>
            </div>
            <div className="kpi-value">{stats.scanned}</div>
          </div>
          <div className="kpi-label">Scanned</div>
          <div className="kpi-hint">
            {stats.total === 0
              ? "–"
              : `${((stats.scanned / stats.total) * 100).toFixed(1)}% complete`}
          </div>
        </div>

        <div className="kpi-card kpi-warning">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="kpi-value">{stats.pending}</div>
          </div>
          <div className="kpi-label">Pending</div>
          <div className="kpi-hint">Awaiting scan</div>
        </div>

        <div className="kpi-card kpi-primary">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20V10" />
                <path d="M10 20V4" />
                <path d="M16 20v-7" />
                <path d="M22 20H2" />
              </svg>
            </div>
            <div className="kpi-value">{manifests.length}</div>
          </div>
          <div className="kpi-label">Manifests</div>
          <div className="kpi-hint">Total uploaded</div>
        </div>
      </div>

      {/* ============ FILTERS ============ */}
      <div className="filter-panel">
        <div className="filter-bar">
          <div className="field">
            <label>Manifest #</label>
            <select
              value={manifestFilter}
              onChange={(e) => setManifestFilter(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="all">All manifests ({manifests.length})</option>
              {manifests.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.manifest_number}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Flight No</label>
            <input
              value={flightFilter}
              onChange={(e) => setFlightFilter(e.target.value)}
              placeholder="e.g. QR123"
            />
          </div>

          <div className="field">
            <label>Airport</label>
            <select
              value={airportFilter}
              onChange={(e) => setAirportFilter(e.target.value)}
              style={{ minWidth: 160 }}
            >
              <option value="all">All airports</option>
              {airportOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Scan status</label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "scanned" | "pending")
              }
            >
              <option value="all">All</option>
              <option value="scanned">Scanned</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          <div className="field">
            <label>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div className="field">
            <label>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Custom search</label>
            <input
              value={customSearch}
              onChange={(e) => setCustomSearch(e.target.value)}
              placeholder="AWB, manifest, flight, airport, or any cell"
            />
          </div>

          <button className="btn btn-outline" onClick={handleReset} type="button">
            Reset
          </button>
          <button className="btn btn-primary" onClick={loadRows} type="button">
            Refresh
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            fontSize: "0.82rem",
            color: "var(--ink-muted)",
          }}
        >
          <strong style={{ color: "var(--ink)" }}>Count:</strong>{" "}
          {filtered.length} of {rows.length} rows
          {manifestFilter !== "all" && " · manifest filter applied"}
          {airportFilter !== "all" && ` · airport: ${airportFilter}`}
          {flightFilter && ` · flight: ${flightFilter}`}
          {customSearch && ` · search: "${customSearch}"`}
        </div>
      </div>

      {/* ============ TABLE ============ */}
      <div className="table-wrap">
        <div style={{ overflowX: "auto", maxHeight: "72vh" }}>
          <table className="data-table">
            <thead>
              <tr>
                {/* Sticky col 1: Manifest # */}
                <th className="sticky-col" style={{ left: 0, minWidth: 180 }}>
                  Manifest #
                </th>
                <th>Uploaded</th>
                <th>Flight No</th>
                <th>Airport</th>

                {/* Sticky col 2: AWB (last frozen column — gets the divider shadow) */}
                <th
                  className="sticky-col sticky-col-divider"
                  style={{ left: 180, minWidth: 140 }}
                >
                  AWB Number
                </th>

                <th>Scan Status</th>
                <th>Scanned At</th>

                {visibleExtraKeys.map((col) => (
                  <th key={col}>{LABEL_MAP[col] ?? col}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={colSpan}>
                    <p className="empty-note">Loading…</p>
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="mono sticky-col" style={{ left: 0 }}>
                      {r.manifest_number}
                    </td>
                    <td>{fmtDateTime(r.manifest_upload_date)}</td>
                    <td className="mono">{getFlight(r)}</td>
                    <td>{getAirport(r)}</td>

                    <td
                      className="mono sticky-col sticky-col-divider"
                      style={{ left: 180 }}
                    >
                      {r.awb_number}
                    </td>

                    <td>
                      <span
                        className={`badge ${
                          r.scan_status === "scanned"
                            ? "badge-scanned"
                            : "badge-pending"
                        }`}
                      >
                        {r.scan_status}
                      </span>
                    </td>
                    <td>{fmtDateTime(r.scanned_at)}</td>

                    {visibleExtraKeys.map((col) => (
                      <td key={col}>
                        {r.extra_data[col] === null ||
                        r.extra_data[col] === undefined
                          ? "–"
                          : String(r.extra_data[col])}
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={colSpan}>
                    <p className="empty-note">
                      No shipments match the current filters.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}