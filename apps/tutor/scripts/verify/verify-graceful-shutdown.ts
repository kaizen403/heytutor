/**
 * Production, 24 Oct 2026: a deploy restart (12:57:42 UTC) cut a lesson between
 * its turn plan and its teaching request, and the lesson taught nothing. The
 * server had no SIGTERM handler, so every restart cut every lesson in flight.
 *
 * The fixture runs under tsx in its own process group, as the service does,
 * and SIGTERM goes to the whole group, as systemd signals the whole unit.
 * Rows: a new connection made while a stream is still draining is refused; the
 * stream started before the signal completes and the process then exits 0; a
 * hung stream cannot hold the exit past the cap; a server busy at the signal
 * drains under the unit's `node --import tsx`; the Sentry flush runs before
 * exit and a stuck flush is capped.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { settleThenFlush } from "../../lib/http/gracefulShutdown";

const fixture = resolve(__dirname, "fixtures/gracefulShutdownServer.ts");
const tsx = resolve(__dirname, "../../node_modules/.bin/tsx");

// The production unit runs `node --import tsx server.ts`: no tsx relay parent.
function start(env: Record<string, string>, runner: "node-import" | "tsx-cli" = "node-import"): Promise<{ child: ChildProcess; port: number; stderr: () => string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }> }> {
  const [command, args] = runner === "tsx-cli" ? [tsx, [fixture]] : [process.execPath, ["--import", "tsx", fixture]];
  const child = spawn(command, args, { detached: true, cwd: resolve(__dirname, "../.."), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  // Resolve on "close", once stdout and stderr have been read to the end, but
  // keep the time of "exit" for the timing checks.
  let exitedAt = 0;
  child.once("exit", () => { exitedAt = Date.now(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>((done) =>
    child.once("close", (code, signal) => done({ code, signal, at: exitedAt || Date.now() })));
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("fixture did not start")), 30_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      const match = /PORT (\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        done({ child, port: Number(match[1]), stderr: () => stderr, exited });
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

  // 3. A server busy at the signal still drains under `node --import tsx`.
  //    Under the tsx CLI its relay parent SIGKILLs a child that has not
  //    reported the signal within about 60 ms, so the same stream is cut.
  for (const runner of ["node-import", "tsx-cli"] as const) {
    const { child, port, exited } = await start({ STREAM_MS: "800", CAP_MS: "20000", BUSY_MS: "250" }, runner);
    const streamed = get(port, "/stream", () => signalGroup(child));
    const result = await within(streamed, 15_000, `the busy ${runner} stream`, child);
    const exit = await within(exited, 15_000, `the busy ${runner} exit`, child);
    if (runner === "node-import") {
      assert(result.complete && result.body === "first|last", "a server busy at SIGTERM still finishes its stream under node --import tsx");
      assert.equal(exit.code, 0, `the busy node --import tsx process exits 0 (code ${exit.code}, signal ${exit.signal})`);
    } else {
      assert(!result.complete, "under the tsx CLI a busy server is killed at the signal; if this changes, revisit the unit");
    }
  }

  // 4. The Sentry flush waits for the requests already running: it starts
  //    after the stream ends and the drain closes, and completes before exit.
  {
    const { child, port, exited, stderr } = await start({ FLUSH_MS: "300", STREAM_MS: "800", CAP_MS: "20000" });
    const streamed = get(port, "/stream", () => signalGroup(child));
    const result = await within(streamed, 10_000, "the stream before the flush", child);
    assert(result.complete && result.body === "first|last", "the stream in flight finishes before the flush");
    const exit = await within(exited, 10_000, "the flushed exit", child);
    assert.equal(exit.code, 0, `the flushed process exits 0 (code ${exit.code}, signal ${exit.signal})`);
    const log = stderr();
    const order = ["STREAM END", "[shutdown] drained", "FLUSH START", "FLUSHED"].map((mark) => log.indexOf(mark));
    assert(order.every((at) => at >= 0) && order.every((at, k) => k === 0 || at > order[k - 1]!),
      `the flush starts after the stream ends and the drain closes, and completes before exit: ${JSON.stringify(log)}`);
  }
  //    At the drain cap the flush still runs, after the cap.
  {
    const { child, port, exited, stderr } = await start({ FLUSH_MS: "300", CAP_MS: "1000" });
    void get(port, "/hang", () => signalGroup(child)).catch(() => undefined);
    const exit = await within(exited, 10_000, "the capped then flushed exit", child);
    assert.equal(exit.code, 0, `the capped process exits 0 after its flush (code ${exit.code}, signal ${exit.signal})`);
    const log = stderr();
    const order = ["[shutdown] cap", "FLUSH START", "FLUSHED"].map((mark) => log.indexOf(mark));
    assert(order.every((at) => at >= 0) && order[1]! > order[0]! && order[2]! > order[1]!,
      `at the cap the flush runs after the cap and completes: ${JSON.stringify(log)}`);
  }
  //    A stuck flush cannot hold the exit past its own cap.
  {
    const flushCapMs = 700;
    const { child, exited, stderr } = await start({ FLUSH_MS: "hang", FLUSH_CAP_MS: String(flushCapMs) });
    const signalledAt = Date.now();
    signalGroup(child);
    const exit = await within(exited, 10_000, "the capped flush exit", child);
    const waited = exit.at - signalledAt;
    assert.equal(exit.code, 0, `a stuck flush still exits 0 (code ${exit.code}, signal ${exit.signal})`);
    assert(stderr().includes("FLUSH START") && !stderr().includes("FLUSHED"), "the stuck flush started and never completed");
    assert(waited >= flushCapMs - 100 && waited < flushCapMs + 2_500, `a stuck flush holds the exit only until its cap (${waited} ms)`);
  }

  // 5. The drain also waits for speech still being synthesised, and a sentence
  //    that never finishes cannot hold the exit past the cap.
  {
    const { child, exited, stderr } = await start({ SPEECH_MS: "700", CAP_MS: "20000" });
    const signalledAt = Date.now();
    signalGroup(child);
    const exit = await within(exited, 10_000, "the speech drained exit", child);
    const waited = exit.at - signalledAt;
    assert.equal(exit.code, 0, `the speech drained process exits 0 (code ${exit.code}, signal ${exit.signal})`);
    assert(stderr().includes("SPEECH DRAIN") && waited >= 600, `the exit waited for the sentence in flight (${waited} ms)`);
  }
  {
    const capMs = 1_000;
    const { child, exited, stderr } = await start({ SPEECH_MS: "hang", CAP_MS: String(capMs) });
    const signalledAt = Date.now();
    signalGroup(child);
    const exit = await within(exited, 10_000, "the speech capped exit", child);
    const waited = exit.at - signalledAt;
    assert.equal(exit.code, 0, `stuck speech still exits 0 (code ${exit.code}, signal ${exit.signal})`);
    assert(stderr().includes("[shutdown] cap") && waited >= capMs - 100 && waited < capMs + 3_000, `stuck speech holds the exit only until the cap (${waited} ms)`);
  }

  //    With a teaching stream still open at the signal, speech keeps flowing:
  //    the speech drain starts only after the stream ends, and the exit still
  //    waits for the sentence in flight.
  {
    const { child, port, exited, stderr } = await start({ SPEECH_MS: "500", STREAM_MS: "800", CAP_MS: "20000" });
    let signalledAt = 0;
    const streamed = get(port, "/stream", () => { signalledAt = Date.now(); signalGroup(child); });
    const result = await within(streamed, 10_000, "the stream before the speech drain", child);
    assert(result.complete, "the teaching stream finishes");
    const exit = await within(exited, 10_000, "the stream then speech drained exit", child);
    const log = stderr();
    assert(log.indexOf("STREAM END") >= 0 && log.indexOf("SPEECH DRAIN") > log.indexOf("STREAM END"),
      `the speech drain starts only after the teaching stream ends: ${JSON.stringify(log)}`);
    assert(exit.code === 0 && exit.at - signalledAt >= 1_200, `the exit waits for the stream and then the sentence (${exit.at - signalledAt} ms)`);
  }

  //    A settle that never finishes uses only its slice: the open count is
  //    logged, and the flush still runs with the time left in the cap.
  {
    const logged: string[] = [];
    let flushedWith = -1;
    const startedAt = Date.now();
    // A timer keeps the process alive: a settle that never yields must fail
    // this row, not end the process quietly with nothing left to run.
    let guard: ReturnType<typeof setTimeout> | undefined;
    const bounded = new Promise<never>((_, fail) => { guard = setTimeout(() => fail(new Error("the settle slice never handed over to the flush")), 3_000); });
    await Promise.race([bounded, settleThenFlush({
      settled: () => new Promise(() => undefined),
      open: () => 2,
      flush: async (timeoutMs) => { flushedWith = timeoutMs; },
      log: (line) => logged.push(line),
      sliceMs: 200,
      capMs: 600,
    })]).finally(() => clearTimeout(guard));
    assert(logged.includes("[shutdown] 2 speech settlement(s) still open at exit"), `the open settlements are logged: ${JSON.stringify(logged)}`);
    assert(flushedWith >= 300 && flushedWith <= 400 && Date.now() - startedAt < 450,
      `the flush runs with the rest of the cap after the settle slice (${flushedWith} ms)`);
  }

  // 6. The production unit has no tsx relay parent.
  for (const script of ["deploy/aws/deploy.sh", "deploy/aws/setup-vm.sh"]) {
    const unit = readFileSync(resolve(__dirname, "../../../..", script), "utf8");
    const execStart = unit.split("\n").find((line) => line.startsWith("ExecStart=")) ?? "";
    assert(/&& (?:[A-Z_]+=\S+ )*exec node --import tsx server\.ts'$/.test(execStart),
      `${script} must start the server with exec node --import tsx (got ${execStart})`);
  }

  console.log("verify-graceful-shutdown: an in-flight stream finishes before exit, new connections are refused, a hung stream is cut at the cap, and a busy server drains under the unit's node --import tsx, the Sentry flush runs before exit within its cap, and speech in flight finishes within the same cap");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
