"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/* =====================================================================
   BUSINESS RULES
   ===================================================================== */
const OVERAGE_HOURS = 10;

interface OverageRow {
  manifest_id: string;
  manifest_number: string;
  upload_date: string;
  total_bills: number;
  scanned_count: number;
  pending_count: number;
  oldest_pending_at?: string | null;
}

/* A manifest is "overage" when it still has pending bills AND its
   oldest pending bill is older than OVERAGE_HOURS. Falls back to the
   manifest upload time if we don't have a pending timestamp. */
function isOverage(row: OverageRow): boolean {
  if (row.pending_count <= 0) return false;
  const ref = row.oldest_pending_at ?? row.upload_date;
  const hours = (Date.now() - new Date(ref).getTime()) / 36e5;
  return hours >= OVERAGE_HOURS;
}

function hoursAgo(iso: string | null | undefined): string {
  if (!iso) return "–";
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type StatusFilter = "all" | "overage" | "inprogress" | "complete";

/* =====================================================================
   PAGE
   ===================================================================== */
export default function OveragesPage() {
  const [rows, setRows] = useState<OverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  /* ---------- filters ---------- */
  const [customSearch, setCustomSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [minPending, setMinPending] = useState<string>("");

  async function load() {
    setLoading(true);

    const { data: reports } = await supabase
      .from("manifest_overages")
      .select("*")
      .order("upload_date", { ascending: true });

    // Pull oldest pending bill timestamp per manifest to compute overage
    const { data: pendingBills } = await supabase
      .from("bills")
      .select("manifest_id, created_at")
      .eq("scan_status", "pending")
      .order("created_at", { ascending: true });

    const oldestByManifest = new Map<string, string>();
    (pendingBills ?? []).forEach((b: any) => {
      if (!oldestByManifest.has(b.manifest_id)) {
        oldestByManifest.set(b.manifest_id, b.created_at);
      }
    });

    const enriched: OverageRow[] = (reports ?? []).map((r: any) => ({
      ...r,
      oldest_pending_at: oldestByManifest.get(r.manifest_id) ?? null,
    }));

    setRows(enriched);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();

    const ch = supabase
      .channel("overages-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bills" },
        load
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  /* ---------- apply filters ---------- */
  const filtered = useMemo(() => {
    const searchQ = customSearch.trim().toLowerCase();
    const minPendingNum = minPending.trim() === "" ? null : Number(minPending);

    return rows.filter((r) => {
      // Status filter
      if (statusFilter === "overage" && !isOverage(r)) return false;
      if (statusFilter === "inprogress" && (r.pending_count <= 0 || isOverage(r)))
        return false;
      if (statusFilter === "complete" && r.pending_count > 0) return false;

      // Min pending filter
      if (
        minPendingNum !== null &&
        !Number.isNaN(minPendingNum) &&
        r.pending_count < minPendingNum
      )
        return false;

      // Custom search
      if (searchQ) {
        const hay = [
          r.manifest_number,
          r.total_bills,
          r.scanned_count,
          r.pending_count,
          r.upload_date,
          isOverage(r) ? "overage" : r.pending_count === 0 ? "complete" : "in progress",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }

      return true;
    });
  }, [rows, customSearch, statusFilter, minPending]);

  /* ---------- derived KPIs ---------- */
  const kpis = useMemo(() => {
    const totalManifests = rows.length;
    const totalBills = rows.reduce((s, r) => s + r.total_bills, 0);
    const totalScanned = rows.reduce((s, r) => s + r.scanned_count, 0);
    const totalPending = rows.reduce((s, r) => s + r.pending_count, 0);
    const overageCount = rows.filter(isOverage).length;
    const overageBills = rows
      .filter(isOverage)
      .reduce((s, r) => s + r.pending_count, 0);

    const completion = totalBills === 0 ? 0 : (totalScanned / totalBills) * 100;

    return {
      totalManifests,
      totalBills,
      totalScanned,
      totalPending,
      overageCount,
      overageBills,
      completion,
    };
  }, [rows]);

  function handleReset() {
    setCustomSearch("");
    setStatusFilter("all");
    setMinPending("");
  }

  /* ---------- render ---------- */
  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Overages</h1>
          <p className="page-subtitle">
            Manifests from the last 7 days with bills still pending scan ·{" "}
            {OVERAGE_HOURS}h+ pending is overage
          </p>
        </div>
        <div className="page-header-actions">
          <span className="live-pill">
            <span className="live-dot" /> Live
          </span>
          <button className="btn btn-outline" onClick={load} type="button">
            Refresh
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
            <div className="kpi-value">{kpis.totalManifests}</div>
          </div>
          <div className="kpi-label">Manifests</div>
          <div className="kpi-hint">Last 7 days</div>
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
            <div className="kpi-value">{kpis.totalBills}</div>
          </div>
          <div className="kpi-label">Total bills</div>
          <div className="kpi-hint">
            {kpis.totalScanned} scanned · {kpis.totalPending} pending
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
            <div className="kpi-value">{kpis.completion.toFixed(1)}%</div>
          </div>
          <div className="kpi-label">Scan completion</div>
          <div className="kpi-hint">Across all manifests</div>
        </div>

        <div className="kpi-card kpi-danger">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 2 20h20L12 3z" />
                <path d="M12 9v5" />
                <circle cx="12" cy="17" r=".6" fill="currentColor" />
              </svg>
            </div>
            <div className="kpi-value">{kpis.overageCount}</div>
          </div>
          <div className="kpi-label">Overage manifests</div>
          <div className="kpi-hint">
            {kpis.overageBills} pending bill
            {kpis.overageBills === 1 ? "" : "s"} affected
          </div>
        </div>
      </div>

      {/* ============ FILTERS ============ */}
      <div className="filter-panel">
        <div className="filter-bar">
          <div className="field">
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as StatusFilter)
              }
              style={{ minWidth: 160 }}
            >
              <option value="all">All statuses</option>
              <option value="overage">Overage only</option>
              <option value="inprogress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>

          <div className="field">
            <label>Min pending bills</label>
            <input
              type="number"
              min={0}
              value={minPending}
              onChange={(e) => setMinPending(e.target.value)}
              placeholder="e.g. 10"
              style={{ minWidth: 140 }}
            />
          </div>

          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Custom search</label>
            <input
              value={customSearch}
              onChange={(e) => setCustomSearch(e.target.value)}
              placeholder="Manifest #, status, count, or date"
            />
          </div>

          <button
            className="btn btn-outline"
            onClick={handleReset}
            type="button"
          >
            Reset
          </button>
          <button className="btn btn-primary" onClick={load} type="button">
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
          {statusFilter !== "all" && ` · status: ${statusFilter}`}
          {minPending && ` · min pending: ${minPending}`}
          {customSearch && ` · search: "${customSearch}"`}
        </div>
      </div>

      {/* ============ ROW PROGRESS ============ */}
      <div className="panel-flush" style={{ marginBottom: 18 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">Batch progress</div>
            <div className="panel-sub">
              {filtered.length} of {rows.length} manifests · oldest first
            </div>
          </div>
          {lastUpdated && (
            <span
              className="panel-badge"
              style={{
                background: "var(--header-bg)",
                color: "var(--ink-muted)",
              }}
            >
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="overages-list">
          {loading && <p className="empty-note">Loading…</p>}

          {!loading && filtered.length === 0 && (
            <p className="empty-note">
              No manifests match the current filters.
            </p>
          )}

          {!loading &&
            filtered.map((r) => {
              const pct =
                r.total_bills === 0
                  ? 0
                  : (r.scanned_count / r.total_bills) * 100;
              const over = isOverage(r);
              const complete = r.pending_count === 0;

              return (
                <div key={r.manifest_id} className="overage-row">
                  <div className="overage-row-head">
                    <div className="overage-row-left">
                      <span className="mono overage-row-manifest">
                        {r.manifest_number}
                      </span>
                      {complete ? (
                        <span className="badge badge-scanned">Complete</span>
                      ) : over ? (
                        <span className="badge badge-danger">
                          Overage ·{" "}
                          {hoursAgo(r.oldest_pending_at ?? r.upload_date)}
                        </span>
                      ) : (
                        <span className="badge badge-pending">
                          In progress ·{" "}
                          {hoursAgo(r.oldest_pending_at ?? r.upload_date)}
                        </span>
                      )}
                    </div>
                    <div className="overage-row-right">
                      <span className="overage-row-counts">
                        <strong>{r.scanned_count}</strong>/{r.total_bills}
                      </span>
                      <span className="overage-row-pct">
                        {pct.toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  <div className="overage-row-bar">
                    <div
                      className={`overage-row-fill${
                        over ? " danger" : complete ? " complete" : ""
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="overage-row-meta">
                    <span>Uploaded {fmtDateTime(r.upload_date)}</span>
                    <span>
                      {r.pending_count > 0
                        ? `${r.pending_count} bill${
                            r.pending_count === 1 ? "" : "s"
                          } pending`
                        : "All bills scanned"}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* ============ DETAIL TABLE ============ */}
      <div className="panel-flush">
        <div className="panel-header">
          <div>
            <div className="panel-title">Detail table</div>
            <div className="panel-sub">
              {filtered.length} manifest
              {filtered.length === 1 ? "" : "s"} in current view
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
                <th>Overage (Not Scanned)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const over = isOverage(r);
                const complete = r.pending_count === 0;
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
                      {complete ? (
                        <span className="badge badge-scanned">Complete</span>
                      ) : over ? (
                        <span className="badge badge-danger">
                          Overage &gt;{OVERAGE_HOURS}h
                        </span>
                      ) : (
                        <span className="badge badge-pending">
                          In progress
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={6}>
                    <p className="empty-note">
                      No manifests match the current filters.
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