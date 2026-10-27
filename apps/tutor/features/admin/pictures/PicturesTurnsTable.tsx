import Link from "next/link";
import type { PictureTurnRow } from "@/lib/admin/pictures";
import { cn } from "@/lib/utils";
import { OutcomePill } from "../shared/components/OutcomePill";
import { formatRelativeTime, truncateText } from "../shared/lib/format";
import { codeLabel, msLabel, PICTURE_STATUS_STYLE, subjectLabel } from "./pictureLabels";

const CELL = "px-3 py-2 align-top";
const HEAD = "type-accent-xs px-3 py-2 text-left text-faint";

function PictureCell({ turn }: { turn: PictureTurnRow }) {
  const outcome = turn.picture;
  if (!outcome) return <span className="type-accent-xs text-faint">unreadable outcome</span>;
  const style = PICTURE_STATUS_STYLE[outcome.status];
  return (
    <div className="space-y-0.5">
      <span className={cn("type-accent-xs inline-flex items-center rounded-full border px-2 py-0.5", style.className)}>{style.label}</span>
      <p className="type-accent-xs text-faint">
        {outcome.reason ? `${codeLabel(outcome.reason)} · ` : ""}{msLabel(outcome.ms)}{outcome.speculative ? " · early" : ""}
      </p>
    </div>
  );
}

function ShownCell({ turn }: { turn: PictureTurnRow }) {
  if (!turn.shown) {
    return <span className="type-accent-xs text-faint">{turn.picture?.status === "shown" ? "not saved by the server" : "none"}</span>;
  }
  return (
    <div className="flex items-start gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- immutable same origin asset; next/image would proxy it for nothing */}
      <img src={turn.shown.thumbUrl} alt="" loading="lazy" width={48} height={36}
        className="h-9 w-12 shrink-0 rounded border border-stroke bg-white object-contain" />
      <div className="min-w-0">
        <p className="type-accent-xs max-w-[12rem] truncate text-frost" title={turn.shown.title}>{turn.shown.title}</p>
        <p className="type-accent-xs max-w-[12rem] truncate text-faint">{turn.shown.license} · {turn.shown.source}</p>
      </div>
    </div>
  );
}

/** Newest lessons with a picture outcome. The user link is the closest per turn detail the panel has. */
export function PicturesTurnsTable({ turns }: { turns: PictureTurnRow[] }) {
  return (
    <div className="glass overflow-x-auto rounded-xl">
      <table className="w-full min-w-[60rem] border-collapse">
        <caption className="px-3 py-3 text-left text-sm font-medium text-frost">Recent lessons with a picture outcome</caption>
        <thead>
          <tr className="border-b border-stroke">
            <th className={HEAD}>When</th>
            <th className={HEAD}>Question</th>
            <th className={HEAD}>Engine</th>
            <th className={HEAD}>Picture</th>
            <th className={HEAD}>Shown picture</th>
            <th className={HEAD}>User</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => (
            <tr key={turn.turnId} className="border-b border-stroke/60 transition-colors last:border-b-0 hover:bg-white/[0.03]">
              <td className={CELL}>
                <p className="type-accent-xs whitespace-nowrap text-soft" title={turn.createdAt}>{formatRelativeTime(turn.createdAt)}</p>
                <p className="type-accent-xs mt-0.5 text-faint">{subjectLabel(turn.subject)}</p>
              </td>
              <td className={CELL}>
                <p className="max-w-[20rem] truncate text-xs text-frost" title={turn.question}>{truncateText(turn.question, 90)}</p>
                <p className="type-accent-xs mt-0.5 text-faint">figure {turn.engine.requirement}</p>
              </td>
              <td className={CELL}>
                <OutcomePill outcome={turn.engine.outcome} />
                <p className="type-accent-xs mt-0.5 text-faint">
                  {turn.engine.figureSource ? codeLabel(turn.engine.figureSource) : "source unrecorded"}
                  {turn.engine.degradationReason ? ` · ${codeLabel(turn.engine.degradationReason)}` : ""}
                </p>
              </td>
              <td className={CELL}><PictureCell turn={turn} /></td>
              <td className={CELL}><ShownCell turn={turn} /></td>
              <td className={CELL}>
                <Link href={`/admin/users/${encodeURIComponent(turn.userId)}`}
                  className="type-accent-xs block max-w-[10rem] truncate text-soft transition-colors hover:text-frost">
                  {turn.userLabel}
                </Link>
                <p className="type-accent-xs mt-0.5 font-mono text-faint" title={turn.turnId}>{turn.turnId.slice(0, 8)}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
