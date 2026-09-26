"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

export default function ShipmentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [manifestFilter, setManifestFilter] = useState("");
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  async function loadData() {
    let query = supabase
      .from("bills")
      .select("awb_number, scan_status, extra_data, created_at, manifests(manifest_number)")
      .gte("created_at", `${dateFrom}T00:00:00`)
      .lte("created_at", `${dateTo}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(500);

    if (manifestFilter) {
      query = query.ilike("manifests.manifest_number", `%${manifestFilter}%`);
    }

    const { data } = await query;
    setRows(data ?? []);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamic columns: derived from the first row's extra_data keys so the
  // table always reflects whatever ~38 columns exist, with no hardcoding.
  const extraColumns = rows.length > 0 ? Object.keys(rows[0].extra_data) : [];

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 24, overflowX: "auto" }}>
        <h1>Shipments</h1>

        <div style={{ display: "flex", gap: 12, alignItems: "end", marginTop: 12 }}>
          <div>
            <label>Manifest #</label><br />
            <input value={manifestFilter} onChange={(e) => setManifestFilter(e.target.value)} />
          </div>
          <div>
            <label>From</label><br />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label>To</label><br />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button onClick={loadData}>Apply Filter</button>
        </div>

        <div style={{ marginTop: 20, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Manifest #</th>
                <th style={thStyle}>AWB Number</th>
                <th style={thStyle}>Scan Status</th>
                {extraColumns.map((col) => (
                  <th key={col} style={thStyle}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{r.manifests?.manifest_number}</td>
                  <td style={tdStyle}>{r.awb_number}</td>
                  <td style={tdStyle}>{r.scan_status}</td>
                  {extraColumns.map((col) => (
                    <td key={col} style={tdStyle}>
                      {r.extra_data[col] === null ? "-" : String(r.extra_data[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

const thStyle: React.CSSProperties = { border: "1px solid #eee", padding: 6, background: "#fafafa", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { border: "1px solid #f5f5f5", padding: 6, whiteSpace: "nowrap" };
