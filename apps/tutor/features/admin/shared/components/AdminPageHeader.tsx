import type { ReactNode } from "react";

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

/** Shared header for every admin panel page: icon chip, title, and actions. */
export function AdminPageHeader({ title, description, icon, actions }: AdminPageHeaderProps) {
  return (
    <header className="glass rim-sky rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {icon ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/12 text-sky-400">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-[17px] font-medium tracking-[-0.015em] text-frost">{title}</h1>
            {description ? (
              <p className="type-accent-xs mt-1 truncate text-faint">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
