import type { RenderPoint } from "../types";
import type { AtomicObservableDefinition } from "./atomicGeometry";

interface PlotGeometry { kind: string; atomicObservable?: AtomicObservableDefinition; xMin?: number; xMax?: number; yMin?: number; yMax?: number }

/** A plot-only presentation map. Source coordinates and proofs retain their units. */
export function atomicPlotTransform(values: readonly PlotGeometry[], points: readonly RenderPoint[], viewport: { x: number; y: number; width: number; height: number; padding?: number }): ((point: RenderPoint) => RenderPoint) | undefined {
  const calibrations = values.flatMap(value => value.atomicObservable?.plotCalibration ? [value.atomicObservable.plotCalibration] : []);
  const first = calibrations[0];
  if (!first || calibrations.some(calibration => calibration.axesId !== first.axesId || calibration.xMin !== first.xMin || calibration.xMax !== first.xMax || calibration.yMin !== first.yMin || calibration.yMax !== first.yMax)) return undefined;
  // A physical shape sharing this view prevents an independently scaled plot map.
  if (values.some(value => !["point", "path", "axes"].includes(value.kind))) return undefined;
  const axes = values.filter(value => value.kind === "axes");
  if (axes.length !== 1 || axes[0]!.xMin !== first.xMin || axes[0]!.xMax !== first.xMax || axes[0]!.yMin !== first.yMin || axes[0]!.yMax !== first.yMax) return undefined;
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const padding = viewport.padding ?? 24, width = viewport.width - 2 * padding, height = viewport.height - 2 * padding;
  if (!(maxX > minX) || !(maxY > minY) || !(width > 0) || !(height > 0)) return undefined;
  return point => ({ x: Math.round((viewport.x + padding + (point.x - minX) * width / (maxX - minX)) * 1e6) / 1e6, y: Math.round((viewport.y + padding + height - (point.y - minY) * height / (maxY - minY)) * 1e6) / 1e6 });
}
