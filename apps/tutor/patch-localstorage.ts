// Node 22+ can expose a broken localStorage when --localstorage-file is invalid,
// which crashes Next.js dev overlay during SSR.
if (
  typeof globalThis.localStorage !== "undefined" &&
  typeof globalThis.localStorage.getItem !== "function"
) {
  Reflect.deleteProperty(globalThis, "localStorage");
}
