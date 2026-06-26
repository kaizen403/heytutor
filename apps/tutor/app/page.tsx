"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBoard } from "@/lib/boardsClient";

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const id = crypto.randomUUID();
      await createBoard(id);
      router.replace(`/c/${id}`);
      queueMicrotask(() => setReady(true));
    })();
  }, [router]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#EAEAEA",
      }}
    >
      {!ready && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2px solid transparent",
            borderTopColor: "#0077CC",
            borderBottomColor: "#0077CC",
            animation: "wb-spin 0.8s linear infinite",
          }}
        />
      )}
    </div>
  );
}
