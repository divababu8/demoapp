"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

export default function OveragesPage() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      // Uses the manifest_overages SQL view (last 7 days rollup)
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
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 24 }}>
        <h1>Overages (last 7 days)</h1>
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 16 }}>
          <thead>
            <tr>
              <th style={thStyle}>Manifest #</th>
              <th style={thStyle}>Upload Date</th>
              <th style={thStyle}>Total Bills</th>
              <th style={thStyle}>Scanned</th>
              <th style={thStyle}>Overage (Not Scanned)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.manifest_id}>
                <td style={tdStyle}>{r.manifest_number}</td>
                <td style={tdStyle}>{new Date(r.upload_date).toLocaleString()}</td>
                <td style={tdStyle}>{r.total_bills}</td>
                <td style={tdStyle}>{r.scanned_count}</td>
                <td style={{ ...tdStyle, color: r.pending_count > 0 ? "red" : "green", fontWeight: 700 }}>
                  {r.pending_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}

const thStyle: React.CSSProperties = { border: "1px solid #eee", padding: 8, background: "#fafafa", textAlign: "left" };
const tdStyle: React.CSSProperties = { border: "1px solid #f5f5f5", padding: 8 };
