"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DIAGRAM_ZONE, measureTextWidth, type VerifiedDiagram } from "@heytutor/drawing";
import { lookupLabel, type LabelFact, type LabelGlossary } from "@/features/tutor-session/lib/labelGlossary";

/**
 * Makes the symbols on a finished figure answerable.
 *
 * The board writes `R_1` because a full phrase would bury the geometry — this
 * lets a student point at the symbol and get "Resistor 1 · 12 Ω" back. Hit
 * targets are read from the compiled LABEL commands, which is where the pen
 * actually wrote — diagram-zone text is never relocated at draw time.
 *
 * Rendered as HTML above the canvas: the popover gets real typography and a
 * compositor-driven transition, and the Konva layers stay non-interactive.
 */

export interface DiagramLabelInspectorProps {
  /**
   * The compiled diagram. Its LABEL commands are the authority on where a
   * label sits: `resolveTextPlacement` returns diagram-zone text unchanged, so
   * these coordinates are exactly where the pen wrote.
   */
  diagram: VerifiedDiagram;
  glossary: LabelGlossary;
  /** Board pixels → rendered pixels, when the canvas is scaled to fit. */
  scale: number;
  /** Suppressed while the tutor is still drawing. */
  enabled: boolean;
}

interface HotspotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Hotspot {
  key: string;
  rect: HotspotRect;
  fact: LabelFact;
}

const DEFAULT_LABEL_FONT_PX = 24;

const PAD_X = 4;
const PAD_Y = 3;

export function DiagramLabelInspector({
  diagram,
  glossary,
  scale,
  enabled,
}: DiagramLabelInspectorProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hotspots = useMemo<Hotspot[]>(() => {
    if (!enabled) return [];
    const seen = new Set<string>();
    const found: Hotspot[] = [];
    for (const command of diagram.commands) {
      if (command.type !== "LABEL" || !command.text) continue;
      const [x, y, maybeFont] = command.params;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      // Diagram labels only — the work column is prose, not symbols.
      if (x! < DIAGRAM_ZONE.x) continue;
      const fact = lookupLabel(glossary, command.text);
      if (!fact) continue;
      const key = `${command.text}:${Math.round(x!)}:${Math.round(y!)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fontSize = typeof maybeFont === "number" && maybeFont >= 12 && maybeFont <= 40
        ? maybeFont
        : DEFAULT_LABEL_FONT_PX;
      found.push({
        key,
        fact,
        rect: {
          x: x!,
          y: y!,
          width: Math.max(measureTextWidth(command.text, fontSize), 14),
          height: fontSize * 1.25,
        },
      });
    }
    return found;
  }, [diagram, glossary, enabled]);

  // A pinned card closes on Escape or on any click that misses a label.
  useEffect(() => {
    if (!pinned) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
        setActiveKey(null);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setPinned(false);
        setActiveKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [pinned]);

  const activate = useCallback((key: string) => {
    setActiveKey((current) => (current === key ? current : key));
  }, []);

  if (hotspots.length === 0) return null;
  // Derived, not stored: a label that is erased or replaced by the next turn
  // simply stops matching, so no effect is needed to tidy up after it.
  const active = hotspots.find((spot) => spot.key === activeKey) ?? null;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
      style={{ zIndex: 6 }}
      data-testid="diagram-label-inspector"
    >
      {hotspots.map((spot) => {
        const isActive = spot.key === activeKey;
        return (
          <button
            key={spot.key}
            type="button"
            aria-label={`${spot.fact.title}${spot.fact.value ? `, ${spot.fact.value}` : ""}`}
            className="pointer-events-auto absolute cursor-help rounded-[5px] border-0 bg-transparent p-0 transition-[background-color,box-shadow] duration-150 ease-out focus:outline-none"
            style={{
              left: (spot.rect.x - PAD_X) * scale,
              top: (spot.rect.y - PAD_Y) * scale,
              width: (spot.rect.width + PAD_X * 2) * scale,
              height: (spot.rect.height + PAD_Y * 2) * scale,
              backgroundColor: isActive ? "rgba(255, 216, 77, 0.28)" : "transparent",
              boxShadow: isActive ? "inset 0 0 0 1px rgba(180, 140, 20, 0.45)" : "none",
            }}
            onMouseEnter={() => !pinned && activate(spot.key)}
            onMouseLeave={() => !pinned && setActiveKey(null)}
            onFocus={() => activate(spot.key)}
            onClick={(event) => {
              event.stopPropagation();
              if (pinned && activeKey === spot.key) {
                setPinned(false);
                setActiveKey(null);
                return;
              }
              setActiveKey(spot.key);
              setPinned(true);
            }}
          />
        );
      })}

      {active ? <LabelCard spot={active} scale={scale} pinned={pinned} /> : null}
    </div>
  );
}

function LabelCard({ spot, scale, pinned }: { spot: Hotspot; scale: number; pinned: boolean }) {
  const { rect, fact } = spot;
  const anchorX = (rect.x + rect.width / 2) * scale;
  const anchorTop = rect.y * scale;
  const anchorBottom = (rect.y + rect.height) * scale;
  // Sit above the label unless that would leave the board.
  const above = anchorTop > 96;

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute"
      style={{
        left: anchorX,
        top: above ? anchorTop - 10 : anchorBottom + 10,
        transform: `translate(-50%, ${above ? "-100%" : "0"})`,
        animation: "htLabelCardIn 140ms cubic-bezier(0.16, 0.84, 0.44, 1) both",
      }}
    >
      <div
        className="max-w-[260px] rounded-xl px-3 py-2 shadow-lg backdrop-blur-sm"
        style={{
          background: "rgba(24, 24, 27, 0.94)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        <div className="flex items-baseline gap-2">
          <span
            className="font-mono text-[13px] leading-none"
            style={{ color: "#FFD84D" }}
          >
            {fact.symbol}
          </span>
          <span className="text-[13px] leading-tight" style={{ color: "#F2F2F4" }}>
            {fact.title}
          </span>
        </div>

        {fact.value ? (
          <div className="mt-1.5 text-[15px] font-medium leading-none" style={{ color: "#FFFFFF" }}>
            {fact.value}
            {fact.provenance ? (
              <span
                className="ml-2 align-middle text-[10px] uppercase tracking-wide"
                style={{ color: fact.provenance === "given" ? "#88BDA4" : "#A6A6AE" }}
              >
                {fact.provenance}
              </span>
            ) : null}
          </div>
        ) : null}

        {fact.detail ? (
          <div className="mt-1.5 text-[11px] leading-snug" style={{ color: "#A6A6AE" }}>
            {fact.detail}
          </div>
        ) : null}

        {!pinned ? (
          <div className="mt-1.5 text-[10px] leading-none" style={{ color: "#6B6B73" }}>
            click to keep open
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes htLabelCardIn {
          from { opacity: 0; transform: translate(-50%, ${above ? "calc(-100% + 4px)" : "-4px"}) scale(0.97); }
          to   { opacity: 1; transform: translate(-50%, ${above ? "-100%" : "0"}) scale(1); }
        }
      `}</style>
    </div>
  );
}
