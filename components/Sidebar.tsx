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
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-mark">MF</span>
        <span>
          <span className="sidebar-brand-text">Manifest</span>
          <br />
          <span className="sidebar-brand-sub">scanning desk</span>
        </span>
      </div>

      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`nav-link${pathname === l.href ? " active" : ""}`}
        >
          {l.label}
        </Link>
      ))}

      <button onClick={handleLogout} className="sidebar-logout">
        Logout
      </button>
    </nav>
  );
}
