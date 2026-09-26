"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

interface Stats {
  totalManifests: number;
  totalBills: number;
  scannedCount: number;
  pendingCount: number;
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

    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bills" }, loadStats)
      .on("postgres_changes", { event: "*", schema: "public", table: "manifests" }, loadStats)
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
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.totalManifests}</div>
            <div className="stat-label">Total manifests</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.totalBills}</div>
            <div className="stat-label">Total bills</div>
          </div>
          <div className="stat-card">
            <div className="stat-value success">{stats.scannedCount}</div>
            <div className="stat-label">Scan finished</div>
          </div>
          <div className="stat-card">
            <div className="stat-value danger">{stats.pendingCount}</div>
            <div className="stat-label">Scan pending (overages)</div>
          </div>
        </div>
      </main>
    </div>
  );
}
