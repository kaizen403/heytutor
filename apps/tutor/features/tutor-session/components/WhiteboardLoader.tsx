import dynamic from "next/dynamic";
import { BoardBootSpinner } from "./BoardBootSpinner";

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
        {/* The board is off while its chunk loads: the sky boot arc, not the
            pen — the tutor is not about to write yet. */}
        <BoardBootSpinner label="Loading the board" />
      </div>
    ),
  },
);
