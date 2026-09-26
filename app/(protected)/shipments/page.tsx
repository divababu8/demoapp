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

  const extraColumns = rows.length > 0 ? Object.keys(rows[0].extra_data) : [];

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <div className="page-header">
          <h1 className="page-title">Shipments</h1>
          <p className="page-subtitle">Defaults to today — filter for any date range or manifest.</p>
        </div>

        <div className="filter-bar">
          <div className="field">
            <label>Manifest #</label>
            <input value={manifestFilter} onChange={(e) => setManifestFilter(e.target.value)} placeholder="Search manifest" />
          </div>
          <div className="field">
            <label>From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button onClick={loadData} className="btn btn-primary">Apply filter</button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Manifest #</th>
                <th>AWB Number</th>
                <th>Scan Status</th>
                {extraColumns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.manifests?.manifest_number}</td>
                  <td className="mono">{r.awb_number}</td>
                  <td>
                    <span className={`badge ${r.scan_status === "scanned" ? "badge-scanned" : "badge-pending"}`}>
                      {r.scan_status}
                    </span>
                  </td>
                  {extraColumns.map((col) => (
                    <td key={col}>{r.extra_data[col] === null ? "–" : String(r.extra_data[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="empty-note">No shipments in this date range.</p>}
        </div>
      </main>
    </div>
  );
}
