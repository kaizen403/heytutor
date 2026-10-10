/** Real AWS SDK and object metadata helpers against a localhost-only HTTP fixture. */
import assert from "node:assert/strict";
import { createServer } from "node:http";

const prefix = "lectures/fixture-board/fixture-turn/";
const key = `${prefix}0.mp3`;
type Mode =
  | "found"
  | "empty"
  | "missing"
  | "denied"
  | "invalid_head"
  | "fractional_head"
  | "network"
  | "list"
  | "escaped"
  | "invalid_list"
  | "no_token"
  | "repeated_token"
  | "endless"
  | "missing_completion";
let mode: Mode = "found";
const requests: Array<{ method: string; mode: Mode; token: string | null }> =
  [];
const xml = (
  objects: Array<{ key: string; bytes: number }>,
  truncated = false,
  token?: string,
) =>
  `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
  `<Name>storage-metadata-fixture</Name><Prefix>${prefix}</Prefix><MaxKeys>1000</MaxKeys>` +
  `<IsTruncated>${truncated}</IsTruncated>${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ""}` +
  objects
    .map(
      (object) =>
        `<Contents><Key>${object.key}</Key><Size>${object.bytes}</Size></Contents>`,
    )
    .join("") +
  "</ListBucketResult>";
const server = createServer((request, response) => {
  const url = new URL(request.url!, "http://127.0.0.1");
  const token = url.searchParams.get("continuation-token");
  requests.push({ method: request.method!, mode, token });
  assert.equal(
    request.headers.host?.split(":")[0],
    "127.0.0.1",
    "SDK requests must stay on the isolated loopback endpoint",
  );
  assert(
    ["HEAD", "GET"].includes(request.method!),
    "metadata gates must never write or delete an object",
  );
  if (mode === "network") {
    request.socket.destroy();
    return;
  }
  if (mode === "missing" || mode === "denied") {
    response.statusCode = mode === "missing" ? 404 : 403;
    response.end();
    return;
  }
  if (request.method === "HEAD") {
    assert.equal(
      decodeURIComponent(url.pathname),
      `/storage-metadata-fixture/${key}`,
    );
    response.setHeader(
      "content-length",
      mode === "empty"
        ? "0"
        : mode === "invalid_head"
          ? "9007199254740992"
          : mode === "fractional_head"
            ? "1.5"
            : "12345",
    );
    response.end();
    return;
  }
  assert.equal(url.searchParams.get("list-type"), "2");
  assert.equal(url.searchParams.get("prefix"), prefix);
  assert.equal(url.searchParams.get("max-keys"), "1000");
  response.setHeader("content-type", "application/xml");
  if (mode === "list")
    response.end(
      token
        ? xml([{ key: `${prefix}1.wav`, bytes: 77 }])
        : xml([{ key, bytes: 12345 }], true, "second-page"),
    );
  else if (mode === "escaped")
    response.end(xml([{ key: "lectures/another-board/0.mp3", bytes: 4 }]));
  else if (mode === "invalid_list") response.end(xml([{ key, bytes: 1.5 }]));
  else if (mode === "no_token") response.end(xml([], true));
  else if (mode === "repeated_token") response.end(xml([], true, "same-token"));
  else if (mode === "endless")
    response.end(xml([], true, `next-${requests.length}`));
  else if (mode === "missing_completion")
    response.end(xml([]).replace("<IsTruncated>false</IsTruncated>", ""));
  else response.end(xml([]));
});
const envKeys = [
  "S3_ENDPOINT",
  "S3_BUCKET",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_EC2_METADATA_DISABLED",
] as const;
const previousEnv = new Map(envKeys.map((name) => [name, process.env[name]]));
async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  Object.assign(process.env, {
    S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
    S3_BUCKET: "storage-metadata-fixture",
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "fixture-access-key",
    AWS_SECRET_ACCESS_KEY: "fixture-secret-key",
    AWS_EC2_METADATA_DISABLED: "true",
  });
  delete process.env.AWS_SESSION_TOKEN;
  // Import only after the isolated endpoint and synthetic credentials are set.
  const { headObjectSize, listObjectSizes } =
    await import("../../lib/object-store/s3");
  const checks: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => {
    await run();
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  try {
    await check(
      "real HEAD preserves exact ContentLength including zero",
      async () => {
        mode = "found";
        assert.deepEqual(await headObjectSize(key), {
          status: "found",
          bytes: 12345,
        });
        mode = "empty";
        assert.deepEqual(await headObjectSize(key), {
          status: "found",
          bytes: 0,
        });
      },
    );
    await check(
      "only confirmed HEAD404 is missing; HEAD403 is unknown",
      async () => {
        mode = "missing";
        assert.deepEqual(await headObjectSize(key), { status: "missing" });
        mode = "denied";
        await assert.rejects(headObjectSize(key), /could not be verified/);
      },
    );
    await check(
      "invalid unsafe and fractional HEAD lengths are rejected",
      async () => {
        for (const invalid of ["invalid_head", "fractional_head"] as const) {
          mode = invalid;
          await assert.rejects(headObjectSize(key), /could not be verified/);
        }
      },
    );
    await check("network failure never becomes missing or zero", async () => {
      mode = "network";
      await assert.rejects(headObjectSize(key), /could not be verified/);
    });
    await check(
      "real LIST preserves exact object sizes across continuation pages",
      async () => {
        mode = "list";
        const before = requests.length;
        assert.deepEqual(await listObjectSizes(prefix), [
          { key, bytes: 12345 },
          { key: `${prefix}1.wav`, bytes: 77 },
        ]);
        assert.deepEqual(
          requests.slice(before).map((r) => r.token),
          [null, "second-page"],
        );
      },
    );
    await check(
      "escaped keys and fractional LIST sizes are rejected",
      async () => {
        for (const invalid of ["escaped", "invalid_list"] as const) {
          mode = invalid;
          await assert.rejects(listObjectSizes(prefix), /invalid object/);
        }
      },
    );
    await check(
      "missing or repeated pagination tokens never prove an empty inventory",
      async () => {
        mode = "no_token";
        await assert.rejects(listObjectSizes(prefix), /pagination/);
        mode = "repeated_token";
        const before = requests.length;
        await assert.rejects(listObjectSizes(prefix), /pagination/);
        assert.equal(requests.length - before, 2);
      },
    );
    await check(
      "missing completion flag cannot prove a complete empty inventory",
      async () => {
        mode = "missing_completion";
        await assert.rejects(
          listObjectSizes(prefix),
          /pagination|completion|invalid/i,
        );
      },
    );
    await check(
      "LIST access and network failures never prove zero stored bytes",
      async () => {
        for (const failed of ["denied", "network"] as const) {
          mode = failed;
          await assert.rejects(listObjectSizes(prefix));
        }
      },
    );
    await check(
      "endless distinct pagination is capped at20 provider reads",
      async () => {
        mode = "endless";
        const before = requests.length;
        await assert.rejects(listObjectSizes(prefix), /page limit/);
        assert.equal(requests.length - before, 20);
      },
    );
    await check(
      "unowned scope and pre-aborted reads fail before provider contact",
      async () => {
        const before = requests.length;
        await assert.rejects(headObjectSize("lectures/../0.mp3"), /invalid/);
        await assert.rejects(listObjectSizes("lectures/"), /invalid/);
        await assert.rejects(
          headObjectSize(key, AbortSignal.abort()),
          /could not be verified/,
        );
        assert.equal(requests.length, before);
      },
    );
    console.log(
      `verify-storage-object-metadata: ${checks.length} actual SDK local HTTP groups passed; production and paid requests0`,
    );
  } finally {
    for (const [name, value] of previousEnv)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
void main().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
