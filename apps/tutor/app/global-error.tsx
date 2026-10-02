"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#131312",
          color: "#EDEDEB",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: 360, padding: 24, textAlign: "center" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", color: "#A7A7A7", lineHeight: 1.5 }}>
            The board hit an error. You can try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#4A9EFF",
              color: "#131312",
              border: 0,
              borderRadius: 999,
              padding: "10px 16px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
