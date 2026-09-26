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
      headStyles: { fillColor: [14, 107, 92] },
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
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <div className="page-header">
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">
            End-of-day export — manifests, bill counts, scan progress, and total search attempts.
          </p>
        </div>

        <div className="filter-bar">
          <div className="field">
            <label>From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button onClick={loadReport} className="btn btn-outline">
            {loading ? "Loading…" : "Apply"}
          </button>
          <button onClick={exportExcel} disabled={rows.length === 0} className="btn btn-primary">
            Export Excel
          </button>
          <button onClick={exportPdf} disabled={rows.length === 0} className="btn btn-outline">
            Export PDF
          </button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
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
                  <td>{r.total_search_count}</td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="totals-row">
                  <td>Total ({rows.length} manifests)</td>
                  <td></td>
                  <td>{totals.bills}</td>
                  <td>{totals.scanned}</td>
                  <td>{totals.pending}</td>
                  <td>{totals.searches}</td>
                </tr>
              )}
            </tbody>
          </table>
          {rows.length === 0 && !loading && <p className="empty-note">No manifests in this date range.</p>}
        </div>
      </main>
    </div>
  );
}
