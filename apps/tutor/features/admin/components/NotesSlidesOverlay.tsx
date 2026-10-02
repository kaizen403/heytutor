"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SiteButton } from "@/components/ui/site-button";
import { Spinner } from "@/components/ui/spinner";
import { TutorSessionShell, type TutorSessionExportApi } from "@/features/tutor-session";
import { BOARD_HEIGHT, BOARD_WIDTH } from "@/features/tutor-session/constants";
import { exportNotesPdf } from "@/lib/client/exportNotesPdf";
import { cn } from "@/lib/utils";

interface NotesSlidesOverlayProps {
  boardId: string;
  title?: string;
  onClose: () => void;
}

const subscribeToCaptureHost = () => () => {};
const getCaptureHost = () => document.body;
const getServerCaptureHost = () => null;

/**
 * Saved lecture pages, as slides, with a download.
 *
 * The pages only exist as ink on a board, so a headless session restores
 * them long enough to photograph. That session is portaled off the left
 * edge of the window. A canvas parked inside this dialog paints over the
 * slides, which is the board the Notes button used to open.
 */
export function NotesSlidesOverlay({ boardId, title, onClose }: NotesSlidesOverlayProps) {
  const heading = title?.trim() || "Lecture notes";
  const [exportApi, setExportApi] = useState<TutorSessionExportApi | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [capturing, setCapturing] = useState(true);
  const [slides, setSlides] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const boardReady = exportApi?.boardReady === true;
  const hasSavedTurns = exportApi?.hasSavedTurns === true;
  const collectRef = useRef<TutorSessionExportApi["collectNotesSlides"] | null>(null);
  useLayoutEffect(() => {
    collectRef.current = exportApi?.collectNotesSlides ?? null;
  }, [exportApi]);

  useEffect(() => {
    if (!boardReady) {
      return undefined;
    }
    const collect = collectRef.current;
    if (!collect) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (!hasSavedTurns) {
          if (cancelled) return;
          setSlides([]);
          setCapturing(false);
          return;
        }
        const images = await collect();
        if (cancelled) return;
        setSlides(images);
        setCapturing(false);
      } catch (error) {
        console.error("Notes slides failed:", error);
        if (cancelled) return;
        setFailed(true);
        setCapturing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, boardReady, hasSavedTurns]);

  const captureHost = useSyncExternalStore(
    subscribeToCaptureHost,
    getCaptureHost,
    getServerCaptureHost,
  );

  const count = slides?.length ?? 0;
  const active = count === 0 ? 0 : Math.min(index, count - 1);
  const slide = count > 0 ? slides?.[active] : undefined;
  const preparing = capturing && !failed && slides === null;

  const retry = () => {
    setExportApi(null);
    setSlides(null);
    setFailed(false);
    setDownloadError(null);
    setIndex(0);
    setCapturing(true);
    setAttempt((current) => current + 1);
  };

  const download = () => {
    if (!slides || slides.length === 0 || downloading) {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    void (async () => {
      try {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => window.setTimeout(resolve, 0));
        });
        await exportNotesPdf({
          title: heading,
          sections: [
            {
              question: "",
              images: slides,
              workLines: [],
              narration: "",
              planFacts: [],
              interrupted: false,
            },
          ],
        });
      } catch (error) {
        console.error("Notes PDF export failed:", error);
        setDownloadError("Could not download these slides.");
      } finally {
        setDownloading(false);
      }
    })();
  };

  const capture =
    capturing && captureHost
      ? createPortal(
          <div
            aria-hidden
            data-notes-capture=""
            style={{
              position: "fixed",
              left: -10000,
              top: 0,
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            <TutorSessionShell
              key={`${boardId}:${attempt}`}
              sessionId={boardId}
              variant="headless"
              muteAudio
              onExportApi={setExportApi}
            />
          </div>,
          captureHost,
        )
      : null;

  return (
    <>
      {capture}
      <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-ink-950/75" />
          <DialogPrimitive.Content
            data-notes-overlay=""
            className="site-theme fixed left-1/2 top-1/2 z-[81] flex h-[min(92dvh,860px)] w-[min(calc(100vw-2rem),1040px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-stroke bg-ink-900 text-frost shadow-[0_24px_60px_-24px_rgba(3,11,18,0.8)] outline-none"
            onKeyDown={(event) => {
              if (count < 2) return;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setIndex((current) => Math.max(0, Math.min(current, count - 1) - 1));
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setIndex((current) => Math.min(count - 1, Math.min(current, count - 1) + 1));
              }
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stroke px-3 py-2 sm:px-4 sm:py-3">
              <DialogTitle className="min-w-0 truncate pr-0 text-sm font-medium tracking-normal text-frost">
                {heading}
              </DialogTitle>
              <div className="flex shrink-0 items-center gap-2">
                <SiteButton
                  variant="ice"
                  size="sm"
                  onClick={download}
                  disabled={preparing || failed || count === 0 || downloading}
                >
                  {downloading ? (
                    <Spinner size={14} className="text-ink-950" />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {downloading ? "Downloading…" : "Download"}
                </SiteButton>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close notes"
                  className="btn-plain btn-ghost h-9 w-9 shrink-0 rounded-lg px-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <DialogDescription className="sr-only">
              Slides from this lecture. Download saves them as a PDF.
            </DialogDescription>

            <div className="relative min-h-0 flex-1 bg-ink-950">
              {preparing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-soft" role="status">
                  <Spinner size={22} className="text-sky-400" />
                  <p className="text-sm">Preparing slides…</p>
                </div>
              ) : null}
              {failed ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-frost">Could not load these slides.</p>
                  <SiteButton variant="ghost" size="sm" onClick={retry}>
                    Try again
                  </SiteButton>
                </div>
              ) : null}
              {!preparing && !failed && count === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center px-6">
                  <p className="text-sm text-soft">This lecture has no slides.</p>
                </div>
              ) : null}
              {slide ? (
                <img
                  src={slide}
                  alt={`Slide ${active + 1} of ${count}`}
                  draggable={false}
                  className="absolute inset-0 m-auto max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] object-contain shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
                />
              ) : null}
            </div>

            {downloadError ? (
              <p className="shrink-0 px-4 pt-2 text-center text-xs text-danger" role="status">
                {downloadError}
              </p>
            ) : null}

            {count > 1 ? (
              <div className="flex shrink-0 flex-col gap-2 border-t border-stroke px-3 py-2 sm:px-4">
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIndex((current) => Math.max(0, Math.min(current, count - 1) - 1))}
                    disabled={active === 0}
                    aria-label="Previous slide"
                    className="btn-plain btn-ghost h-9 w-9 rounded-full px-0 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <p className="type-accent-xs min-w-12 text-center text-soft">
                    {active + 1} / {count}
                  </p>
                  <button
                    type="button"
                    onClick={() => setIndex((current) => Math.min(count - 1, Math.min(current, count - 1) + 1))}
                    disabled={active === count - 1}
                    aria-label="Next slide"
                    className="btn-plain btn-ghost h-9 w-9 rounded-full px-0 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {slides?.map((image, slideIndex) => (
                    <button
                      key={slideIndex}
                      type="button"
                      onClick={() => setIndex(slideIndex)}
                      aria-label={`Show slide ${slideIndex + 1}`}
                      aria-current={slideIndex === active ? "true" : undefined}
                      className={cn(
                        "h-14 w-[4.5rem] shrink-0 overflow-hidden rounded border",
                        slideIndex === active
                          ? "border-sky-400"
                          : "border-stroke opacity-70 hover:opacity-100",
                      )}
                    >
                      <img
                        src={image}
                        alt=""
                        draggable={false}
                        className="h-full w-full object-cover object-left-top"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
