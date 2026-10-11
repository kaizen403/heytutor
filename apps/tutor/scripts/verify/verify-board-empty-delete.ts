// @ts-expect-error esbuild ships with the tsx test runner, not the app package.
import { build } from "esbuild";
import { createRequire, Module } from "node:module";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Board = { id: string; userId: string; preview: string; turns: number; messages: number };
const boards = new Map<string, Board>();
let userId: string | null = "owner";
let injectBeforeLock: (() => void) | undefined;
let locked = false;
let deletes = 0;
const deletionJobs: string[] = [];

// Bundle the real route, substituting only authentication and database IO. The
// transaction fake models the board row lock and lets a turn arrive after an
// empty client inspection, before deletion begins.
(globalThis as { __boardDeleteTest?: unknown }).__boardDeleteTest = {
  get userId() { return userId; },
  prisma: {
    board: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
        const board = boards.get(where.id);
        return board?.userId === where.userId ? board : null;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        deletes++;
        boards.delete(where.id);
      },
    },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      injectBeforeLock?.();
      injectBeforeLock = undefined;
      return work({
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          assert(/FROM\s+"?boards"?.*FOR UPDATE/is.test(strings.join("?")), "conditional delete must lock the board row before checking emptiness");
          locked = true;
          const board = boards.get(values[0] as string);
          return board && board.userId === values[1] ? [{ id: board.id, preview: board.preview }] : [];
        },
        turn: {
          findFirst: async ({ where }: { where: { boardId: string } }) => {
            assert(locked, "turn check must happen after the row lock");
            return boards.get(where.boardId)?.turns ? { id: "turn" } : null;
          },
        },
        boardChatMessage: {
          findFirst: async ({ where }: { where: { boardId: string } }) => {
            assert(locked, "chat check must happen after the row lock");
            return boards.get(where.boardId)?.messages ? { id: "message" } : null;
          },
        },
        board: {
          findFirst: async ({ where }: { where: { id: string; userId: string } }) => {
            const board = boards.get(where.id);
            return board?.userId === where.userId ? board : null;
          },
          delete: async ({ where }: { where: { id: string } }) => {
            assert(deletionJobs.includes(`lectures/${where.id}/`), "durable cleanup must be queued before deleting ownership records");
            deletes++;
            boards.delete(where.id);
          },
        },
        objectDeletionJob: { create: async ({ data }: { data: { prefix: string } }) => { deletionJobs.push(data.prefix); } },
      });
    },
  },
};

async function verify() {
const routePath = resolve(import.meta.dirname, "../../app/api/boards/[boardId]/route.ts");
const { outputFiles } = await build({
  entryPoints: [routePath], bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  plugins: [{
    name: "board-route-fixtures",
    setup(build: { onResolve: (opts: { filter: RegExp }, cb: (args: { path: string }) => object) => void; onLoad: (opts: { filter: RegExp; namespace: string }, cb: (args: { path: string }) => object) => void }) {
      build.onResolve({ filter: /^@\/lib\/(auth|db\/prisma|object-store\/s3|boards\/storageQuota)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path.endsWith("auth")
          ? "export const getUserId = async () => globalThis.__boardDeleteTest.userId; export const ensureUser = async () => {};"
          : args.path.endsWith("prisma")
            ? "export const prisma = globalThis.__boardDeleteTest.prisma;"
            : args.path.endsWith("storageQuota")
              ? "export const MAX_BOARD_TITLE_CHARS=200; export const MAX_BOARD_PREVIEW_CHARS=2000; export const boardDeletionStorageBytes=async()=>0n; export class StorageQuotaError extends Error { constructor(message,status=413,code) { super(message); this.status=status; this.code=code; } }; export const withUserStorageLock=(id,run)=>globalThis.__boardDeleteTest.prisma.$transaction(run);"
            : "export const boardAudioPrefix = (id) => id; export const deletePrefix = async () => {};",
        loader: "js",
      }));
    },
  }],
});
const require = createRequire(routePath);
const compiled = new Module(routePath, module);
compiled.filename = routePath;
compiled.paths = (Module as typeof Module & { _nodeModulePaths: (path: string) => string[] })._nodeModulePaths(resolve(routePath, ".."));
compiled.require = require;
// Node's internal loader is only used to load this isolated, in-memory test bundle.
(compiled as Module & { _compile: (source: string, filename: string) => void })._compile(outputFiles[0]!.text, routePath);
const { DELETE } = compiled.exports as {
  DELETE: (request: Request, context: { params: Promise<{ boardId: string }> }) => Promise<Response>;
};
const run = (id: string, conditional = true) => DELETE(
  new Request(`http://localhost/api/boards/${id}${conditional ? "?ifEmpty=1" : ""}`, { method: "DELETE" }),
  { params: Promise.resolve({ boardId: id }) },
);
function seed(id: string, changes: Partial<Board> = {}) {
  boards.set(id, { id, userId: "owner", preview: "", turns: 0, messages: 0, ...changes });
  locked = false;
}

try {
  seed("race");
  injectBeforeLock = () => { boards.get("race")!.turns = 1; };
  const raced = await run("race");
  assert(raced.status === 409 && boards.get("race")?.turns === 1 && deletes === 0,
    "a turn arriving between inspection and deletion must survive a conditional DELETE");

  seed("preview", { preview: "saved lesson" });
  assert((await run("preview")).status === 409 && boards.has("preview"), "nonempty preview must protect a recording");
  seed("chat", { messages: 1 });
  assert((await run("chat")).status === 409 && boards.has("chat"), "chat messages must protect a board");
  seed("empty");
  assert((await run("empty")).status === 200 && !boards.has("empty"), "empty orphan must be deleted");
  assert(deletionJobs.includes("lectures/empty/"), "empty deletion must durably enqueue cleanup before losing its row");
  seed("manual", { turns: 1, preview: "saved lesson" });
  assert((await run("manual", false)).status === 200 && !boards.has("manual"), "manual deletion must remain unconditional");
  assert(deletionJobs.includes("lectures/manual/"), "manual deletion must durably enqueue cleanup");
  seed("someone-else", { userId: "other" });
  assert((await run("someone-else")).status === 404 && boards.has("someone-else"), "owner restriction must be preserved");
  userId = null;
  assert((await run("someone-else")).status === 401, "unauthenticated deletion must be rejected");
  console.log("verify-board-empty-delete: passed");
} finally {
  delete (globalThis as { __boardDeleteTest?: unknown }).__boardDeleteTest;
}
}
void verify().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
