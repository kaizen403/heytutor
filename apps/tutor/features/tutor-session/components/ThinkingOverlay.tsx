export function ThinkingOverlay() {
  return (
    <div
      className="absolute inset-0 z-20 pointer-events-none"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(230,242,221,0.92) 100%)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden">
        <div className="wb-progress-bar" />
      </div>
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div
          className="h-10 w-10 rounded-full border-2 border-transparent"
          style={{
            borderTopColor: "#659287",
            borderBottomColor: "#659287",
            animation: "wb-spin 0.8s linear infinite",
          }}
        />
        <p style={{ fontSize: "0.9rem", color: "#659287", fontWeight: 500 }}>
          thinking about how to teach this…
        </p>
      </div>
    </div>
  );
}
