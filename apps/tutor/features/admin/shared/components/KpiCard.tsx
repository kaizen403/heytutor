import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

type KpiTone = "default" | "sky" | "danger";

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
}

const VALUE_CLASS: Record<KpiTone, string> = {
  default: "text-frost",
  sky: "text-foreground",
  danger: "text-danger",
};

export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
}: KpiCardProps) {
  return (
    <Card className="gap-0 rounded-lg py-0 shadow-none">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-2 text-2xl font-semibold tracking-tight tabular-nums",
            VALUE_CLASS[tone],
          )}
        >
          {value}
        </p>
        {hint ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
