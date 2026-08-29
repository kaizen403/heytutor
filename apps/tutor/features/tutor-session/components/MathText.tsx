import { Fragment, type CSSProperties } from "react";
import { parseMathText } from "@/features/tutor-session/lib/mathText";

/**
 * Show the board's notation the way the board writes it.
 *
 * Narration and notes carry the pen's source form (`R_1`, `v^2`); rendering
 * that verbatim leaks markup at the reader. This sets the scripts properly and
 * puts the symbol in the same handwriting the whiteboard uses, so a formula in
 * the transcript and the same formula on the board read as one thing.
 */

export interface MathTextProps {
  children: string;
  /** Set symbols in the board's handwriting. */
  handwritten?: boolean;
  className?: string;
  style?: CSSProperties;
}

const HANDWRITING_STACK = '"Caveat", "Segoe Script", cursive';

export function MathText({ children, handwritten = true, className, style }: MathTextProps) {
  const runs = parseMathText(children ?? "");

  // Nothing to set — render the string as-is so plain prose stays plain.
  if (runs.every((run) => run.kind === "text")) {
    return (
      <span className={className} style={style}>
        {children}
      </span>
    );
  }

  const scriptStyle: CSSProperties = {
    fontSize: "0.72em",
    lineHeight: 0,
    // Keep the baseline steady: browsers shift line boxes for sub/sup.
    position: "relative",
  };

  return (
    <span
      className={className}
      style={{
        ...(handwritten ? { fontFamily: HANDWRITING_STACK, fontSize: "1.08em" } : null),
        ...style,
      }}
    >
      {runs.map((run, index) => {
        if (run.kind === "text") return <Fragment key={index}>{run.value}</Fragment>;
        if (run.kind === "sub") {
          return (
            <sub key={index} style={{ ...scriptStyle, bottom: "-0.18em" }}>
              {run.value}
            </sub>
          );
        }
        return (
          <sup key={index} style={{ ...scriptStyle, top: "-0.42em" }}>
            {run.value}
          </sup>
        );
      })}
    </span>
  );
}
