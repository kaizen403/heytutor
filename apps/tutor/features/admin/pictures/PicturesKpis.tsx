import type { PicturesReport } from "@/lib/admin/pictures";
import { KpiCard } from "../shared/components/KpiCard";
import { msLabel, rateLabel } from "./pictureLabels";

const count = (value: number) => value.toLocaleString("en-US");

/** Headline tiles. Every share names its denominator; an empty period reads n/a, never 0%. */
export function PicturesKpis({ report }: { report: PicturesReport }) {
  const { totals, ms } = report;
  return (
    <section className="space-y-3" aria-label="Reference picture outcomes">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Saved lessons" value={count(totals.lessons)} />
        <KpiCard label="Engine drew" value={count(totals.engineDrew)} tone="sky" />
        <KpiCard label="Needed, engine did not draw" value={count(totals.needed)}
          hint={totals.unrecordedNeed > 0 ? `${count(totals.unrecordedNeed)} on picture evidence only` : "plan asked for a figure"} />
        <KpiCard label="Picture attempted" value={count(totals.attempted)}
          hint={`${count(totals.speculative)} started early`} />
        <KpiCard label="Not attempted" value={count(totals.notAttempted)} hint="flag off, or a code or DSA lesson" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Shown" value={count(totals.shown)} tone="sky" />
        <KpiCard label="Declined" value={count(totals.declined)} tone="danger" />
        <KpiCard label="Unavailable" value={count(totals.unavailable)} tone="danger" />
        <KpiCard label="Skipped" value={count(totals.skipped)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Shown rate" value={rateLabel(totals.shownRate)} tone="sky"
          hint={`of needed · ${rateLabel(totals.shownOfAttempted)} of attempted`} />
        <KpiCard label="Median time" value={msLabel(ms.attempted.medianMs)}
          hint={`${count(ms.attempted.count)} attempts · shown ${msLabel(ms.shown.medianMs)}`} />
        <KpiCard label="p90 time" value={msLabel(ms.attempted.p90Ms)} hint={`shown ${msLabel(ms.shown.p90Ms)}`} />
        <KpiCard label="Shown but not saved" value={count(totals.shownUnsaved)}
          tone={totals.shownUnsaved > 0 ? "danger" : "default"} hint="browser said shown, server kept no picture" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Abandoned after engine drew" value={count(totals.abandonedAfterDraw)}
          hint="an early request the verified figure replaced" />
        <KpiCard label="Outcome outside need" value={count(totals.outsideNeed)} hint="plan said no figure" />
      </div>
    </section>
  );
}
