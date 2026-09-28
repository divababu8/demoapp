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

  const [customSearch, setCustomSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [minPending, setMinPending] = useState<string>("");

  async function load() {
    setLoading(true);

    const [reportsRes, pendingAgeRes] = await Promise.all([
      supabase.from("manifest_overages").select("*").order("upload_date", { ascending: true }),
      supabase.from("manifest_pending_age").select("*"),
    ]);

    const oldestByManifest = new Map<string, string>();
    (pendingAgeRes.data ?? []).forEach((r: any) => {
      oldestByManifest.set(r.manifest_id, r.oldest_pending_at);
    });

    const enriched: OverageRow[] = (reportsRes.data ?? []).map((r: any) => ({
      ...r,
      oldest_pending_at: oldestByManifest.get(r.manifest_id) ?? null,
    }));

    setRows(enriched);
    setLastUpdated(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleReload() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(load, 350);
    }

    const ch = supabase
      .channel("overages-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, scheduleReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
  }, []);

  const filtered = useMemo(() => {
    const searchQ = customSearch.trim().toLowerCase();
    const minPendingNum = minPending.trim() === "" ? null : Number(minPending);

    return rows.filter((r) => {
      if (statusFilter === "overage" && !isOverage(r)) return false;
      if (statusFilter === "inprogress" && (r.pending_count <= 0 || isOverage(r))) return false;
      if (statusFilter === "complete" && r.pending_count > 0) return false;
      if (minPendingNum !== null && !Number.isNaN(minPendingNum) && r.pending_count < minPendingNum) return false;
      if (searchQ) {
        const hay = [
          r.manifest_number, r.total_bills, r.scanned_count, r.pending_count,
          r.upload_date, isOverage(r) ? "overage" : r.pending_count === 0 ? "complete" : "in progress",
        ].join(" ").toLowerCase();
        if (!hay.includes(searchQ)) return false;
      }
      return true;
    });
  }, [rows, customSearch, statusFilter, minPending]);

  const kpis = useMemo(() => {
    const totalManifests = rows.length;
    const totalBills = rows.reduce((s, r) => s + r.total_bills, 0);
    const totalScanned = rows.reduce((s, r) => s + r.scanned_count, 0);
    const totalPending = rows.reduce((s, r) => s + r.pending_count, 0);
    const overageCount = rows.filter(isOverage).length;
    const overageBills = rows.filter(isOverage).reduce((s, r) => s + r.pending_count, 0);
    const completion = totalBills === 0 ? 0 : (totalScanned / totalBills) * 100;
    return { totalManifests, totalBills, totalScanned, totalPending, overageCount, overageBills, completion };
  }, [rows]);

  function handleReset() {
    setCustomSearch("");
    setStatusFilter("all");
    setMinPending("");
  }

  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Overages</h1>
          <p className="page-subtitle">
            Manifests from the last 7 days with bills still pending scan · {OVERAGE_HOURS}h+ pending is overage
          </p>
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
          <button className="btn btn-outline" onClick={load} type="button">Refresh</button>
        </div>
      </div>

      {/* ============ KPI CARDS (Vibrant) ============ */}
      <div className="kpi-grid">
        <KpiCard tone="primary" label="Manifests" value={kpis.totalManifests} hint="Last 7 days" icon={<IconBox />} />
        <KpiCard tone="info" label="Total bills" value={kpis.totalBills} hint={`${kpis.totalScanned} scanned · ${kpis.totalPending} pending`} icon={<IconTruck />} />
        <KpiCard tone="success" label="Scan completion" value={`${kpis.completion.toFixed(1)}%`} hint="Across all manifests" icon={<IconCheck />} />
        <KpiCard tone="danger" label="Overage manifests" value={kpis.overageCount} hint={`${kpis.overageBills} pending bill${kpis.overageBills === 1 ? "" : "s"} affected`} icon={<IconAlert />} />
      </div>

      {/* ============ FILTERS ============ */}
      <div className="filter-panel">
        <div className="filter-bar">
          <div className="field">
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ minWidth: 160 }}>
              <option value="all">All statuses</option>
              <option value="overage">Overage only</option>
              <option value="inprogress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>

          <div className="field">
            <label>Min pending bills</label>
            <input type="number" min={0} value={minPending} onChange={(e) => setMinPending(e.target.value)} placeholder="e.g. 10" style={{ minWidth: 140 }} />
          </div>

          <div className="field" style={{ flex: 1, minWidth: 240 }}>
            <label>Custom search</label>
            <input value={customSearch} onChange={(e) => setCustomSearch(e.target.value)} placeholder="Manifest #, status, count, or date" />
          </div>

          <button className="btn btn-outline" onClick={handleReset} type="button">Reset</button>
          <button className="btn btn-primary" onClick={load} type="button">Refresh</button>
        </div>

        <div style={{ marginTop: 12, fontSize: "0.82rem", color: "var(--ink-muted)" }}>
          <strong style={{ color: "var(--ink)" }}>Count:</strong> {filtered.length} of {rows.length} rows
          {statusFilter !== "all" && ` · status: ${statusFilter}`}
          {minPending && ` · min pending: ${minPending}`}
          {customSearch && ` · search: "${customSearch}"`}
        </div>
      </div>

      {/* ============ ROW PROGRESS ============ */}
      <div className="panel-flush" style={{ marginBottom: 24 }}>
        <div className="panel-header">
          <div>
            <div className="panel-title">Batch progress</div>
            <div className="panel-sub">{filtered.length} of {rows.length} manifests · oldest first</div>
          </div>
          {lastUpdated && (
            <span className="panel-badge" style={{ background: "var(--paper)", color: "var(--ink-muted)", border: '1px solid var(--border)' }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="overages-list">
          {loading && <p className="empty-note">Loading…</p>}
          {!loading && filtered.length === 0 && <p className="empty-note">No manifests match the current filters.</p>}

          {!loading && filtered.map((r) => {
            const pct = r.total_bills === 0 ? 0 : (r.scanned_count / r.total_bills) * 100;
            const over = isOverage(r);
            const complete = r.pending_count === 0;

            return (
              <div key={r.manifest_id} className="overage-row">
                <div className="overage-row-head">
                  <div className="overage-row-left">
                    <span className="mono overage-row-manifest">{r.manifest_number}</span>
                    {complete ? (
                      <span className="badge badge-scanned">Complete</span>
                    ) : over ? (
                      <span className="badge badge-danger">Overage · {hoursAgo(r.oldest_pending_at ?? r.upload_date)}</span>
                    ) : (
                      <span className="badge badge-pending">In progress · {hoursAgo(r.oldest_pending_at ?? r.upload_date)}</span>
                    )}
                  </div>
                  <div className="overage-row-right">
                    <span className="overage-row-counts"><strong>{r.scanned_count}</strong>/{r.total_bills}</span>
                    <span className="overage-row-pct">{pct.toFixed(0)}%</span>
                  </div>
                </div>

                <div className="overage-row-bar">
                  <div className={`overage-row-fill${over ? " danger" : complete ? " complete" : ""}`} style={{ width: `${pct}%` }} />
                </div>

                <div className="overage-row-meta">
                  <span>Uploaded {fmtDateTime(r.upload_date)}</span>
                  <span>{r.pending_count > 0 ? `${r.pending_count} bill${r.pending_count === 1 ? "" : "s"} pending` : "All bills scanned"}</span>
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
            <div className="panel-sub">{filtered.length} manifest{filtered.length === 1 ? "" : "s"} in current view</div>
          </div>
        </div>

        <div className="table-wrap">
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
                    <td><span className="badge badge-scanned">{r.scanned_count}</span></td>
                    <td><span className={`badge ${r.pending_count > 0 ? "badge-pending" : "badge-scanned"}`}>{r.pending_count}</span></td>
                    <td>
                      {complete ? (
                        <span className="badge badge-scanned">Complete</span>
                      ) : over ? (
                        <span className="badge badge-danger">Overage &gt;{OVERAGE_HOURS}h</span>
                      ) : (
                        <span className="badge badge-pending">In progress</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={6}><p className="empty-note">No manifests match the current filters.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Sub-components
   ===================================================================== */
function KpiCard({
  tone, label, value, hint, icon,
}: {
  tone: "primary" | "info" | "success" | "danger";
  label: string;
  value: string | number;
  hint: string;
  icon: JSX.Element;
}) {
  return (
    <div className={`kpi-card kpi-${tone}`}>
      <div className="kpi-top">
        <div className="kpi-icon">{icon}</div>
        <div className="kpi-value">{value}</div>
      </div>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-hint">{hint}</div>
      </div>
    </div>
  );
}

/* Tiny inline icons */
const iconProps = {
  viewBox: "0 0 24 24", width: 22, height: 22, fill: "none",
  stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const IconBox = () => (
  <svg {...iconProps}><path d="m3 7 9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></svg>
);
const IconTruck = () => (
  <svg {...iconProps}><rect x="1" y="7" width="13" height="9" rx="1.5" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
);
const IconCheck = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
);
const IconAlert = () => (
  <svg {...iconProps}><path d="M12 3 2 20h20L12 3z" /><path d="M12 9v5" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></svg>
);