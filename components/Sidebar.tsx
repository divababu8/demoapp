"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/shipments", label: "Shipments" },
  { href: "/overages", label: "Overages" },
  { href: "/upload", label: "Upload Data" },
  { href: "/scanning", label: "Scanning" },
  { href: "/reports", label: "Reports" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <nav style={{ width: 200, borderRight: "1px solid #eee", height: "100vh", padding: 16, display: "flex", flexDirection: "column" }}>
      <h3 style={{ marginBottom: 20 }}>Manifest App</h3>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          style={{
            display: "block",
            padding: "8px 0",
            fontWeight: pathname === l.href ? 700 : 400,
            color: pathname === l.href ? "#0070f3" : "#333",
          }}
        >
          {l.label}
        </Link>
      ))}
      <button
        onClick={handleLogout}
        style={{ marginTop: "auto", padding: 8, cursor: "pointer" }}
      >
        Logout
      </button>
    </nav>
  );
}
