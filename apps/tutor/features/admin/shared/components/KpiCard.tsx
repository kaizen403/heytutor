import { cn } from "@/lib/utils";

type KpiTone = "default" | "sky" | "danger";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
}

const VALUE_CLASS: Record<KpiTone, string> = {
  default: "text-frost",
  sky: "text-sky-200",
  danger: "text-danger",
};

export function KpiCard({ label, value, hint, tone = "default" }: KpiCardProps) {
  return (
    <div className="glass rounded-xl px-3 py-2.5">
      <p className="type-accent-xs text-faint">{label}</p>
      <p
        className={cn(
          "mt-1 tabular-nums text-[15px] font-medium tracking-[-0.02em]",
          VALUE_CLASS[tone],
        )}
      >
        {value}
      </p>
      {hint ? <p className="type-accent-xs mt-0.5 text-faint">{hint}</p> : null}
    </div>
  );
}
