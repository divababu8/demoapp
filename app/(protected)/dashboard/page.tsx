"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

interface Stats {
  totalManifests: number;
  totalBills: number;
  scannedCount: number;
  pendingCount: number; // overages
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    totalManifests: 0,
    totalBills: 0,
    scannedCount: 0,
    pendingCount: 0,
  });

  async function loadStats() {
    const { count: manifestCount } = await supabase
      .from("manifests")
      .select("*", { count: "exact", head: true });

    const { count: billCount } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true });

    const { count: scannedCount } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("scan_status", "scanned");

    const { count: pendingCount } = await supabase
      .from("bills")
      .select("*", { count: "exact", head: true })
      .eq("scan_status", "pending");

    setStats({
      totalManifests: manifestCount ?? 0,
      totalBills: billCount ?? 0,
      scannedCount: scannedCount ?? 0,
      pendingCount: pendingCount ?? 0,
    });
  }

  useEffect(() => {
    loadStats();

    // Realtime: any insert/update on bills or manifests -> refresh counters
    // instantly for both scanners, no manual refresh needed.
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, loadStats)
      .on("postgres_changes", { event: "*", schema: "public", table: "manifests" }, loadStats)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const cardStyle: React.CSSProperties = {
    flex: 1,
    padding: 20,
    border: "1px solid #eee",
    borderRadius: 8,
    textAlign: "center",
  };

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 24 }}>
        <h1>Dashboard</h1>
        <p style={{ color: "#666" }}>{new Date().toLocaleDateString()}</p>
        <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
          <div style={cardStyle}>
            <h2>{stats.totalManifests}</h2>
            <p>Total Manifests</p>
          </div>
          <div style={cardStyle}>
            <h2>{stats.totalBills}</h2>
            <p>Total Bills</p>
          </div>
          <div style={cardStyle}>
            <h2 style={{ color: "green" }}>{stats.scannedCount}</h2>
            <p>Scan Finished</p>
          </div>
          <div style={cardStyle}>
            <h2 style={{ color: "orange" }}>{stats.pendingCount}</h2>
            <p>Scan Pending (Overages)</p>
          </div>
        </div>
      </main>
    </div>
  );
}
