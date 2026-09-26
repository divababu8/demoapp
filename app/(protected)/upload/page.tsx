"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase, getAuthHeader } from "@/lib/supabaseClient";

/* =====================================================================
   TYPES
   ===================================================================== */
type FileStatusKind =
  | "queued"
  | "uploading"
  | "created"
  | "updated"
  | "skipped"
  | "rejected"
  | "error";

interface FileStatus {
  id: string;
  name: string;
  size: number;
  status: FileStatusKind;
  message: string;
  progress: number; // 0..100
  totalBills?: number;
  manifestNumber?: string;
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
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_META: Record<
  FileStatusKind,
  { label: string; tone: "neutral" | "success" | "warning" | "danger" }
> = {
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

  /* ---------- load recent manifests ---------- */
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manifests" },
        loadRecent
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      // Clean up any ticking timers on unmount
      timerRefs.current.forEach((t) => window.clearInterval(t));
      timerRefs.current.clear();
    };
  }, []);

  /* ---------- simulated progress ticker ---------- */
  function startProgressTicker(id: string) {
    // Progress creeps toward 90% while waiting for the server response.
    // Real completion snaps it to 100%.
    const tick = window.setInterval(() => {
      setResults((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          if (r.status !== "uploading") return r;
          const next = Math.min(90, r.progress + Math.random() * 8 + 2);
          return { ...r, progress: next };
        })
      );
    }, 250);
    timerRefs.current.set(id, tick);
  }

  function stopProgressTicker(id: string) {
    const t = timerRefs.current.get(id);
    if (t !== undefined) {
      window.clearInterval(t);
      timerRefs.current.delete(id);
    }
  }

  /* ---------- upload handler ---------- */
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const initial: FileStatus[] = acceptedFiles.map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      size: f.size,
      status: "uploading",
      message: "Uploading…",
      progress: 3,
    }));

    // Prepend new uploads so most recent appears at the top
    setResults((prev) => [...initial, ...prev]);

    // Start progress tickers
    initial.forEach((f) => startProgressTicker(f.id));

    const authHeader = await getAuthHeader();

    await Promise.all(
      acceptedFiles.map(async (file, idx) => {
        const entry = initial[idx];

        const formData = new FormData();
        formData.append("file", file);

        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: authHeader,
            body: formData,
          });
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
                ? {
                    ...r,
                    status: "error",
                    message: err.message ?? "Upload failed.",
                    progress: 100,
                  }
                : r
            )
          );
        }
      })
    );

    // Refresh the recent table after the batch finishes
    loadRecent();
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    multiple: true,
    noClick: true, // we'll wire the click manually for the browse button
  });

  /* ---------- aggregate session stats ---------- */
  const sessionStats = useMemo(() => {
    const uploads = results;
    const manifestsUploaded = uploads.filter(
      (r) => r.status === "created" || r.status === "updated"
    ).length;
    const billsUploaded = uploads.reduce(
      (sum, r) => sum + (r.totalBills ?? 0),
      0
    );
    const succeeded = uploads.filter(
      (r) => r.status === "created" || r.status === "updated"
    ).length;
    const skipped = uploads.filter((r) => r.status === "skipped").length;
    const failed = uploads.filter(
      (r) => r.status === "rejected" || r.status === "error"
    ).length;
    const inProgress = uploads.filter(
      (r) => r.status === "uploading" || r.status === "queued"
    ).length;
    return {
      manifestsUploaded,
      billsUploaded,
      succeeded,
      skipped,
      failed,
      inProgress,
      totalFiles: uploads.length,
    };
  }, [results]);

  /* ---------- header stats (all-time) ---------- */
  const allTime = useMemo(() => {
    const totalManifests = recent.length
      ? recent.reduce((s, r) => s + 1, 0)
      : 0;
    // Only counts the last 10 shown — full count via a lightweight query
    return { totalManifests };
  }, [recent]);

  const [globalStats, setGlobalStats] = useState({
    totalManifests: 0,
    totalBills: 0,
    billsToday: 0,
    scannedToday: 0,
  });

  useEffect(() => {
    async function loadGlobalStats() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const { count: manifestCount } = await supabase
        .from("manifests")
        .select("*", { count: "exact", head: true });

      const { count: billCount } = await supabase
        .from("bills")
        .select("*", { count: "exact", head: true });

      const { count: todayCount } = await supabase
        .from("bills")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayIso);

      const { count: todayScanned } = await supabase
        .from("bills")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayIso)
        .eq("scan_status", "scanned");

      setGlobalStats({
        totalManifests: manifestCount ?? 0,
        totalBills: billCount ?? 0,
        billsToday: todayCount ?? 0,
        scannedToday: todayScanned ?? 0,
      });
    }

    loadGlobalStats();

    const ch = supabase
      .channel("upload-stats-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bills" },
        loadGlobalStats
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manifests" },
        loadGlobalStats
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  /* ---------- render ---------- */
  return (
    <>
      {/* ============ HEADER ============ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload data</h1>
          <p className="page-subtitle">
            Drop manifest Excel files — each becomes a manifest automatically.
          </p>
        </div>
        <div className="page-header-actions">
          <span className="live-pill">
            <span className="live-dot" /> Live
          </span>
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
            <div className="kpi-value">{globalStats.totalManifests}</div>
          </div>
          <div className="kpi-label">Total manifests</div>
          <div className="kpi-hint">All time</div>
        </div>

        <div className="kpi-card kpi-success">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="7" width="13" height="9" rx="1.5" />
                <path d="M14 10h4l3 3v3h-7z" />
                <circle cx="6" cy="18" r="1.6" />
                <circle cx="17" cy="18" r="1.6" />
              </svg>
            </div>
            <div className="kpi-value">{globalStats.totalBills}</div>
          </div>
          <div className="kpi-label">Total bills</div>
          <div className="kpi-hint">All manifests combined</div>
        </div>

        <div className="kpi-card kpi-info">
          <div className="kpi-top">
            <div className="kpi-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17V5" />
                <path d="m7 10 5-5 5 5" />
                <path d="M4 19h16" />
              </svg>
            </div>
            <div className="kpi-value">{globalStats.billsToday}</div>
          </div>
          <div className="kpi-label">Bills uploaded today</div>
          <div className="kpi-hint">
            {globalStats.billsToday === 0
              ? "No uploads yet"
              : `${globalStats.scannedToday} scanned`}
          </div>
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
            <div className="kpi-value">{sessionStats.totalFiles}</div>
          </div>
          <div className="kpi-label">Files this session</div>
          <div className="kpi-hint">
            {sessionStats.inProgress > 0
              ? `${sessionStats.inProgress} in progress`
              : sessionStats.totalFiles === 0
              ? "Drop files to begin"
              : "Batch complete"}
          </div>
        </div>
      </div>

      {/* ============ DROPZONE ============ */}
      <div
        {...getRootProps()}
        className={`dropzone${isDragActive ? " active" : ""}`}
      >
        <input {...getInputProps()} />

        <div className="dropzone-icon">
          <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17V5" />
            <path d="m7 10 5-5 5 5" />
            <path d="M4 19h16" />
          </svg>
        </div>

        <p className="dropzone-title">
          {isDragActive
            ? "Drop the files here…"
            : "Drag & drop your manifest Excel files here"}
        </p>
        <p className="dropzone-sub">
          Supports <strong>.xlsx</strong> — drop multiple files at once, no submit
          button needed. Manifests and bills are created as soon as the upload
          completes.
        </p>

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={open}
          >
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
        <div className="panel-flush" style={{ marginBottom: 18 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">This session</div>
              <div className="panel-sub">
                {sessionStats.totalFiles} file
                {sessionStats.totalFiles === 1 ? "" : "s"} · live upload status
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
              style={{ padding: "7px 14px", fontSize: "0.78rem" }}
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
                      <span className="upload-progress-size">
                        {formatBytes(r.size)}
                      </span>
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
                      {r.manifestNumber && (
                        <>
                          {" · "}
                          <span className="mono">{r.manifestNumber}</span>
                        </>
                      )}
                      {r.totalBills !== undefined && (
                        <>
                          {" · "}
                          <strong>{r.totalBills}</strong> bills
                        </>
                      )}
                    </span>
                    {isActive && (
                      <span className="upload-progress-pct">
                        {Math.round(r.progress)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ RECENT UPLOADS TABLE ============ */}
      <div className="panel-flush">
        <div className="panel-header">
          <div>
            <div className="panel-title">Recent uploads</div>
            <div className="panel-sub">Last 10 manifests ingested</div>
          </div>
          <button
            className="btn btn-outline"
            type="button"
            onClick={loadRecent}
            style={{ padding: "7px 14px", fontSize: "0.78rem" }}
          >
            Refresh
          </button>
        </div>

        <div className="table-wrap" style={{ border: "none", borderRadius: 0, boxShadow: "none" }}>
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
                <tr>
                  <td colSpan={4}>
                    <p className="empty-note">Loading…</p>
                  </td>
                </tr>
              )}
              {!recentLoading &&
                recent.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.manifest_number}</td>
                    <td className="mono" style={{ color: "var(--ink-muted)" }}>
                      {m.original_filename}
                    </td>
                    <td>
                      <span className="badge badge-scanned">{m.total_bills}</span>
                    </td>
                    <td>{fmtDateTime(m.upload_date)}</td>
                  </tr>
                ))}
              {!recentLoading && recent.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <p className="empty-note">
                      No manifests uploaded yet — drop your first file above.
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

/* =====================================================================
   Inline icons
   ===================================================================== */
function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--accent-dark)" }}
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}