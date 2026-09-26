"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import Sidebar from "@/components/Sidebar";
import { getAuthHeader } from "@/lib/supabaseClient";

interface FileStatus {
  name: string;
  status: "processing" | "created" | "updated" | "skipped" | "rejected" | "error";
  message: string;
  totalBills?: number;
}

export default function UploadPage() {
  const [results, setResults] = useState<FileStatus[]>([]);

  const manifestsUploaded = results.filter(
    (r) => r.status === "created" || r.status === "updated"
  ).length;
  const billsUploaded = results.reduce((sum, r) => sum + (r.totalBills ?? 0), 0);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const initial = acceptedFiles.map((f) => ({
      name: f.name,
      status: "processing" as const,
      message: "Uploading...",
    }));
    setResults((prev) => [...initial, ...prev]);

    const authHeader = await getAuthHeader();

    await Promise.all(
      acceptedFiles.map(async (file) => {
        const formData = new FormData();
        formData.append("file", file);

        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            headers: authHeader,
            body: formData,
          });
          const data = await res.json();

          setResults((prev) =>
            prev.map((r) =>
              r.name === file.name
                ? {
                    name: file.name,
                    status: data.status ?? "error",
                    message: data.message ?? data.error,
                    totalBills: data.total_bills,
                  }
                : r
            )
          );
        } catch (err: any) {
          setResults((prev) =>
            prev.map((r) =>
              r.name === file.name ? { name: file.name, status: "error", message: err.message } : r
            )
          );
        }
      })
    );
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    multiple: true,
  });

  const statusClass: Record<FileStatus["status"], string> = {
    processing: "status-processing",
    created: "status-created",
    updated: "status-updated",
    skipped: "status-skipped",
    rejected: "status-rejected",
    error: "status-error",
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <div className="page-header">
          <h1 className="page-title">Upload data</h1>
          <p className="page-subtitle">Drop manifest Excel files — each one becomes a manifest, automatically.</p>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{manifestsUploaded}</div>
            <div className="stat-label">Manifests uploaded this session</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{billsUploaded}</div>
            <div className="stat-label">Total bills uploaded this session</div>
          </div>
        </div>

        <div {...getRootProps()} className={`dropzone${isDragActive ? " active" : ""}`}>
          <input {...getInputProps()} />
          <p className="dropzone-title">Drag & drop your manifest Excel files here (.xlsx)</p>
          <p className="dropzone-sub">No submit button needed — manifests and bills are created as soon as you drop.</p>
        </div>

        {results.length > 0 && (
          <div className="upload-result-list">
            {results.map((r, i) => (
              <div key={i} className="upload-result">
                <span className="upload-result-name">{r.name}</span>
                <span className={statusClass[r.status]}>{r.message}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
