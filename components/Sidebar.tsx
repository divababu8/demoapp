"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  section: "main" | "data" | "reports";
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard",  icon: "grid",      section: "main" },
  { href: "/scanning",  label: "Scanning",   icon: "scan",      section: "main" },
  { href: "/shipments", label: "Shipments",  icon: "truck",     section: "main" },
  { href: "/overages",  label: "Overages",   icon: "alert",     section: "main" },
  { href: "/upload",    label: "Upload",     icon: "upload",    section: "data" },
  { href: "/reports",   label: "Reports",    icon: "chart",     section: "data" },
];

const SECTION_LABEL: Record<NavItem["section"], string> = {
  main: "Operations",
  data: "Data",
  reports: "Insights",
};

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const sections: NavItem["section"][] = ["main", "data", "reports"];

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className="sidebar-mobile-toggle"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Toggle navigation"
      >
        <Icon name={mobileOpen ? "close" : "menu"} />
      </button>

      {/* Backdrop on mobile */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={`sidebar${collapsed ? " collapsed" : ""}${
          mobileOpen ? " mobile-open" : ""
        }`}
      >
        <div className="sidebar-brand">
          {/* Changed to use accent-indigo for a vibrant pop against white */}
          <div className="brand-mark" style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', color: '#fff' }}>
            <Icon name="box" />
          </div>
          {!collapsed && (
            <div className="brand-text">
              <div className="brand-title">Manifest</div>
              <div className="brand-sub">Scanning Console</div>
            </div>
          )}
          <button
            className="sidebar-collapse-btn"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title={collapsed ? "Expand" : "Collapse"}
            style={{ color: 'var(--ink-muted)', background: 'var(--paper)' }}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-left"} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {sections.map((section) => {
            const items = NAV.filter((n) => n.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="sidebar-section">
                {!collapsed && (
                  <div className="sidebar-section-label">{SECTION_LABEL[section]}</div>
                )}
                {items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`sidebar-link${active ? " active" : ""}`}
                      title={collapsed ? item.label : undefined}
                    >
                      <span className="sidebar-link-icon">
                        <Icon name={item.icon} />
                      </span>
                      {!collapsed && <span>{item.label}</span>}
                      {active && <span className="sidebar-link-dot" />}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-live">
            <span className="live-dot" style={{ background: 'var(--success)' }} />
            {!collapsed && <span style={{ color: 'var(--ink-muted)' }}>Realtime connected</span>}
          </div>

          <div className="sidebar-user" title={email} style={{ background: 'var(--paper)', border: '1px solid var(--border)' }}>
            {/* Changed avatar to a soft indigo circle for a modern look */}
            <div className="user-avatar" style={{ background: 'var(--accent-indigo-soft)', color: 'var(--accent-indigo)' }}>
              {(email[0] ?? "U").toUpperCase()}
            </div>
            {!collapsed && (
              <div className="user-meta">
                <div className="user-email" style={{ color: 'var(--ink)' }}>{email || "Signed in"}</div>
                <div className="user-role" style={{ color: 'var(--ink-muted)' }}>Operator</div>
              </div>
            )}
          </div>

          <button className="sidebar-logout" onClick={handleLogout} style={{ color: 'var(--ink-muted)', borderColor: 'var(--border)' }}>
            <Icon name="logout" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny inline SVG icon set — no external icon lib required            */
/* ------------------------------------------------------------------ */
function Icon({ name }: { name: string }) {
  const p: Record<string, JSX.Element> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    scan: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3" />
        <path d="M16 4h3a1 1 0 0 1 1 1v3" />
        <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
        <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M4 12h16" />
      </>
    ),
    truck: (
      <>
        <rect x="1" y="7" width="13" height="9" rx="1.5" />
        <path d="M14 10h4l3 3v3h-7z" />
        <circle cx="6" cy="18" r="1.6" />
        <circle cx="17" cy="18" r="1.6" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3 2 20h20L12 3z" />
        <path d="M12 9v5" />
        <circle cx="12" cy="17" r=".6" fill="currentColor" />
      </>
    ),
    upload: (
      <>
        <path d="M12 17V5" />
        <path d="m7 10 5-5 5 5" />
        <path d="M4 19h16" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M22 20H2" />
      </>
    ),
    box: (
      <>
        <path d="m3 7 9-4 9 4-9 4-9-4z" />
        <path d="M3 7v10l9 4 9-4V7" />
        <path d="M12 11v10" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </>
    ),
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    menu: (
      <>
        <path d="M3 6h18" />
        <path d="M3 12h18" />
        <path d="M3 18h18" />
      </>
    ),
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="20" // Slightly increased from 18 for better balance
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {p[name] ?? null}
    </svg>
  );
}