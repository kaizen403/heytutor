import dynamic from "next/dynamic";
import { reloadOnceForMissingChunk } from "@/lib/client/staleBuild";
import { BoardBootSpinner } from "./BoardBootSpinner";

export const Whiteboard = dynamic(
  () =>
    import("@heytutor/whiteboard")
      .then((mod) => mod.Whiteboard)
      .catch((error: unknown) => {
        // A deploy deletes the previous build's chunks: a tab opened before it
        // reloads once into the current build instead of loading forever.
        if (reloadOnceForMissingChunk(error)) return new Promise<never>(() => {});
        throw error;
      }),
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
