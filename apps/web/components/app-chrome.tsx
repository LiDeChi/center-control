"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  glyph: string;
  tone: "blue" | "green" | "orange" | "purple";
};

const navItems: NavItem[] = [
  { href: "/projects", label: "Projects", glyph: "●", tone: "blue" },
  { href: "/relations", label: "Relations", glyph: "➜", tone: "green" },
  { href: "/reports", label: "Reports", glyph: "★", tone: "orange" },
  { href: "/export", label: "Export", glyph: "⚲", tone: "purple" }
];

function isRouteActive(pathname: string, href: string) {
  if (href === "/projects") {
    return pathname === "/projects";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(new Date());
    }, 30000);

    return () => window.clearInterval(timer);
  }, []);

  const timeDisplay = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: false
      }).format(clock),
    [clock]
  );

  return (
    <>
      <div className="shell-bg" aria-hidden="true" />
      <main className="app-shell glass-shell">
        <header className="glass-header">
          <div className="glass-project-pill">
            <span className="glass-status-indicator" aria-hidden="true" />
            Workspace: Center Control
          </div>
          <time className="glass-time-display" dateTime={clock.toISOString()}>
            {timeDisplay}
          </time>
          <nav className="glass-nav-grid" aria-label="Primary">
            {navItems.map((item) => {
              const active = isRouteActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active ? "glass-nav-btn is-active" : "glass-nav-btn"}
                  aria-current={active ? "page" : undefined}
                >
                  <span className={`glass-nav-icon glass-icon-${item.tone}`} aria-hidden="true">
                    {item.glyph}
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <section className="page-content">{children}</section>
      </main>
    </>
  );
}
