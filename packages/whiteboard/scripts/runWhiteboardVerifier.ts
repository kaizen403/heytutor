export function runWhiteboardVerifier(main: () => Promise<void>): void {
  // A virtual rAF queue is not a Node event-loop handle. Keep a real, referenced
  // timer until every assertion finishes so an unresolved main cannot exit 0.
  const watchdog = setTimeout(() => {
    console.error("whiteboard verifier exceeded its 10s real-wall watchdog before completing assertions");
    process.exit(1);
  }, 10_000);
  void main().then(() => {
    clearTimeout(watchdog);
  }, (error: unknown) => {
    clearTimeout(watchdog);
    console.error(error);
    process.exitCode = 1;
  });
}
