"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminSection {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: (pathname: string) => boolean;
}

const SECTIONS: AdminSection[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, active: (p) => p === "/admin" },
  {
    href: "/admin/playground",
    label: "Test Playground",
    icon: FlaskConical,
    active: (p) => p === "/admin/playground",
  },
  {
    href: "/admin/users",
    label: "Manage Users",
    icon: Users,
    active: (p) => p.startsWith("/admin/users"),
  },
  { href: "/admin/logs", label: "Logs", icon: ScrollText, active: (p) => p.startsWith("/admin/logs") },
  {
    href: "/admin/fails",
    label: "Fails",
    icon: TriangleAlert,
    active: (p) => p.startsWith("/admin/fails"),
  },
];

export function AdminNav() {
  const pathname = usePathname() ?? "";

  return (
    <header className="glass-deep sticky top-0 z-40 border-x-0 border-t-0">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5">
        <Link href="/admin" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/12 text-sky-400">
            <GraduationCap className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="text-sm font-medium tracking-[-0.01em] text-frost">HeyTutor Admin</span>
        </Link>
        <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Admin sections">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = section.active(pathname);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "type-accent-xs flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors",
                  active
                    ? "bg-sky-500/20 text-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "text-faint hover:bg-white/5 hover:text-frost",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {section.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
