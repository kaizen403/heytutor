"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBoard, fetchBoards } from "@/lib/boardsClient";

export default function Home() {
  const router = useRouter();
  const redirectStartedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (redirectStartedRef.current) return;
    redirectStartedRef.current = true;

    void (async () => {
      const question = new URLSearchParams(window.location.search).get("q")?.trim();

      const boards = await fetchBoards();
      const unused = boards.find((b) => b.title === "new board" && !b.preview);
      const board = unused ?? (await createBoard());

      if (!board) {
        setError("could not connect to the database — try running pnpm dev:tutor again");
        return;
      }

      const path = `/c/${board.id}${question ? `?q=${encodeURIComponent(question)}` : ""}`;
      router.replace(path);
    })();
  }, [router]);

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#EAEAEA",
          color: "#333333",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: "24rem", textAlign: "center" }}>
          <p style={{ marginBottom: "0.75rem", fontSize: "0.95rem" }}>{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "9999px",
              border: "1px solid rgba(0, 119, 204, 0.3)",
              background: "rgba(0, 119, 204, 0.1)",
              color: "#0077CC",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            retry
          </button>
        </div>
      </div>
    );
  }

  return null;
}
