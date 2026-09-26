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

  // Live, on-this-page summary — updates as each file finishes processing,
  // shown before the user ever navigates to the main Dashboard.
  const manifestsUploaded = results.filter(
    (r) => r.status === "created" || r.status === "updated"
  ).length;
  const billsUploaded = results.reduce((sum, r) => sum + (r.totalBills ?? 0), 0);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Each file is processed independently and in parallel — dropping 4
    // files creates/updates 4 manifests with no buttons or extra clicks.
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
            headers: authHeader, // required — API rejects unauthenticated requests
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

  const statusColor: Record<FileStatus["status"], string> = {
    processing: "#999",
    created: "green",
    updated: "blue",
    skipped: "orange",
    rejected: "red",
    error: "red",
  };

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 24 }}>
        <h1>Upload Data</h1>

        {/* Live summary — updates automatically as each file finishes, no navigation needed */}
        <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
          <div style={{ flex: 1, padding: 16, border: "1px solid #eee", borderRadius: 8, textAlign: "center" }}>
            <h2 style={{ margin: 0 }}>{manifestsUploaded}</h2>
            <p style={{ margin: 0, color: "#666" }}>Manifests Uploaded (this session)</p>
          </div>
          <div style={{ flex: 1, padding: 16, border: "1px solid #eee", borderRadius: 8, textAlign: "center" }}>
            <h2 style={{ margin: 0 }}>{billsUploaded}</h2>
            <p style={{ margin: 0, color: "#666" }}>Total Bills Uploaded (this session)</p>
          </div>
        </div>

        <div
          {...getRootProps()}
          style={{
            border: "2px dashed #999",
            borderRadius: 8,
            padding: 60,
            textAlign: "center",
            background: isDragActive ? "#f0f8ff" : "#fafafa",
            cursor: "pointer",
            marginTop: 16,
          }}
        >
          <input {...getInputProps()} />
          <p>Drag & drop your Manifest Excel files here (.xlsx)</p>
          <p style={{ color: "#999", fontSize: 13 }}>
            No submit button needed — manifests + bills are created automatically as soon as you drop.
          </p>
        </div>

        <div style={{ marginTop: 24 }}>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                padding: 10,
                borderBottom: "1px solid #eee",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>{r.name}</span>
              <span style={{ color: statusColor[r.status] }}>{r.message}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
