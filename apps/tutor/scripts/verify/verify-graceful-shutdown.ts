/**
 * Production, 24 Oct 2026: a deploy restart (12:57:42 UTC) cut a lesson between
 * its turn plan and its teaching request, and the lesson taught nothing. The
 * server had no SIGTERM handler, so every restart cut every lesson in flight.
 *
 * The fixture runs under tsx in its own process group, as the service does,
 * and SIGTERM goes to the whole group, as systemd signals the whole unit.
 * Rows: a new connection made while a stream is still draining is refused; the
 * stream started before the signal completes and the process then exits 0; a
 * hung stream cannot hold the exit past the cap.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { resolve } from "node:path";

const fixture = resolve(__dirname, "fixtures/gracefulShutdownServer.ts");
const tsx = resolve(__dirname, "../../node_modules/.bin/tsx");

function start(env: Record<string, string>): Promise<{ child: ChildProcess; port: number; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }> }> {
  const child = spawn(tsx, [fixture], { detached: true, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>((done) =>
    child.once("exit", (code, signal) => done({ code, signal, at: Date.now() })));
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("fixture did not start")), 30_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      const match = /PORT (\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        done({ child, port: Number(match[1]), exited });
      }
    });
  });
}

function get(port: number, path: string, onFirstByte?: () => void): Promise<{ body: string; complete: boolean }> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      let body = "";
      let notified = false;
      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
        if (!notified) {
          notified = true;
          onFirstByte?.();
        }
      });
      res.on("end", () => done({ body, complete: res.complete }));
      res.on("error", () => done({ body, complete: false }));
      res.on("aborted", () => done({ body, complete: false }));
    });
    req.on("error", fail);
    req.end();
  });
}

function within<T>(promise: Promise<T>, ms: number, what: string, child: ChildProcess): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, fail) => {
    timer = setTimeout(() => {
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
      fail(new Error(`${what} did not happen within ${ms} ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

function signalGroup(child: ChildProcess): void {
  process.kill(-child.pid!, "SIGTERM");
}

async function main() {
  // 1. During the drain a new connection is refused; the stream in flight at
  //    the signal completes, then the process exits 0.
  {
    const { child, port, exited } = await start({ STREAM_MS: "1500", CAP_MS: "20000" });
    let signalledAt = 0;
    const streamed = get(port, "/stream", () => {
      signalledAt = Date.now();
      signalGroup(child);
    });
    // While the stream is still open (it ends 1500 ms after its first byte),
    // the listening socket is already closed: a new connection is refused.
    let streamEnded = false;
    void streamed.then(() => { streamEnded = true; });
    while (signalledAt === 0) await pause(20);
    await pause(300);
    await assert.rejects(within(get(port, "/other"), 5_000, "the new connection probe", child),
      "a new connection during the drain must be refused");
    assert(!streamEnded, "the refusal was probed while the stream was still open");
    const result = await within(streamed, 15_000, "the stream", child);
    assert.equal(result.body, "first|last", "a stream started before SIGTERM must deliver its whole body");
    assert(result.complete, "the stream must end cleanly, not be cut");
    const exit = await within(exited, 15_000, "the drained exit", child);
    assert.equal(exit.code, 0, `the drained process exits 0 (code ${exit.code}, signal ${exit.signal})`);
    assert(exit.at - signalledAt >= 1_000, "the process waited for the stream instead of exiting at the signal");
  }

  // 2. A hung stream cannot hold the exit past the cap.
  {
    const capMs = 2_000;
    const { child, port, exited } = await start({ CAP_MS: String(capMs) });
    let signalledAt = 0;
    const hung = get(port, "/hang", () => {
      signalledAt = Date.now();
      signalGroup(child);
    });
    const exit = await within(exited, 15_000, "the capped exit", child);
    const waited = exit.at - signalledAt;
    assert.equal(exit.code, 0, `the capped process exits 0 (code ${exit.code}, signal ${exit.signal})`);
    assert(waited >= capMs - 200 && waited < capMs + 3_000, `a hung stream holds the exit only until the cap (${waited} ms)`);
    const result = await hung;
    assert(!result.complete, "the hung stream is cut at the cap");
  }

  console.log("verify-graceful-shutdown: an in-flight stream finishes before exit, new connections are refused, and a hung stream is cut at the cap");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
