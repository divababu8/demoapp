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

  // Guards against out-of-order responses: if the scanner fires two scans
  // back-to-back, the second request's clear/refocus already happened, but
  // its response could theoretically arrive before the first one's. This
  // ensures the panel only ever shows the result of the MOST RECENT scan.
  const requestSeq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const awb = input.trim();
    if (!awb) return;

    const mySeq = ++requestSeq.current;

    // Clear + refocus BEFORE the network call, not after. A real scanner
    // fires scans faster than a round-trip can return, so the box must be
    // ready for the next scan immediately rather than waiting on the server.
    setInput("");
    inputRef.current?.focus();

    // AWB numbers are numeric-only. Block anything else here so a stray
    // Enter mid-type (partial number, stray letters) never even reaches
    // the API — the server-side lookup is already an exact match with no
    // events logged on a miss, this just avoids the wasted round-trip.
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

      // A newer scan has already fired since this request started — drop this
      // response so it can't overwrite the newer scan's result on screen.
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

  // Short audible confirmation, matching real barcode-scanner UX, so the
  // operator doesn't need to look at the screen after every single scan.
  function beep(success: boolean) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.frequency.value = success ? 880 : 220;
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Non-critical — ignore if AudioContext isn't available.
    }
  }

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, padding: 24 }}>
        <h1>Scanning</h1>
        <div style={{ position: "relative", marginTop: 16 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleEnter}
            placeholder="Scan or type AWB number, then Enter"
            autoFocus
            style={{ width: "100%", padding: 14, fontSize: 18 }}
          />
          {pending && (
            <span style={{ position: "absolute", right: 14, top: 16, color: "#999", fontSize: 13 }}>
              Looking up…
            </span>
          )}
        </div>

        {notFound && <p style={{ color: "red", marginTop: 16 }}>{notFound}</p>}

        {result && (
          <div style={{ marginTop: 24, border: "1px solid #eee", borderRadius: 8, padding: 20 }}>
            <h2>
              AWB: {result.bill.awb_number}{" "}
              <span style={{ color: result.justScanned ? "green" : "orange" }}>
                {result.justScanned ? "✔ Scanned now" : "Already scanned"}
              </span>
            </h2>
            <p>Manifest: <b>{result.bill.manifest_number}</b></p>
            <p>Search attempts for this bill: <b>{result.searchCount}</b></p>

            <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
              <tbody>
                {Object.entries(result.bill.extra_data).map(([key, value]: any) => (
                  <tr key={key} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: 6, color: "#666", width: 200 }}>{key}</td>
                    <td style={{ padding: 6 }}>{value === null ? "-" : String(value)}</td>
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
