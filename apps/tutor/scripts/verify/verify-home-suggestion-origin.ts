import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { hasAllowedMutationOrigin } from "../../lib/http/requestOrigin";

// Execute the actual POST route behind production's proxy: the server sees its
// internal address in request.url while the browser sends the public Origin.
// Only the spend actor is fake, and reaching it means the origin check passed.
const PUBLIC_ORIGIN = "https://app.accelute.co";
const INTERNAL_URLS = ["http://app.accelute.co:3000", "http://127.0.0.1:3000", "http://localhost:3000"];
const routePath = new URL("../../app/api/home-suggestions/route.ts", import.meta.url);
const source = readFileSync(routePath, "utf8");
process.env.AUTH_URL = PUBLIC_ORIGIN;

type Post = (request: Request) => Promise<Response>;
function compile(routeSource: string): { post: Post; actorCalls: () => number } {
  const javascript = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let calls = 0;
  const stubs: Record<string, unknown> = {
    "@/lib/http/requestOrigin": { hasAllowedMutationOrigin },
    "@/lib/billing/actor": {
      requireSpendActor: async () => { calls += 1; return new Response(null, { status: 401 }); },
      isSpendActor: () => false,
    },
  };
  const compiledModule = { exports: {} };
  const context = vm.createContext({
    module: compiledModule, exports: compiledModule.exports, URL, Response, Request, Headers, process,
    require: (id: string) => stubs[id] ?? {},
    fetch: () => { throw new Error("No network in the origin gate"); },
  });
  vm.runInContext(javascript, context, { filename: "home-suggestions-route.js" });
  return { post: (compiledModule.exports as { POST: Post }).POST, actorCalls: () => calls };
}

const passes: Array<[string, Record<string, string>]> = [
  ["the app's own page", { origin: PUBLIC_ORIGIN, "sec-fetch-site": "same-origin" }],
  ["the public origin without fetch metadata", { origin: PUBLIC_ORIGIN }],
  ["a same origin referer", { referer: `${PUBLIC_ORIGIN}/` }],
  ["a native client with no browser headers", {}],
];
const refused: Array<[string, Record<string, string>]> = [
  ["another site", { origin: "https://evil.example" }],
  ["a sibling subdomain", { origin: "https://dev.accelute.co" }],
  ["the plain http twin of the app", { origin: "http://app.accelute.co" }],
  ["the internal address as Origin", { origin: "http://app.accelute.co:3000" }],
  ["a sandboxed frame", { origin: "null" }],
  ["cross-site fetch metadata alone", { "sec-fetch-site": "cross-site" }],
  ["same-site fetch metadata alone", { "sec-fetch-site": "same-site" }],
  ["the public origin with cross-site metadata", { origin: PUBLIC_ORIGIN, "sec-fetch-site": "cross-site" }],
  ["a cross-site referer", { referer: "https://evil.example/page" }],
  ["an unreadable referer", { referer: "not a url" }],
];

async function failures(routeSource: string): Promise<string[]> {
  const found: string[] = [];
  for (const internal of INTERNAL_URLS) {
    for (const [name, headers] of passes) {
      const route = compile(routeSource);
      const response = await route.post(new Request(`${internal}/api/home-suggestions`, { method: "POST", headers }));
      if (response.status === 403 || route.actorCalls() !== 1) found.push(`refused ${name} at ${internal}`);
    }
    for (const [name, headers] of refused) {
      const route = compile(routeSource);
      const response = await route.post(new Request(`${internal}/api/home-suggestions`, { method: "POST", headers }));
      if (response.status !== 403 || route.actorCalls() !== 0) found.push(`admitted ${name} at ${internal}`);
    }
  }
  return found;
}

function mutate(from: string, to: string): string {
  assert(source.includes(from), `mutation anchor must exist: ${from}`);
  const mutated = source.replace(from, to);
  assert.notEqual(mutated, source, `mutation must change the route: ${from}`);
  return mutated;
}

/** A route handler must never judge a browser's Origin against the proxy's address. */
const REQUEST_URL_ORIGIN = /(?:new URL\(\s*(?:request|req)\.url\s*\)|nextUrl)\.origin/;
function routesComparingOriginToRequestUrl(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routesComparingOriginToRequestUrl(path);
    if (!/^route\.tsx?$/.test(entry.name)) return [];
    return REQUEST_URL_ORIGIN.test(readFileSync(path, "utf8")) ? [path] : [];
  });
}

async function main() {
  assert.deepEqual(await failures(source), [], "the route must admit its own site and refuse every other one");

  const oldCheck = mutate(
    "!hasAllowedMutationOrigin(request) ||",
    '(request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) ||',
  );
  const oldFailures = await failures(oldCheck);
  assert(oldFailures.includes(`refused the app's own page at ${INTERNAL_URLS[0]}`), "mutation: comparing with request.url must refuse the real page (the production 403)");
  assert(oldFailures.includes(`admitted the internal address as Origin at ${INTERNAL_URLS[0]}`), "mutation: comparing with request.url must admit the internal address");

  const noOriginCheck = await failures(mutate("!hasAllowedMutationOrigin(request) ||", "false ||"));
  assert(noOriginCheck.includes(`admitted another site at ${INTERNAL_URLS[0]}`), "mutation: dropping the origin check must admit another site");
  assert(!noOriginCheck.some((failure) => failure.includes("cross-site fetch metadata alone")), "the fetch metadata check still holds alone");

  const noMetadataCheck = await failures(mutate('request.headers.get("sec-fetch-site") === "cross-site"', "false"));
  assert(noMetadataCheck.includes(`admitted the public origin with cross-site metadata at ${INTERNAL_URLS[0]}`), "mutation: dropping the metadata check must admit a cross-site request");

  const apiDir = fileURLToPath(new URL("../../app/api", import.meta.url));
  assert.deepEqual(routesComparingOriginToRequestUrl(apiDir), [], "no route may derive its allowed origin from request.url");
  assert(REQUEST_URL_ORIGIN.test(oldCheck), "mutation: the source scan must catch the old check");

  console.log(`verify-home-suggestion-origin: ok (${passes.length} admitted and ${refused.length} refused over ${INTERNAL_URLS.length} internal addresses; 4 mutations red)`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
