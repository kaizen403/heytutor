import type { ReactNode } from "react";

export function AccountPageFrame({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 px-5 pb-3 pt-4 sm:px-8 md:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-frost sm:text-[1.75rem]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 max-w-xl text-sm text-[rgba(237,237,235,0.62)]">{subtitle}</p>
            ) : null}
          </div>
          {actions}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 sm:px-8">{children}</div>
    </div>
  );
}

export function AccountCard({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(23,23,22,0.72)] p-4 sm:p-5 ${className}`}
    >
      {title ? (
        <h2 className="mb-3 text-[0.8125rem] font-semibold tracking-[0.01em] text-frost">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}
