"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

export default function OveragesPage() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("manifest_overages")
        .select("*")
        .order("upload_date", { ascending: false });
      setRows(data ?? []);
    }
    load();

    const channel = supabase
      .channel("overages-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <div className="page-header">
          <h1 className="page-title">Overages</h1>
          <p className="page-subtitle">Manifests from the last 7 days, with bills still pending scan.</p>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.manifest_id}>
                  <td className="mono">{r.manifest_number}</td>
                  <td>{new Date(r.upload_date).toLocaleString()}</td>
                  <td>{r.total_bills}</td>
                  <td>{r.scanned_count}</td>
                  <td>
                    <span className={`badge ${r.pending_count > 0 ? "badge-pending" : "badge-scanned"}`}>
                      {r.pending_count}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty-note">No manifests in the last 7 days.</p>}
        </div>
      </main>
    </div>
  );
}
