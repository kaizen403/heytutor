import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const runtime = "edge";
export const alt = `${SITE_NAME} | ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share card is the landing page's hero at 1200x630: the Night Blueprint
 * navy with the sky aurora sitting over its top edge, frost type, and the
 * accent reserved for the tagline. Satori has no CSS variables, so the palette
 * is written out — these are `--ink-*` / `--sky-*` / `--frost` from globals.css.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(160deg, #0D2231 0%, #0A1B27 55%, #06121C 100%)",
          color: "#F0F5F7",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* The aurora — the same sky wash that opens the landing page. */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: 180,
            width: 900,
            height: 600,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(89,175,212,0.34) 0%, rgba(89,175,212,0) 68%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#59AFD4",
              border: "1px solid #1D5F80",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 42,
              fontWeight: 700,
              color: "#06121C",
            }}
          >
            A
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.03em" }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
          <div style={{ fontSize: 52, fontWeight: 600, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
            Learn math the way teachers actually teach it.
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.45, color: "#ABC9D5" }}>{SITE_DESCRIPTION}</div>
        </div>

        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: "#59AFD4",
          }}
        >
          {SITE_TAGLINE}
        </div>
      </div>
    ),
    size,
  );
}
