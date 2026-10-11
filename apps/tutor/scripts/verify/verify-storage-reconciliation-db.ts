import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

async function main() {
  const input = process.env.SECURITY_TEST_DATABASE_URL;
  assert(input, "an explicit disposable security database is required");
  const url = new URL(input);
  assert(["postgres:", "postgresql:"].includes(url.protocol) &&
    ["localhost", "127.0.0.1"].includes(url.hostname) && /^\/heytutor_security_[a-zA-Z0-9_]+$/.test(url.pathname),
  "the reconciliation dry-run gate may only use an explicitly named disposable loopback database");
  const database = new PrismaClient({ log: [], datasources: { db: { url: input } } });
  const userId = `reconcile-fixture-${randomUUID()}`, boardId = randomUUID(), turnId = randomUUID();
  const bucket = "storage-reconciliation-fixture";
  const firstKey = `lectures/${boardId}/${turnId}/0.mp3`;
  const heldKey = `lectures/${boardId}/${turnId}/1.mp3`;
  const orphanKey = `lectures/${boardId}/${turnId}/2.mp3`;
  const turnPrefix = `lectures/${boardId}/${turnId}/`;
  const expiredPrefix = `lectures/${boardId}/${turnId}/abcdefghijkl/`;
  const audioUrl = (key: string) => `/api/media?key=${encodeURIComponent(key)}`;
  let headRequests = 0, listRequests = 0, rejectedRequests = 0;
  const server = createServer((request, response) => {
    const target = new URL(request.url ?? "/", "http://127.0.0.1");
    const key = decodeURIComponent(target.pathname.slice(`/${bucket}/`.length));
    if (request.method === "HEAD" && target.pathname.startsWith(`/${bucket}/`) && [firstKey, heldKey].includes(key)) {
      headRequests++;
      response.writeHead(200, { "content-length": key === firstKey ? "1000" : "2000" });
      response.end();
      return;
    }
    const prefix = target.searchParams.get("prefix");
    if (request.method === "GET" && target.searchParams.get("list-type") === "2" && [turnPrefix, expiredPrefix].includes(prefix ?? "")) {
      listRequests++;
      const contents = prefix === turnPrefix ? [[firstKey, 1000], [heldKey, 2000], [orphanKey, 4000]].map(([objectKey, size]) =>
        `<Contents><Key>${objectKey}</Key><Size>${size}</Size></Contents>`).join("") : "";
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${prefix}</Prefix><KeyCount>${prefix === turnPrefix ? 3 : 0}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
      return;
    }
    rejectedRequests++;
    response.writeHead(403); response.end();
  });
  await new Promise<void>(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert(address && typeof address === "object");
  const sourceFingerprint = async () => {
    const [storage, turns, notes, jobs, boards] = await Promise.all([
      database.userStorage.findUnique({ where: { userId } }),
      database.turn.findMany({ where: { userId }, include: { segments: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
      database.boardChatMessage.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      database.objectDeletionJob.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      database.board.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    ]);
    return createHash("sha256").update(JSON.stringify({ storage, turns, notes, jobs, boards }, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value)).digest("hex");
  };
  try {
    await database.user.create({ data: { id: userId } });
    await database.board.create({ data: { id: boardId, userId } });
    await database.turn.create({ data: {
      id: turnId, boardId, userId, orderIndex: 0, question: "Synthetic storage fixture",
      rawResponse: "A retained fixture explanation", status: "stopped",
      submittedSegments: { v: 1, sceneSeq: 0, rows: [
        { orderIndex: 0, narration: "Held first clip", audioUrl: audioUrl(firstKey) },
        { orderIndex: 1, narration: "Held second clip", audioUrl: audioUrl(heldKey) },
      ] },
    } });
    await database.segment.createMany({ data: [0, 1].map(orderIndex => ({
      turnId, orderIndex, narration: "Two canonical rows share one clip", audioUrl: audioUrl(firstKey),
    })) });
    await database.boardChatMessage.create({ data: { boardId, userId, role: "user", content: "é漢", tag: { k: "✓" } } });
    const pendingBytes = 4096n, unrelatedImageBytes = 7000n;
    await database.objectDeletionJob.create({ data: {
      id: randomUUID(), userId, prefix: expiredPrefix, bytes: pendingBytes,
      createdAt: new Date(Date.now() - 31 * 60_000), nextAttemptAt: new Date(Date.now() - 60_000),
    } });
    await database.userStorage.create({ data: {
      userId, reservedBytes: 262144n + 2n * 8388608n + pendingBytes + unrelatedImageBytes,
    } });
    const beforeFingerprint = await sourceFingerprint();
    const script = resolve(import.meta.dirname, "../live/reconcile-storage.ts");
    const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveChild, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", script, "--user-id", userId], {
        env: {
          ...process.env, DATABASE_URL: input, NODE_ENV: "test",
          S3_BUCKET: bucket, R2_BUCKET: "", S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
          AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "synthetic-fixture", AWS_SECRET_ACCESS_KEY: "synthetic-fixture",
          AWS_SESSION_TOKEN: "", AWS_PROFILE: "", AWS_EC2_METADATA_DISABLED: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("local reconciliation dry run timed out")); }, 30_000);
      child.stdout.on("data", chunk => { stdout += String(chunk); });
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); resolveChild({ code, stdout, stderr }); });
    });
    assert.equal(output.code, 0, "the actual CLI must complete its default dry run");
    assert.equal(output.stderr, "", "the actual CLI must not print provider/database exceptions");
    const report = JSON.parse(output.stdout) as Record<string, unknown>;
    assert.equal(report.mode, "dry-run");
    assert.equal(report.accountsScanned, 1);
    assert.equal(report.accountsApplied, 0);
    assert.equal(report.accountsNeedingCorrection, 1);
    assert.equal(report.readOnlyTransactionsVerified, 2, "account enumeration and the storage snapshot are database-enforced READ ONLY");
    assert.equal(report.measuredAudioBytes, "7000", "canonical, held and physical unreferenced clips must all remain charged");
    assert.equal(report.orphanAudioBytes, "4000", "an unreferenced but stored clip is not free storage");
    assert.equal(report.orphanObjects, 1);
    assert.equal(report.notesToUpdate, 1);
    assert.equal(report.legacyNoteBytesToCharge, "16", "a zero-byte legacy note charges actual UTF-8 content and tag bytes");
    assert.equal(report.expiredEmptyJobsToRelease, 1);
    assert(BigInt(String(report.proposedReservedBytesAfter)) >= unrelatedImageBytes + 7000n + 16n,
      "unrepresented image residual survives audio correction");
    assert.equal(headRequests, 0, "complete owned inventory sizes do not need repeated HEADs");
    assert.equal(listRequests, 2, "one owned turn inventory and one expired empty attempt inventory are read");
    assert.equal(rejectedRequests, 0, "no object upload/deletion/foreign-key request is allowed");
    assert(![userId, boardId, turnId, firstKey, heldKey, orphanKey, "Synthetic storage fixture", "é漢"].some(value => output.stdout.includes(value)),
      "the real command must omit identities, object keys and stored content");
    const afterFingerprint = await sourceFingerprint();
    assert.equal(afterFingerprint, beforeFingerprint, "the complete fixture ledger/content/cleanup rows must be byte-identical after the dry run");
    console.log(JSON.stringify({
      boundary: "real reconciliation CLI dry-run", result: "pass", writeModeExecuted: false,
      readOnlyTransactionsVerified: report.readOnlyTransactionsVerified,
      beforeFingerprint, afterFingerprint, headRequests, listRequests, rejectedRequests,
      report,
    }));
  } finally {
    await database.objectDeletionJob.deleteMany({ where: { userId } });
    await database.user.deleteMany({ where: { id: userId } });
    await database.$disconnect();
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
