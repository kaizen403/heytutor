import { snapshotMathSourceData } from "@heytutor/scene-engine";

/** Ordinary own-data originals remain complete. Non-data callers become
 * descriptor evidence, never an object whose accessors JSON could execute. */
export function captureSourceCaller<T>(value: T):
  | { ok: true; data: T }
  | { ok: false; evidence: unknown } {
  try { return { ok: true, data: structuredClone(snapshotMathSourceData(value)) }; }
  catch { return { ok: false, evidence: sourceDataEvidence(value) }; }
}

function sourceDataEvidence(value: unknown): unknown {
  let nodes = 0, keys = 0, strings = 0;
  const seen = new Set<object>();
  const mark = (reason: string) => ({ sourceDataRefusal: reason });
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 16384 || depth > 64) return mark("capture_bound");
    if (typeof input === "string") {
      strings += input.length;
      return strings > 1048576 ? mark("string_bound") : input;
    }
    if (input === null || input === undefined || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : mark("nonfinite_number");
    if (typeof input !== "object") return mark(typeof input);
    if (seen.has(input)) return mark("repeated_object");
    seen.add(input);
    const output: Record<string, unknown> = Object.create(null);
    try {
      const proto = Object.getPrototypeOf(input);
      const inherited = proto !== null && proto !== (Array.isArray(input) ? Array.prototype : Object.prototype);
      for (const name of Reflect.ownKeys(input)) {
        if (++keys > 65536 || nodes >= 16384 || strings > 1048576) {
          output.sourceDataCaptureBound = true; break;
        }
        if (typeof name !== "string") { output.sourceDataSymbolKey = true; continue; }
        strings += name.length;
        if (strings > 1048576) { output.sourceDataCaptureBound = true; break; }
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        Object.defineProperty(output, name, { enumerable: true, value:
          descriptor && "value" in descriptor ? visit(descriptor.value, depth + 1) : mark("accessor") });
      }
      return { ...(inherited ? { sourceDataRefusal: "inherited_prototype" } : {}), ownData: output };
    } catch { return { sourceDataRefusal: "descriptor_capture_failed", ownData: output }; }
  };
  return visit(value, 0);
}
