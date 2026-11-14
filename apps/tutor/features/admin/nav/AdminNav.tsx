"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartColumn,
  FlaskConical,
  Globe,
  ArrowUpRight,
  ChevronRight,
  Images,
  LayoutDashboard,
  ScrollText,
  Star,
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SITE_NAME } from "@/lib/site";

interface AdminSection {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: (pathname: string) => boolean;
}

const SECTIONS: AdminSection[] = [
  {
    href: "/admin",
    label: "Overview",
    icon: LayoutDashboard,
    active: (p) => p === "/admin",
  },
  {
    href: "/admin/playground",
    label: "Playground",
    icon: FlaskConical,
    active: (p) => p === "/admin/playground",
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: Users,
    active: (p) => p.startsWith("/admin/users"),
  },
  {
    href: "/admin/logs",
    label: "Logs",
    icon: ScrollText,
    active: (p) => p.startsWith("/admin/logs"),
  },
  {
    href: "/admin/fails",
    label: "Fails",
    icon: TriangleAlert,
    active: (p) => p.startsWith("/admin/fails"),
  },
  {
    href: "/admin/ratings",
    label: "Ratings",
    icon: Star,
    active: (p) => p.startsWith("/admin/ratings"),
  },
  {
    href: "/admin/community",
    label: "Community",
    icon: Globe,
    active: (p) => p.startsWith("/admin/community"),
  },
  {
    href: "/admin/coverage",
    label: "Coverage",
    icon: ChartColumn,
    active: (p) => p.startsWith("/admin/coverage"),
  },
  {
    href: "/admin/pictures",
    label: "Pictures",
    icon: Images,
    active: (p) => p.startsWith("/admin/pictures"),
  },
];

export function AdminNav() {
  const pathname = usePathname() ?? "";

  const currentSection = SECTIONS.find((section) => section.active(pathname));

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/admin"
            aria-label={`${SITE_NAME} admin home`}
            className="flex shrink-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Logo className="size-6" />
            <span className="text-base font-semibold tracking-tight">
              {SITE_NAME}
            </span>
          </Link>
          <span
            className="text-lg font-light text-muted-foreground/50"
            aria-hidden
          >
            /
          </span>
          <Badge
            variant="outline"
            className="rounded-md font-normal text-muted-foreground"
          >
            Admin
          </Badge>
          <ChevronRight
            className="hidden size-3.5 text-muted-foreground/50 sm:block"
            aria-hidden
          />
          <span className="hidden truncate text-sm text-muted-foreground sm:block">
            {currentSection?.label ?? "Overview"}
          </span>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link href="/">
            <span className="hidden sm:inline">Back to tutor</span>
            <span className="sm:hidden">Tutor</span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
      <nav
        className="mx-auto flex max-w-7xl items-center gap-4 overflow-x-auto px-4 sm:gap-6 sm:px-6 lg:px-10"
        aria-label="Admin sections"
      >
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = section.active(pathname);
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
              {section.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
