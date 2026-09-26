"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ReportRow {
  manifest_id: string;
  manifest_number: string;
  upload_date: string;
  total_bills: number;
  scanned_count: number;
  pending_count: number;
  total_search_count: number;
}

export default function ReportsPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);

  async function loadReport() {
    setLoading(true);
    // manifest_report view already rolls up bills/scanned/pending/search
    // counts per manifest — this just applies the admin's chosen date range.
    const { data, error } = await supabase
      .from("manifest_report")
      .select("*")
      .gte("upload_date", `${dateFrom}T00:00:00`)
      .lte("upload_date", `${dateTo}T23:59:59`)
      .order("upload_date", { ascending: false });

    if (!error) setRows(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = [
    "Manifest #",
    "Upload Date",
    "Total Bills",
    "Scanned",
    "Pending (Overage)",
    "Total Times Searched",
  ];

  const tableData = rows.map((r) => [
    r.manifest_number,
    new Date(r.upload_date).toLocaleString(),
    r.total_bills,
    r.scanned_count,
    r.pending_count,
    r.total_search_count,
  ]);

  function exportExcel() {
    const worksheet = XLSX.utils.aoa_to_sheet([columns, ...tableData]);
    worksheet["!cols"] = columns.map(() => ({ wch: 20 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Manifest Report");
    XLSX.writeFile(workbook, `Manifest_Report_${dateFrom}_to_${dateTo}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Manifest Scanning Report", 14, 16);
    doc.setFontSize(10);
    doc.text(`Date range: ${dateFrom} to ${dateTo}`, 14, 22);

    autoTable(doc, {
      head: [columns],
      body: tableData,
      startY: 28,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [0, 112, 243] },
    });

    doc.save(`Manifest_Report_${dateFrom}_to_${dateTo}.pdf`);
  }

  const totals = rows.reduce(
    (acc, r) => ({
      bills: acc.bills + r.total_bills,
      scanned: acc.scanned + r.scanned_count,
      pending: acc.pending + r.pending_count,
      searches: acc.searches + r.total_search_count,
    }),
    { bills: 0, scanned: 0, pending: 0, searches: 0 }
  );

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 24 }}>
        <h1>Reports</h1>
        <p style={{ color: "#666" }}>
          End-of-day export: manifests, bill counts, scan progress, and total search attempts per manifest.
        </p>

        <div style={{ display: "flex", gap: 12, alignItems: "end", margin: "16px 0" }}>
          <div>
            <label>From</label><br />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label>To</label><br />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button onClick={loadReport}>{loading ? "Loading..." : "Apply"}</button>
          <button onClick={exportExcel} disabled={rows.length === 0}>
            Export Excel
          </button>
          <button onClick={exportPdf} disabled={rows.length === 0}>
            Export PDF
          </button>
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} style={thStyle}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.manifest_id}>
                <td style={tdStyle}>{r.manifest_number}</td>
                <td style={tdStyle}>{new Date(r.upload_date).toLocaleString()}</td>
                <td style={tdStyle}>{r.total_bills}</td>
                <td style={tdStyle}>{r.scanned_count}</td>
                <td style={{ ...tdStyle, color: r.pending_count > 0 ? "red" : "green" }}>{r.pending_count}</td>
                <td style={tdStyle}>{r.total_search_count}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr style={{ fontWeight: 700, borderTop: "2px solid #333" }}>
                <td style={tdStyle}>Total ({rows.length} manifests)</td>
                <td style={tdStyle}></td>
                <td style={tdStyle}>{totals.bills}</td>
                <td style={tdStyle}>{totals.scanned}</td>
                <td style={tdStyle}>{totals.pending}</td>
                <td style={tdStyle}>{totals.searches}</td>
              </tr>
            )}
          </tbody>
        </table>

        {rows.length === 0 && !loading && <p style={{ color: "#999", marginTop: 16 }}>No manifests in this date range.</p>}
      </main>
    </div>
  );
}

const thStyle: React.CSSProperties = { border: "1px solid #eee", padding: 8, background: "#fafafa", textAlign: "left" };
const tdStyle: React.CSSProperties = { border: "1px solid #f5f5f5", padding: 8 };
