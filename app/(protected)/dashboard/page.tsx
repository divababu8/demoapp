"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/* =====================================================================
   Types
   ===================================================================== */
interface ManifestRow {
  manifest_id: string;
  manifest_number: string;
  upload_date: string;
  total_bills: number;
  scanned_count: number;
  pending_count: number;
  total_search_count: number;
  oldest_pending_at: string | null;
}

interface BillLite {
  id: string;
  manifest_id: string;
  scan_status: "pending" | "scanned";
  created_at: string;
  scanned_at: string | null;
}

/* =====================================================================
   Business rules
   ===================================================================== */
const OVERAGE_HOURS = 10;

function isOverage(row: ManifestRow): boolean {
  if (row.pending_count <= 0) return false;
  const ref = row.oldest_pending_at ?? row.upload_date;
  const hours = (Date.now() - new Date(ref).getTime()) / 36e5;
  return hours >= OVERAGE_HOURS;
}

/* =====================================================================
   Dashboard page
   ===================================================================== */
export default function DashboardPage() {
  const [manifests, setManifests] = useState<ManifestRow[]>([]);
  const [bills, setBills] = useState<BillLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [realtimeStatus, setRealtimeStatus] = useState<string>("connecting");

  /* ---------- realtime + initial load ---------- */
  useEffect(() => {
    let isMounted = true;

    async function loadAll() {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const startIso = start.toISOString();
      const endIso = new Date().toISOString();

      const { data: reportRows } = await supabase
        .from("manifest_report")
        .select("*");

      const { data: todayBills } = await supabase
        .from("bills")
        .select("id, manifest_id, scan_status, created_at, scanned_at")
        .gte("created_at", startIso)
        .lte("created_at", endIso);

      const { data: pendingBills } = await supabase
        .from("bills")
        .select("manifest_id, created_at")
        .eq("scan_status", "pending")
        .order("created_at", { ascending: true });

      if (!isMounted) return;

      const oldestByManifest = new Map<string, string>();
      (pendingBills ?? []).forEach((b: any) => {
        if (!oldestByManifest.has(b.manifest_id)) {
          oldestByManifest.set(b.manifest_id, b.created_at);
        }
      });

      const enriched: ManifestRow[] = (reportRows ?? []).map((r: any) => ({
        ...r,
        oldest_pending_at: oldestByManifest.get(r.manifest_id) ?? null,
      }));

      setManifests(enriched);
      setBills(todayBills ?? []);
      setLoading(false);
    }

    loadAll();

    // Unique channel name to survive React Strict Mode double-mount + Fast Refresh
    const channelName = `dashboard-live-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bills" },
        (payload) => {
          console.log("[dashboard] bills changed:", payload.eventType);
          loadAll();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manifests" },
        (payload) => {
          console.log("[dashboard] manifests changed:", payload.eventType);
          loadAll();
        }
      )
      .subscribe((status) => {
        console.log("[dashboard] realtime status:", status);
        if (isMounted) setRealtimeStatus(status);
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  /* ---------- derived KPIs ---------- */
  const kpi = useMemo(() => {
    const totalShipments = bills.length;
    const scanCount = bills.filter((b) => b.scan_status === "scanned").length;
    const pendingCount = bills.filter((b) => b.scan_status === "pending").length;
    const shortage = pendingCount;

    const overageManifestIds = new Set(
      manifests.filter(isOverage).map((m) => m.manifest_id)
    );
    const overage = bills.filter(
      (b) =>
        b.scan_status === "pending" && overageManifestIds.has(b.manifest_id)
    ).length;

    const completion =
      totalShipments === 0 ? 0 : (scanCount / totalShipments) * 100;
    return { totalShipments, scanCount, shortage, overage, completion };
  }, [bills, manifests]);

  const allTime = useMemo(() => {
    const total = manifests.reduce((s, m) => s + m.total_bills, 0);
    const scanned = manifests.reduce((s, m) => s + m.scanned_count, 0);
    const pending = manifests.reduce((s, m) => s + m.pending_count, 0);
    const searches = manifests.reduce((s, m) => s + m.total_search_count, 0);
    return {
      total,
      scanned,
      pending,
      searches,
      completion: total === 0 ? 0 : (scanned / total) * 100,
    };
  }, [manifests]);

  /* ---------- charts (pure SVG, no chart lib) ---------- */
  const hourly = useMemo(() => {
    const buckets = new Array(24).fill(0);
    bills
      .filter((b) => b.scan_status === "scanned")
      .forEach((b) => {
        const h = new Date(b.scanned_at ?? b.created_at).getHours();
        buckets[h] += 1;
      });
    return buckets;
  }, [bills]);

  const topManifests = useMemo(() => {
    return [...manifests]
      .sort((a, b) => b.pending_count - a.pending_count)
      .slice(0, 5);
  }, [manifests]);

  /* ---------- render ---------- */
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            {" · "}Live overview of today's manifests & scans
          </p>
        </div>
        <div className="page-header-actions">
          <span
            className="live-pill"
            title={`Realtime: ${realtimeStatus}`}
            style={{
              opacity: realtimeStatus === "SUBSCRIBED" ? 1 : 0.6,
            }}
          >
            <span className="live-dot" />{" "}
            {realtimeStatus === "SUBSCRIBED" ? "Live" : "Connecting…"}
          </span>
        </div>
      </div>

      {/* ============ KPI CARDS ============ */}
      <div className="kpi-grid">
        <KpiCard
          tone="primary"
          label="Total Shipments (today)"
          value={kpi.totalShipments}
          hint="All bills from all manifests today"
          icon={<IconBox />}
        />
        <KpiCard
          tone="success"
          label="Scan Count"
          value={kpi.scanCount}
          hint={`${kpi.completion.toFixed(1)}% of today's bills`}
          icon={<IconCheck />}
        />
        <KpiCard
          tone="warning"
          label="Shortage (pending)"
          value={kpi.shortage}
          hint="Bills not yet scanned today"
          icon={<IconClock />}
        />
        <KpiCard
          tone="danger"
          label="Overage"
          value={kpi.overage}
          hint={`Pending > ${OVERAGE_HOURS}h`}
          icon={<IconAlert />}
        />
      </div>

      {/* ============ PROGRESS + CHARTS ============ */}
      <div className="dash-two-col">
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Scan completion — today</div>
              <div className="panel-sub">
                {kpi.scanCount} scanned / {kpi.totalShipments} total
              </div>
            </div>
            <div className="panel-badge">{kpi.completion.toFixed(1)}%</div>
          </div>
          <div className="big-progress">
            <div
              className="big-progress-fill"
              style={{ width: `${kpi.completion}%` }}
            />
          </div>
          <div className="progress-legend">
            <span>
              <span className="dot dot-success" /> Scanned {kpi.scanCount}
            </span>
            <span>
              <span className="dot dot-warning" /> Pending {kpi.shortage}
            </span>
            <span>
              <span className="dot dot-danger" /> Overage {kpi.overage}
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Scans per hour — today</div>
              <div className="panel-sub">Peak hour activity</div>
            </div>
          </div>
          <HourlySparkline data={hourly} />
        </section>
      </div>

      {/* ============ TOP OVERAGE MANIFESTS ============ */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Top manifests with pending scans</div>
            <div className="panel-sub">Sorted by pending bill count</div>
          </div>
        </div>
        <div className="top-list">
          {topManifests.length === 0 && (
            <p className="empty-note">All caught up — no pending manifests.</p>
          )}
          {topManifests.map((m) => {
            const pct =
              m.total_bills === 0
                ? 0
                : (m.scanned_count / m.total_bills) * 100;
            const over = isOverage(m);
            return (
              <div key={m.manifest_id} className="top-row">
                <div className="top-row-main">
                  <span className="mono">{m.manifest_number}</span>
                  <span
                    className={`badge ${
                      over ? "badge-danger" : "badge-pending"
                    }`}
                  >
                    {over ? "Overage" : "Pending"}
                  </span>
                </div>
                <div className="top-row-bar">
                  <div
                    className={`top-row-fill${over ? " danger" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="top-row-meta">
                  {m.scanned_count}/{m.total_bills} · {m.pending_count} pending
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============ MANIFEST TABLE ============ */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">All manifests</div>
            <div className="panel-sub">
              {manifests.length} manifests · {allTime.total} total bills
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Manifest #</th>
                <th>Upload date</th>
                <th>Total bills</th>
                <th>Scanned</th>
                <th>Search count</th>
                <th>Shortage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {manifests.map((m) => {
                const over = isOverage(m);
                return (
                  <tr key={m.manifest_id}>
                    <td className="mono">{m.manifest_number}</td>
                    <td>{new Date(m.upload_date).toLocaleString()}</td>
                    <td>{m.total_bills}</td>
                    <td>
                      <span className="badge badge-scanned">
                        {m.scanned_count}
                      </span>
                    </td>
                    <td>{m.total_search_count}</td>
                    <td>
                      <span
                        className={`badge ${
                          m.pending_count > 0
                            ? "badge-pending"
                            : "badge-scanned"
                        }`}
                      >
                        {m.pending_count}
                      </span>
                    </td>
                    <td>
                      {m.pending_count === 0 ? (
                        <span className="badge badge-scanned">Complete</span>
                      ) : over ? (
                        <span className="badge badge-danger">
                          Overage &gt;{OVERAGE_HOURS}h
                        </span>
                      ) : (
                        <span className="badge badge-pending">In progress</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && manifests.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <p className="empty-note">
                      No manifests yet — upload one to begin.
                    </p>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={7}>
                    <p className="empty-note">Loading…</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ ALL-TIME SUMMARY ============ */}
      <div className="quick-stats">
        <QuickStat label="Total bills (all time)" value={allTime.total} />
        <QuickStat
          label="Scanned (all time)"
          value={allTime.scanned}
          tone="success"
        />
        <QuickStat
          label="Pending (all time)"
          value={allTime.pending}
          tone="warning"
        />
        <QuickStat
          label="Search attempts"
          value={allTime.searches}
          tone="primary"
        />
        <QuickStat
          label="Overall completion"
          value={`${allTime.completion.toFixed(1)}%`}
        />
      </div>
    </>
  );
}

/* =====================================================================
   Sub-components
   ===================================================================== */
function KpiCard({
  tone,
  label,
  value,
  hint,
  icon,
}: {
  tone: "primary" | "success" | "warning" | "danger";
  label: string;
  value: number;
  hint: string;
  icon: JSX.Element;
}) {
  return (
    <div className={`kpi-card kpi-${tone}`}>
      <div className="kpi-top">
        <div className="kpi-icon">{icon}</div>
        <div className="kpi-value">{value}</div>
      </div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-hint">{hint}</div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "success" | "warning" | "primary";
}) {
  return (
    <div className={`quick-stat quick-${tone}`}>
      <div className="quick-stat-value">{value}</div>
      <div className="quick-stat-label">{label}</div>
    </div>
  );
}

function HourlySparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="sparkline">
      {data.map((v, i) => (
        <div
          key={i}
          className="sparkline-bar"
          style={{ height: `${(v / max) * 100}%` }}
          title={`${i.toString().padStart(2, "0")}:00 — ${v} scans`}
        />
      ))}
    </div>
  );
}

/* Tiny inline icons */
const iconProps = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconBox = () => (
  <svg {...iconProps}>
    <path d="m3 7 9-4 9 4-9 4-9-4z" />
    <path d="M3 7v10l9 4 9-4V7" />
    <path d="M12 11v10" />
  </svg>
);

const IconCheck = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

const IconClock = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IconAlert = () => (
  <svg {...iconProps}>
    <path d="M12 3 2 20h20L12 3z" />
    <path d="M12 9v5" />
    <circle cx="12" cy="17" r=".6" fill="currentColor" />
  </svg>
);