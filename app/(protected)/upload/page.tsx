"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase, getAuthHeader } from "@/lib/supabaseClient";

/* =====================================================================
   TYPES
   ===================================================================== */
type FileStatusKind =
  | "queued" | "uploading" | "created" | "updated"
  | "skipped" | "rejected" | "error";

interface FileStatus {
  id: string;
  name: string;
  size: number;
  status: FileStatusKind;
  message: string;
  progress: number;
  totalBills?: number;
  manifestNumber?: string;
  flightNumber?: string;
}

interface RecentManifest {
  id: string;
  manifest_number: string;
  original_filename: string;
  total_bills: number;
  upload_date: string;
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_META: Record<FileStatusKind, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  queued:    { label: "Queued",    tone: "neutral" },
  uploading: { label: "Uploading", tone: "neutral" },
  created:   { label: "Created",   tone: "success" },
  updated:   { label: "Updated",   tone: "success" },
  skipped:   { label: "Skipped",   tone: "warning" },
  rejected:  { label: "Rejected",  tone: "danger"  },
  error:     { label: "Error",     tone: "danger"  },
};

/* =====================================================================
   PAGE
   ===================================================================== */
export default function UploadPage() {
  const [results, setResults] = useState<FileStatus[]>([]);
  const [recent, setRecent] = useState<RecentManifest[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const timerRefs = useRef<Map<string, number>>(new Map());

  async function loadRecent() {
    setRecentLoading(true);
    const { data } = await supabase
      .from("manifests")
      .select("id, manifest_number, original_filename, total_bills, upload_date")
      .order("upload_date", { ascending: false })
      .limit(10);
    setRecent(data ?? []);
    setRecentLoading(false);
  }

  useEffect(() => {
    loadRecent();
    const ch = supabase
      .channel("upload-recent-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "manifests" }, loadRecent)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
      timerRefs.current.forEach((t) => window.clearInterval(t));
      timerRefs.current.clear();
    };
  }, []);

  function startProgressTicker(id: string) {
    const tick = window.setInterval(() => {
      setResults((prev) =>
        prev.map((r) => {
          if (r.id !== id || r.status !== "uploading") return r;
          const next = Math.min(90, r.progress + Math.random() * 8 + 2);
          return { ...r, progress: next };
        })
      );
    }, 250);
    timerRefs.current.set(id, tick);
  }

  function stopProgressTicker(id: string) {
    const t = timerRefs.current.get(id);
    if (t !== undefined) { window.clearInterval(t); timerRefs.current.delete(id); }
  }

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const initial: FileStatus[] = acceptedFiles.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name, size: f.size, status: "uploading", message: "Uploading…", progress: 3,
    }));

    setResults((prev) => [...initial, ...prev]);
    initial.forEach((f) => startProgressTicker(f.id));

    const authHeader = await getAuthHeader();

    await Promise.all(
      acceptedFiles.map(async (file, idx) => {
        const entry = initial[idx];
        const formData = new FormData();
        formData.append("file", file);
        try {
          const res = await fetch("/api/upload", { method: "POST", headers: authHeader, body: formData });
          const data = await res.json();
          stopProgressTicker(entry.id);
          setResults((prev) =>
            prev.map((r) =>
              r.id === entry.id
                ? {
                    ...r,
                    status: (data.status ?? "error") as FileStatusKind,
                    message: data.message ?? data.error ?? "Done.",
                    totalBills: data.total_bills,
                    manifestNumber: data.manifest,
                    flightNumber: data.flightNumber,
                    progress: 100,
                  }
                : r
            )
          );
        } catch (err: any) {
          stopProgressTicker(entry.id);
          setResults((prev) =>
            prev.map((r) =>
              r.id === entry.id
                ? { ...r, status: "error", message: err.message ?? "Upload failed.", progress: 100 }
                : r
            )
          );
        }
      })
    );

    loadRecent();
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    multiple: true,
    noClick: true,
  });

  const sessionStats = useMemo(() => {
    const uploads = results;
    const manifestsUploaded = uploads.filter((r) => r.status === "created" || r.status === "updated").length;
    const billsUploaded = uploads.reduce((sum, r) => sum + (r.totalBills ?? 0), 0);
    const succeeded = uploads.filter((r) => r.status === "created" || r.status === "updated").length;
    const skipped = uploads.filter((r) => r.status === "skipped").length;
    const failed = uploads.filter((r) => r.status === "rejected" || r.status === "error").length;
    const inProgress = uploads.filter((r) => r.status === "uploading" || r.status === "queued").length;
    return { manifestsUploaded, billsUploaded, succeeded, skipped, failed, inProgress, totalFiles: uploads.length };
  }, [results]);

  const [globalStats, setGlobalStats] = useState({
    totalManifests: 0, totalBills: 0, billsToday: 0, scannedToday: 0,
  });

  useEffect(() => {
    async function loadGlobalStats() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const [manifestRes, billRes, todayRes, scannedRes] = await Promise.all([
        supabase.from("manifests").select("*", { count: "exact", head: true }),
        supabase.from("bills").select("*", { count: "exact", head: true }),
        supabase.from("bills").select("*", { count: "exact", head: true }).gte("created_at", todayIso),
        supabase.from("bills").select("*", { count: "exact", head: true }).gte("created_at", todayIso).eq("scan_status", "scanned"),
      ]);

      setGlobalStats({
        totalManifests: manifestRes.count ?? 0,
        totalBills: billRes.count ?? 0,
        billsToday: todayRes.count ?? 0,
        scannedToday: scannedRes.count ?? 0,
      });
    }

    loadGlobalStats();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function scheduleReload() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadGlobalStats, 350);
    }

    const ch = supabase
      .channel("upload-stats-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "manifests" }, scheduleReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload data</h1>
          <p className="page-subtitle">Drop manifest Excel files — each becomes a manifest automatically.</p>
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

      {/* ============ KPI CARDS ============ */}
      <div className="kpi-grid">
        <KpiCard tone="primary" label="Total manifests" value={globalStats.totalManifests} hint="All time" icon={<IconBox />} />
        <KpiCard tone="success" label="Total bills" value={globalStats.totalBills} hint="All manifests combined" icon={<IconTruck />} />
        <KpiCard tone="info" label="Bills uploaded today" value={globalStats.billsToday}
          hint={globalStats.billsToday === 0 ? "No uploads yet" : `${globalStats.scannedToday} scanned`}
          icon={<IconUpload />} />
        <KpiCard tone="purple" label="Files this session" value={sessionStats.totalFiles}
          hint={sessionStats.inProgress > 0 ? `${sessionStats.inProgress} in progress` : sessionStats.totalFiles === 0 ? "Drop files to begin" : "Batch complete"}
          icon={<IconChart />} />
      </div>

      {/* ============ DROPZONE ============ */}
      <div
        {...getRootProps()}
        className={`dropzone${isDragActive ? " active" : ""}`}
        style={{
          background: isDragActive ? 'var(--accent-indigo-soft)' : 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)',
          border: isDragActive ? '2px dashed var(--accent-indigo)' : '2px dashed var(--border)',
          borderRadius: '20px',
          padding: '64px 32px',
          textAlign: 'center',
          transition: 'all 0.2s',
          cursor: 'pointer'
        }}
      >
        <input {...getInputProps()} />

        <div className="dropzone-icon" style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: '72px', height: '72px', borderRadius: '20px',
          background: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)',
          color: 'var(--accent-indigo)', marginBottom: '20px'
        }}>
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17V5" /><path d="m7 10 5-5 5 5" /><path d="M4 19h16" />
          </svg>
        </div>

        <p className="dropzone-title" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>
          {isDragActive ? "Drop the files here…" : "Drag & drop your manifest Excel files here"}
        </p>
        <p className="dropzone-sub" style={{ fontSize: '0.9rem', color: 'var(--ink-muted)', maxWidth: '520px', margin: '0 auto' }}>
          Supports <strong>.xlsx</strong> — drop multiple files at once, no submit button needed.
          Manifests and bills are created as soon as the upload completes.
        </p>

        <div style={{ marginTop: 24 }}>
          <button type="button" className="btn btn-primary" onClick={open}>
            Browse files
          </button>
        </div>
      </div>

      {/* ============ SESSION BATCH SUMMARY ============ */}
      {results.length > 0 && (
        <div className="batch-summary">
          <div className="batch-summary-item">
            <div className="batch-summary-value">{sessionStats.totalFiles}</div>
            <div className="batch-summary-label">Files</div>
          </div>
          <div className="batch-summary-item batch-success">
            <div className="batch-summary-value">{sessionStats.succeeded}</div>
            <div className="batch-summary-label">Succeeded</div>
          </div>
          <div className="batch-summary-item batch-warning">
            <div className="batch-summary-value">{sessionStats.skipped}</div>
            <div className="batch-summary-label">Skipped</div>
          </div>
          <div className="batch-summary-item batch-danger">
            <div className="batch-summary-value">{sessionStats.failed}</div>
            <div className="batch-summary-label">Failed</div>
          </div>
          <div className="batch-summary-item batch-info">
            <div className="batch-summary-value">{sessionStats.billsUploaded}</div>
            <div className="batch-summary-label">Bills added</div>
          </div>
        </div>
      )}

      {/* ============ PER-FILE PROGRESS LIST ============ */}
      {results.length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">This session</div>
              <div className="panel-sub">
                {sessionStats.totalFiles} file{sessionStats.totalFiles === 1 ? "" : "s"} · live upload status
              </div>
            </div>
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => {
                setResults([]);
                timerRefs.current.forEach((t) => window.clearInterval(t));
                timerRefs.current.clear();
              }}
            >
              Clear
            </button>
          </div>

          <div className="upload-progress-list">
            {results.map((r) => {
              const meta = STATUS_META[r.status];
              const isActive = r.status === "uploading" || r.status === "queued";
              return (
                <div key={r.id} className="upload-progress-item">
                  <div className="upload-progress-head">
                    <div className="upload-progress-name">
                      <FileIcon />
                      <span className="mono">{r.name}</span>
                      <span className="upload-progress-size">{formatBytes(r.size)}</span>
                    </div>
                    <span className={`upload-pill upload-pill-${meta.tone}`}>
                      {isActive && <span className="mini-spinner" />}
                      {meta.label}
                    </span>
                  </div>

                  <div className="upload-progress-bar-track">
                    <div
                      className={`upload-progress-bar-fill upload-progress-bar-fill-${meta.tone}`}
                      style={{ width: `${r.progress}%` }}
                    />
                  </div>

                  <div className="upload-progress-meta">
                    <span className="upload-progress-message">
                      {r.message}
                      {r.manifestNumber && <><span> · </span><span className="mono">{r.manifestNumber}</span></>}
                      {r.flightNumber && <><span> · </span><span className="mono">Flight {r.flightNumber}</span></>}
                      {r.totalBills !== undefined && <><span> · </span><strong>{r.totalBills}</strong> bills</>}
                    </span>
                    {isActive && <span className="upload-progress-pct">{Math.round(r.progress)}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ RECENT UPLOADS TABLE ============ */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Recent uploads</div>
            <div className="panel-sub">Last 10 manifests ingested</div>
          </div>
          <button className="btn btn-outline" type="button" onClick={loadRecent}>Refresh</button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Manifest #</th>
                <th>File name</th>
                <th>Bills</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {recentLoading && (
                <tr><td colSpan={4}><p className="empty-note">Loading…</p></td></tr>
              )}
              {!recentLoading && recent.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.manifest_number}</td>
                  <td className="mono" style={{ color: "var(--ink-muted)" }}>{m.original_filename}</td>
                  <td><span className="badge badge-scanned">{m.total_bills}</span></td>
                  <td>{fmtDateTime(m.upload_date)}</td>
                </tr>
              ))}
              {!recentLoading && recent.length === 0 && (
                <tr><td colSpan={4}><p className="empty-note">No manifests uploaded yet — drop your first file above.</p></td></tr>
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
  tone: "primary" | "success" | "info" | "purple" | "warning" | "danger";
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
const IconUpload = () => (
  <svg {...iconProps}><path d="M12 17V5" /><path d="m7 10 5-5 5 5" /><path d="M4 19h16" /></svg>
);
const IconChart = () => (
  <svg {...iconProps}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>
);

/* File icon used in the progress list */
function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-indigo)" }}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}