import dynamic from "next/dynamic";
import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";

export const Whiteboard = dynamic(
  () => import("@heytutor/whiteboard").then((mod) => mod.Whiteboard),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
        }}
      >
        {/* The board is light, so the pencil spins in its own board ink. */}
        <PenSpinner size={48} ink="#1B2A4A" label="Loading the board" />
      </div>
    ),
  },
);
