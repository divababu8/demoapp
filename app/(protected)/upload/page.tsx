"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase, getAuthHeader } from "@/lib/supabaseClient";

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
  flight_number: string | null;
  original_filename: string;
  total_bills: number;
  upload_date: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
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

export default function UploadPage() {
  const [results, setResults] = useState<FileStatus[]>([]);
  const [recent, setRecent] = useState<RecentManifest[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const timerRefs = useRef<Map<string, number>>(new Map());

  async function loadRecent() {
    setRecentLoading(true);
    const { data } = await supabase
      .from("manifests")
      .select("id, manifest_number, flight_number, original_filename, total_bills, upload_date")
      .order("upload_date", { ascending: false })
      .limit(10);
    setRecent(data ?? []);
    setSelected(new Set()); // clear selection on refresh
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
    const billsUploaded = uploads.reduce((sum, r) => sum + (r.totalBills ?? 0), 0);
    const succeeded = uploads.filter((r) => r.status === "created" || r.status === "updated").length;
    const skipped = uploads.filter((r) => r.status === "skipped").length;
    const failed = uploads.filter((r) => r.status === "rejected" || r.status === "error").length;
    const inProgress = uploads.filter((r) => r.status === "uploading" || r.status === "queued").length;
    return { billsUploaded, succeeded, skipped, failed, inProgress, totalFiles: uploads.length };
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

  /* ---------- Selection helpers ---------- */
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === recent.length) setSelected(new Set());
    else setSelected(new Set(recent.map((m) => m.id)));
  }

  /* ---------- Delete handler ----------
     Deletes the selected manifests (and their bills, via ON DELETE CASCADE
     on the bills.manifest_id FK). After deletion, the user can re-upload
     the same file freely — the manifest_number no longer exists.          */
  async function deleteSelected() {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!confirm(`Delete ${count} manifest${count === 1 ? "" : "s"} and all their bills? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const authHeader = await getAuthHeader();

      // Delete manifests one by one via the API so RLS/service-role is used
      // server-side. Also pass the auth header so /api/manifests/delete can
      // verify the caller.
      for (const id of Array.from(selected)) {
        const res = await fetch("/api/manifests/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify({ manifest_id: id }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`Failed to delete one manifest: ${err.error ?? res.statusText}`);
        }
      }
    } catch (e: any) {
      alert(`Delete failed: ${e.message ?? "Unknown error"}`);
    } finally {
      setDeleting(false);
      setSelected(new Set());
      loadRecent();
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload data</h1>
          <p className="page-subtitle">Drop manifest Excel files — each becomes a manifest automatically.</p>
        </div>
        <div className="page-header-actions">
          <span className="live-pill">
            <span className="live-dot" /> Live
          </span>
        </div>
      </div>

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
      <div {...getRootProps()} className={`dropzone${isDragActive ? " active" : ""}`}>
        <input {...getInputProps()} />
        <div className="dropzone-icon">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17V5" /><path d="m7 10 5-5 5 5" /><path d="M4 19h16" />
          </svg>
        </div>
        <p className="dropzone-title">
          {isDragActive ? "Drop the files here…" : "Drag & drop your manifest Excel files here"}
        </p>
        <p className="dropzone-sub">
          Supports <strong>.xlsx</strong> — drop multiple files at once, no submit button needed.
        </p>
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-primary" onClick={open}>
            Browse files
          </button>
        </div>
      </div>

      {/* ============ BATCH SUMMARY ============ */}
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

      {/* ============ PER-FILE PROGRESS ============ */}
      {results.length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <div>
              <div className="panel-title">This session</div>
              <div className="panel-sub">{sessionStats.totalFiles} file{sessionStats.totalFiles === 1 ? "" : "s"} · live upload status</div>
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
                    <div className={`upload-progress-bar-fill upload-progress-bar-fill-${meta.tone}`} style={{ width: `${r.progress}%` }} />
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

      {/* ============ RECENT UPLOADS ============ */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Recent uploads</div>
            <div className="panel-sub">
              Last 10 manifests · select to delete and re-upload
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selected.size > 0 && (
              <button
                className="btn btn-outline"
                type="button"
                onClick={deleteSelected}
                disabled={deleting}
                style={{ color: "#991b1b", borderColor: "rgba(239,68,68,0.4)", background: "#fee2e2" }}
              >
                {deleting ? "Deleting…" : `Delete ${selected.size} selected`}
              </button>
            )}
            <button className="btn btn-outline" type="button" onClick={loadRecent}>Refresh</button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={recent.length > 0 && selected.size === recent.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Manifest #</th>
                <th>Flight No</th>
                <th>File name</th>
                <th>Bills</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {recentLoading && (
                <tr><td colSpan={6}><p className="empty-note">Loading…</p></td></tr>
              )}
              {!recentLoading && recent.map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggleSelect(m.id)}
                      aria-label={`Select ${m.manifest_number}`}
                    />
                  </td>
                  <td className="mono">{m.manifest_number}</td>
                  <td className="mono">{m.flight_number || "—"}</td>
                  <td className="mono" style={{ color: "var(--ink-muted)" }}>{m.original_filename}</td>
                  <td><span className="badge badge-scanned badge-no-dot">{m.total_bills}</span></td>
                  <td>{fmtDateTime(m.upload_date)}</td>
                </tr>
              ))}
              {!recentLoading && recent.length === 0 && (
                <tr><td colSpan={6}><p className="empty-note">No manifests uploaded yet — drop your first file above.</p></td></tr>
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

const iconProps = {
  viewBox: "0 0 24 24", width: 22, height: 22, fill: "none",
  stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const IconBox = () => (<svg {...iconProps}><path d="m3 7 9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></svg>);
const IconTruck = () => (<svg {...iconProps}><rect x="1" y="7" width="13" height="9" rx="1.5" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>);
const IconUpload = () => (<svg {...iconProps}><path d="M12 17V5" /><path d="m7 10 5-5 5 5" /><path d="M4 19h16" /></svg>);
const IconChart = () => (<svg {...iconProps}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>);
function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--kpi-indigo)" }}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}