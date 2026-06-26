"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBoard } from "@/lib/boardsClient";

export default function Home() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    const id = crypto.randomUUID();
    await createBoard(id);
    router.replace(`/c/${id}?q=${encodeURIComponent(trimmed)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#003C43",
        padding: "24px",
        gap: "32px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            color: "#E3FEF7",
            fontSize: "clamp(2.5rem, 6vw, 4rem)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: 0,
          }}
        >
          HeyTutor
        </h1>
        <p
          style={{
            color: "rgba(227, 254, 247, 0.7)",
            fontSize: "clamp(1rem, 2.5vw, 1.25rem)",
            margin: 0,
          }}
        >
          your AI whiteboard tutor
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          width: "100%",
          maxWidth: "640px",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          placeholder="What do you want to learn?"
          style={{
            flex: 1,
            padding: "16px 24px",
            fontSize: "1rem",
            color: "#E3FEF7",
            background: "rgba(19, 93, 102, 0.85)",
            border: "1px solid rgba(119, 176, 170, 0.2)",
            borderRadius: "999px",
            outline: "none",
            opacity: loading ? 0.6 : 1,
          }}
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !question.trim()}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "16px 28px",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#003C43",
            background: "#77B0AA",
            border: "none",
            borderRadius: "999px",
            cursor: loading || !question.trim() ? "not-allowed" : "pointer",
            opacity: loading || !question.trim() ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {loading ? (
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                border: "2px solid transparent",
                borderTopColor: "#003C43",
                borderBottomColor: "#003C43",
                animation: "wb-spin 0.8s linear infinite",
              }}
            />
          ) : (
            "Get Started"
          )}
        </button>
      </div>
    </div>
  );
}
