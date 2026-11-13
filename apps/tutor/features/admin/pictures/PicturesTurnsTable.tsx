import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import Link from "next/link";
import type { PictureTurnRow } from "@/lib/admin/pictures";
import { cn } from "@/lib/utils";
import { OutcomePill } from "../shared/components/OutcomePill";
import { formatRelativeTime, truncateText } from "../shared/lib/format";
import {
  codeLabel,
  msLabel,
  PICTURE_STATUS_STYLE,
  subjectLabel,
} from "./pictureLabels";

const CELL = "px-3 py-2 align-top";
const HEAD = "px-4 text-left text-xs font-medium text-muted-foreground";

function PictureCell({ turn }: { turn: PictureTurnRow }) {
  const outcome = turn.picture;
  if (!outcome)
    return (
      <span className="type-accent-xs text-faint">unreadable outcome</span>
    );
  const style = PICTURE_STATUS_STYLE[outcome.status];
  return (
    <div className="space-y-0.5">
      <span
        className={cn(
          "type-accent-xs inline-flex items-center rounded-full border px-2 py-0.5",
          style.className,
        )}
      >
        {style.label}
      </span>
      <p className="type-accent-xs text-faint">
        {outcome.reason ? `${codeLabel(outcome.reason)} · ` : ""}
        {msLabel(outcome.ms)}
        {outcome.speculative ? " · early" : ""}
      </p>
    </div>
  );
}

function ShownCell({ turn }: { turn: PictureTurnRow }) {
  if (!turn.shown) {
    return (
      <span className="type-accent-xs text-faint">
        {turn.picture?.status === "shown" ? "not saved by the server" : "none"}
      </span>
    );
  }
  return (
    <div className="flex items-start gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- immutable same origin asset; next/image would proxy it for nothing */}
      <img
        src={turn.shown.thumbUrl}
        alt=""
        loading="lazy"
        width={48}
        height={36}
        className="h-9 w-12 shrink-0 rounded border border-stroke bg-white object-contain"
      />
      <div className="min-w-0">
        <p
          className="type-accent-xs max-w-[12rem] truncate text-frost"
          title={turn.shown.title}
        >
          {turn.shown.title}
        </p>
        <p className="type-accent-xs max-w-[12rem] truncate text-faint">
          {turn.shown.license} · {turn.shown.source}
        </p>
      </div>
    </div>
  );
}

/** Newest lessons with a picture outcome. The user link is the closest per turn detail the panel has. */
export function PicturesTurnsTable({ turns }: { turns: PictureTurnRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table className="caption-top w-full min-w-[60rem] border-collapse">
        <TableCaption className="px-3 py-3 text-left text-sm font-medium text-frost">
          Recent lessons with a picture outcome
        </TableCaption>
        <TableHeader>
          <TableRow className="border-b border-stroke">
            <TableHead className={HEAD}>When</TableHead>
            <TableHead className={HEAD}>Question</TableHead>
            <TableHead className={HEAD}>Engine</TableHead>
            <TableHead className={HEAD}>Picture</TableHead>
            <TableHead className={HEAD}>Shown picture</TableHead>
            <TableHead className={HEAD}>User</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {turns.map((turn) => (
            <TableRow
              key={turn.turnId}
              className="border-b border-stroke/60 transition-colors last:border-b-0 hover:bg-white/[0.03]"
            >
              <TableCell className={CELL}>
                <p
                  className="type-accent-xs whitespace-nowrap text-soft"
                  title={turn.createdAt}
                >
                  {formatRelativeTime(turn.createdAt)}
                </p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  {subjectLabel(turn.subject)}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <p
                  className="max-w-[20rem] truncate text-xs text-frost"
                  title={turn.question}
                >
                  {truncateText(turn.question, 90)}
                </p>
                <p className="type-accent-xs mt-0.5 text-faint">
                  figure {turn.engine.requirement}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <OutcomePill outcome={turn.engine.outcome} />
                <p className="type-accent-xs mt-0.5 text-faint">
                  {turn.engine.figureSource
                    ? codeLabel(turn.engine.figureSource)
                    : "source unrecorded"}
                  {turn.engine.degradationReason
                    ? ` · ${codeLabel(turn.engine.degradationReason)}`
                    : ""}
                </p>
              </TableCell>
              <TableCell className={CELL}>
                <PictureCell turn={turn} />
              </TableCell>
              <TableCell className={CELL}>
                <ShownCell turn={turn} />
              </TableCell>
              <TableCell className={CELL}>
                <Link
                  href={`/admin/users/${encodeURIComponent(turn.userId)}`}
                  className="type-accent-xs block max-w-[10rem] truncate text-soft transition-colors hover:text-frost"
                >
                  {turn.userLabel}
                </Link>
                <p
                  className="type-accent-xs mt-0.5 font-mono text-faint"
                  title={turn.turnId}
                >
                  {turn.turnId.slice(0, 8)}
                </p>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
