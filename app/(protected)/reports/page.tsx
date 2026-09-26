"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* =====================================================================
   TYPES + HELPERS
   ===================================================================== */
interface ReportRow {
  manifest_id: string;
  manifest_number: string;
  upload_date: string;
  total_bills: number;
  scanned_count: number;
  pending_count: number;
  total_search_count: number;
}

type StatusFilter = "all" | "complete" | "inprogress" | "overage";
type DatePreset = "today" | "yesterday" | "7d" | "30d" | "month" | "custom";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function shiftISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthISO() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* =====================================================================
   PAGE
   ===================================================================== */
export default function ReportsPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  /* ---- date range ---- */
  const [preset, setPreset] = useState<DatePreset>("today");
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());

  /* ---- filters ---- */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [customSearch, setCustomSearch] = useState("");

  /* ---- apply preset ---- */
  useEffect(() => {
    const today = todayISO();
    switch (preset) {
      case "today":
        setDateFrom(today);
        setDateTo(today);
        break;
      case "yesterday": {
        const y = shiftISO(-1);
        setDateFrom(y);
        setDateTo(y);
        break;
      }
      case "7d":
        setDateFrom(shiftISO(-6));
        setDateTo(today);
        break;
      case "30d":
        setDateFrom(shiftISO(-29));
        setDateTo(today);
        break;
      case "month":
        setDateFrom(firstOfMonthISO());
        setDateTo(today);
        break;
      case "custom":
        // user is in control
        break;
    }
  }, [preset]);

  /* ---- load data ---- */
  async function loadReport() {
    setLoading(true);
    const { data, error } = await supabase
      .from("manifest_report")
      .select("*")
      .gte("upload_date", `${dateFrom}T00:00:00`)
      .lte("upload_date", `${dateTo}T23:59:59`)
      .order("upload_date", { ascending: false });

    if (!error) setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- filter rows client-side ---- */
  const filtered = useMemo(() => {
    const searchQ = customSearch.trim().toLowerCase();

    return rows.filter((r) => {
      // Status filter
      if (statusFilter === "complete" && r.pending_count > 0) return false;
      if (statusFilter === "inprogress" && r.pending_count === 0) return false;
      if (statusFilter === "overage" && r.pending_count === 0) return false;

      // Custom search
      if (searchQ) {
        const hay = [
          r.manifest_number,
          r.upload_date,
          r.total_bills,
          r.scanned_count,
          r.pending_count,
          r.total_search_count,
          r.pending_count === 0
            ? "complete"
            : r.pending_count > 0
            ? "in progress overage"
            : "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }

      return true;
    });
  }, [rows, statusFilter, customSearch]);

  /* ---- KPIs (from the filtered set) ---- */
  const totals = useMemo(() => {
    const bills = filtered.reduce((s, r) => s + r.total_bills, 0);
    const scanned = filtered.reduce((s, r) => s + r.scanned_count, 0);
    const pending = filtered.reduce((s, r) => s + r.pending_count, 0);
    const searches = filtered.reduce((s, r) => s + r.total_search_count, 0);
    const completion = bills === 0 ? 0 : (scanned / bills) * 100;
    const avgSearchesPerBill =
      bills === 0 ? 0 : +(searches / bills).toFixed(2);
    return { bills, scanned, pending, searches, completion, avgSearchesPerBill };
  }, [filtered]);

  /* ---- table data (for export) ---- */
  const columns = [
    "Manifest #",
    "Upload Date",
    "Total Bills",
    "Scanned",
    "Pending",
    "Completion %",
    "Total Searches",
  ];

  const tableData = filtered.map((r) => [
    r.manifest_number,
    fmtDateTime(r.upload_date),
    r.total_bills,
    r.scanned_count,
    r.pending_count,
    r.total_bills === 0
      ? "0.0%"
      : `${((r.scanned_count / r.total_bills) * 100).toFixed(1)}%`,
    r.total_search_count,
  ]);

  /* ---- exports ---- */
  function exportExcel() {
    const summary = [
      ["Manifest Scanning Report"],
      [`Date range: ${dateFrom} → ${dateTo}`],
      [`Generated: ${new Date().toLocaleString()}`],
      [],
      [
        "Total manifests",
        filtered.length,
        "Total bills",
        totals.bills,
        "Scanned",
        totals.scanned,
        "Pending",
        totals.pending,
        "Completion",
        `${totals.completion.toFixed(1)}%`,
        "Searches",
        totals.searches,
      ],
      [],
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([
      ...summary,
      columns,
      ...tableData,
    ]);
    worksheet["!cols"] = columns.map((_, i) => ({ wch: i === 1 ? 22 : 16 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Manifest Report");
    XLSX.writeFile(
      workbook,
      `Manifest_Report_${dateFrom}_to_${dateTo}.xlsx`
    );
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Manifest Scanning Report", 14, 16);
    doc.setFontSize(10);
    doc.text(`Date range: ${dateFrom} → ${dateTo}`, 14, 23);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    // Summary line
    doc.setFontSize(10);
    doc.text(
      `Manifests: ${filtered.length}   Bills: ${totals.bills}   Scanned: ${totals.scanned}   Pending: ${totals.pending}   Completion: ${totals.completion.toFixed(
        1
      )}%   Searches: ${totals.searches}`,
      14,
      35
    );

    autoTable(doc, {
      head: [columns],
      body: tableData,
      startY: 42,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [81, 181, 109] }, // accent green
      alternateRowStyles: { fillColor: [248, 250, 249] },
      foot: [
        [
          `Total (${filtered.length})`,
          "",
          totals.bills,
          totals.scanned,
          totals.pending,
          `${totals.completion.toFixed(1)}%`,
          totals.searches,
        ],
      ],
      footStyles: { fillColor: [35, 50, 66], textColor: [255, 255, 255] },
    });

    doc.save(`Manifest_Report_${dateFrom}_to_${dateTo}.pdf`);
  }

  function handleReset() {
    setStatusFilter("all");
    setCustomSearch("");
    setPreset("today");
  }

  /* ---- render ---- */
  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">
            End-of-day export — manifests, bill counts, scan progress, and
            search attempts.
          </p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-outline"
            onClick={exportExcel}
            disabled={filtered.length === 0}
            type="button"
          >
            Export Excel
          </button>
          <button
            className="btn btn-primary"
            onClick={exportPdf}
            disabled={filtered.length === 0}
            type="button"
          >
            Export PDF
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
            <div className="kpi-value">{filtered.length}</div>
          </div>
          <div className="kpi-label">Manifests</div>
          <div className="kpi-hint">
            {new Date(dateFrom).toLocaleDateString(undefined, { day: "2-digit", month: "short" })} →{" "}
            {new Date(dateTo).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
          </div>
        </div>

        <div className="kpi-card kpi-info">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="7" width="13" height="9" rx="1.5" />
                <path d="M14 10h4l3 3v3h-7z" />
                <circle cx="6" cy="18" r="1.6" />
                <circle cx="17" cy="18" r="1.6" />
              </svg>
            </div>
            <div className="kpi-value">{totals.bills}</div>
          </div>
          <div className="kpi-label">Total bills</div>
          <div className="kpi-hint">
            {totals.scanned} scanned · {totals.pending} pending
          </div>
        </div>

        <div className="kpi-card kpi-success">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="m8 12 3 3 5-6" />
              </svg>
            </div>
            <div className="kpi-value">{totals.completion.toFixed(1)}%</div>
          </div>
          <div className="kpi-label">Completion</div>
          <div className="kpi-hint">Scanned ÷ total bills</div>
        </div>

        <div className="kpi-card kpi-primary">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <div className="kpi-value">{totals.searches}</div>
          </div>
          <div className="kpi-label">Search attempts</div>
          <div className="kpi-hint">
            {totals.avgSearchesPerBill} avg per bill
          </div>
        </div>
      </div>

      {/* ============ FILTERS ============ */}
      <div className="filter-panel">
        <div className="filter-bar">
          <div className="field">
            <label>Preset</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as DatePreset)}
              style={{ minWidth: 150 }}
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="month">This month</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          <div className="field">
            <label>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPreset("custom");
              }}
            />
          </div>

          <div className="field">
            <label>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPreset("custom");
              }}
            />
          </div>

          <div className="field">
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as StatusFilter)
              }
              style={{ minWidth: 150 }}
            >
              <option value="all">All statuses</option>
              <option value="complete">Complete only</option>
              <option value="inprogress">In progress</option>
              <option value="overage">With overage</option>
            </select>
          </div>

          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Custom search</label>
            <input
              value={customSearch}
              onChange={(e) => setCustomSearch(e.target.value)}
              placeholder="Manifest #, date, counts, status"
            />
          </div>

          <button
            className="btn btn-outline"
            onClick={handleReset}
            type="button"
          >
            Reset
          </button>
          <button
            className="btn btn-primary"
            onClick={loadReport}
            type="button"
          >
            {loading ? "Loading…" : "Apply"}
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
          {statusFilter !== "all" && ` · status: ${statusFilter}`}
          {customSearch && ` · search: "${customSearch}"`}
        </div>
      </div>

      {/* ============ COMPLETION BAR ============ */}
      {filtered.length > 0 && (
        <div className="panel-flush" style={{ marginBottom: 18 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">Overall completion</div>
              <div className="panel-sub">
                {totals.scanned} scanned of {totals.bills} total bills
              </div>
            </div>
            <span className="panel-badge">
              {totals.completion.toFixed(1)}%
            </span>
          </div>
          <div style={{ padding: "0 20px 18px" }}>
            <div className="big-progress">
              <div
                className="big-progress-fill"
                style={{ width: `${totals.completion}%` }}
              />
            </div>
            <div className="progress-legend">
              <span>
                <span className="dot dot-success" /> Scanned {totals.scanned}
              </span>
              <span>
                <span className="dot dot-warning" /> Pending {totals.pending}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ============ TABLE ============ */}
      <div className="panel-flush">
        <div className="panel-header">
          <div>
            <div className="panel-title">Manifest breakdown</div>
            <div className="panel-sub">
              {filtered.length} manifest{filtered.length === 1 ? "" : "s"} in
              the selected range
            </div>
          </div>
        </div>

        <div
          className="table-wrap"
          style={{ border: "none", borderRadius: 0, boxShadow: "none" }}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th>Manifest #</th>
                <th>Upload Date</th>
                <th>Total Bills</th>
                <th>Scanned</th>
                <th>Pending</th>
                <th>Completion</th>
                <th>Total Searches</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7}>
                    <p className="empty-note">Loading…</p>
                  </td>
                </tr>
              )}

              {!loading &&
                filtered.map((r) => {
                  const pct =
                    r.total_bills === 0
                      ? 0
                      : (r.scanned_count / r.total_bills) * 100;
                  return (
                    <tr key={r.manifest_id}>
                      <td className="mono">{r.manifest_number}</td>
                      <td>{fmtDateTime(r.upload_date)}</td>
                      <td>{r.total_bills}</td>
                      <td>
                        <span className="badge badge-scanned">
                          {r.scanned_count}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            r.pending_count > 0
                              ? "badge-pending"
                              : "badge-scanned"
                          }`}
                        >
                          {r.pending_count}
                        </span>
                      </td>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 130,
                          }}
                        >
                          <div
                            className="overage-row-bar"
                            style={{ flex: 1, margin: 0 }}
                          >
                            <div
                              className="overage-row-fill"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span
                            className="mono"
                            style={{ fontSize: "0.75rem", minWidth: 40 }}
                          >
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td>{r.total_search_count}</td>
                    </tr>
                  );
                })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <p className="empty-note">
                      No manifests match the current filters.
                    </p>
                  </td>
                </tr>
              )}

              {!loading && filtered.length > 0 && (
                <tr className="totals-row">
                  <td>Total ({filtered.length} manifests)</td>
                  <td>{fmtDate(dateFrom)} → {fmtDate(dateTo)}</td>
                  <td>{totals.bills}</td>
                  <td>{totals.scanned}</td>
                  <td>{totals.pending}</td>
                  <td>{totals.completion.toFixed(1)}%</td>
                  <td>{totals.searches}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}