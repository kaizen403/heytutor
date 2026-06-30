import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const runtime = "edge";
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          background: "linear-gradient(145deg, #E3FEF7 0%, #77B0AA 55%, #135D66 100%)",
          color: "#003C43",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#E3FEF7",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 42,
              fontWeight: 700,
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
          <div style={{ fontSize: 28, lineHeight: 1.45, color: "#003C43", opacity: 0.88 }}>
            {SITE_DESCRIPTION}
          </div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, color: "#135D66" }}>{SITE_TAGLINE}</div>
      </div>
    ),
    size,
  );
}
