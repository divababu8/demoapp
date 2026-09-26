"use client";

import { useEffect, useRef, useState } from "react";
import { getAuthHeader } from "@/lib/supabaseClient";
import Sidebar from "@/components/Sidebar";

export default function ScanningPage() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<any>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const awb = input.trim();
    if (!awb) return;

    const mySeq = ++requestSeq.current;
    setInput("");
    inputRef.current?.focus();

    if (!/^\d+$/.test(awb)) {
      setNotFound(`"${awb}" is not a valid AWB number — enter the full number only.`);
      setResult(null);
      return;
    }

    setNotFound(null);
    setPending(true);

    try {
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/bills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ awb_number: awb }),
      });

      if (mySeq !== requestSeq.current) return;

      if (res.status === 401) {
        setNotFound("Your session expired — please log in again.");
        setResult(null);
        return;
      }

      const data = await res.json();

      if (!data.found) {
        setNotFound(data.message);
        setResult(null);
        beep(false);
      } else {
        setResult(data);
        setNotFound(null);
        beep(true);
      }
    } catch (err: any) {
      if (mySeq !== requestSeq.current) return;
      setNotFound("Network error — could not reach the server. Check your connection and try again.");
      setResult(null);
    } finally {
      if (mySeq === requestSeq.current) setPending(false);
    }
  }

  function beep(success: boolean) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.frequency.value = success ? 880 : 220;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Non-critical
    }
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        <div className="page-header">
          <h1 className="page-title">Scanning</h1>
          <p className="page-subtitle">Scan or type an AWB number, then press Enter.</p>
        </div>

        <div className="scan-input-wrap">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleEnter}
            placeholder="Scan or type AWB number, then Enter"
            autoFocus
            className="scan-input"
          />
          {pending && <span className="scan-pending-indicator">Looking up…</span>}
        </div>

        {notFound && <p className="scan-alert">{notFound}</p>}

        {result && (
          <div className="scan-result panel">
            <div className="scan-result-header">
              <span className="mono">AWB {result.bill.awb_number}</span>
              <span className={`badge ${result.justScanned ? "badge-scanned" : "badge-pending"}`}>
                {result.justScanned ? "Scanned now" : "Already scanned"}
              </span>
            </div>
            <p className="page-subtitle" style={{ margin: "4px 0" }}>
              Manifest <span className="mono">{result.bill.manifest_number}</span> · Searched {result.searchCount} time{result.searchCount === 1 ? "" : "s"}
            </p>

            <table className="kv-table">
              <tbody>
                {Object.entries(result.bill.extra_data).map(([key, value]: any) => (
                  <tr key={key}>
                    <td className="kv-key">{key}</td>
                    <td>{value === null ? "–" : String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
