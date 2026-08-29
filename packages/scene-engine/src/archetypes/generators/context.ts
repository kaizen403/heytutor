/** Shared generator inputs and small helpers. */
import type { ArchetypeId, Slots } from "../catalog";
import type { SceneDocument } from "../../types";
import { fmt, withUnit } from "../document";
import type { PlanQuantity, SlotSource } from "../slots";

export interface GeneratorContext {
  question: string;
  slots: Slots;
  sources: Readonly<Record<string, SlotSource>>;
  quantities: readonly PlanQuantity[];
  schematic: boolean;
}

export type Generator = (context: GeneratorContext) => SceneDocument | null;

export type GeneratorTable = Partial<Record<ArchetypeId, Generator>>;

export function num(context: GeneratorContext, key: string, fallback: number): number {
  const value = context.slots[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function maybeNum(context: GeneratorContext, key: string): number | null {
  const value = context.slots[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function text(context: GeneratorContext, key: string, fallback = ""): string {
  const value = context.slots[key];
  return typeof value === "string" ? value : fallback;
}

export function numbers(context: GeneratorContext, key: string): number[] {
  const value = context.slots[key];
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

export function grounded(context: GeneratorContext, key: string): boolean {
  const source = context.sources[key];
  return source === "plan" || source === "stem";
}

/** "u = 20 m/s" when the value is grounded, otherwise just the symbol. */
export function valueLabel(context: GeneratorContext, key: string, symbol: string, unit?: string, digits = 3): string {
  const value = maybeNum(context, key);
  if (value === null || !grounded(context, key)) return symbol;
  return `${symbol}=${withUnit(value, unit, digits)}`.slice(0, 16);
}

export function angleLabel(context: GeneratorContext, key: string, symbol = "θ"): string {
  const value = maybeNum(context, key);
  if (value === null || !grounded(context, key)) return symbol;
  return `${symbol}=${fmt(value, 3)}°`;
}

export function angleExpected(degrees: number): { value: number; unit: "degree" } {
  return { value: Number(degrees.toFixed(4)), unit: "degree" };
}
