/** CPU time a read takes, best of three, so a paused runner cannot fail a row. A large overrun stops early. */
export function cpuMs(read: () => void, limitMs: number): number {
  let best = Infinity;
  for (let attempt = 0; attempt < 3 && best > limitMs; attempt += 1) {
    const start = process.cpuUsage();
    read();
    const used = process.cpuUsage(start);
    best = Math.min(best, (used.user + used.system) / 1000);
    if (best > limitMs * 10) break;
  }
  return best;
}
