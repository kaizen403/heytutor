import dynamic from "next/dynamic";

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
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2px solid transparent",
            borderTopColor: "#2563EB",
            borderBottomColor: "#2563EB",
            animation: "wb-spin 0.8s linear infinite",
          }}
        />
      </div>
    ),
  },
);
