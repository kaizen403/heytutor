/**
 * Raster helpers for the reference picture stroke plan: typed array ports of
 * the few OpenCV calls the whiteboard reveal method needs (grey conversion,
 * bilateral filter, Gaussian adaptive threshold, dilation, connected
 * components), plus the capsule rasteriser the coverage checks and the
 * preview frames share. Every mask is a `Uint8Array` of 0/1, row major.
 *
 * Pixel (x, y) covers [x, x+1] x [y, y+1]; geometry tests use its centre
 * (x + 0.5, y + 0.5), the same convention a canvas uses when it strokes.
 */

/** OpenCV's fixed point RGB to grey (0.299 R + 0.587 G + 0.114 B). */
export function toGray(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = (rgb[j]! * 4899 + rgb[j + 1]! * 9617 + rgb[j + 2]! * 1868 + 8192) >> 14;
  return out;
}

/** Copy `src` into a buffer padded by `pad` on every side, replicating edges. */
function padReplicate(src: Uint8Array, width: number, height: number, pad: number): { data: Uint8Array; stride: number } {
  const stride = width + 2 * pad;
  const data = new Uint8Array(stride * (height + 2 * pad));
  for (let y = -pad; y < height + pad; y++) {
    const sy = y < 0 ? 0 : y >= height ? height - 1 : y;
    const row = (y + pad) * stride;
    for (let x = -pad; x < width + pad; x++) {
      const sx = x < 0 ? 0 : x >= width ? width - 1 : x;
      data[row + x + pad] = src[sy * width + sx]!;
    }
  }
  return { data, stride };
}

/**
 * `cv2.bilateralFilter(src, d, sigmaColor, sigmaSpace)` on one channel: a
 * circular window of radius `d / 2`, Gaussian in space and in intensity. It
 * flattens paper grain and gradient banding while keeping line edges sharp.
 */
export function bilateral(src: Uint8Array, width: number, height: number, d: number, sigmaColor: number, sigmaSpace: number): Uint8Array {
  const radius = Math.floor(d / 2);
  const { data, stride } = padReplicate(src, width, height, radius);
  const offsets: number[] = [];
  const spatial: number[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      offsets.push(dy * stride + dx);
      spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace)));
    }
  }
  const range = new Float64Array(256);
  for (let i = 0; i < 256; i++) range[i] = Math.exp(-(i * i) / (2 * sigmaColor * sigmaColor));
  const n = offsets.length;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centre = (y + radius) * stride + x + radius;
      const c = data[centre]!;
      let sum = 0;
      let weight = 0;
      for (let k = 0; k < n; k++) {
        const v = data[centre + offsets[k]!]!;
        const w = spatial[k]! * range[v > c ? v - c : c - v]!;
        sum += v * w;
        weight += w;
      }
      out[y * width + x] = Math.round(sum / weight);
    }
  }
  return out;
}

/** Separable Gaussian blur rounded back to 8 bit, replicate border (OpenCV's adaptive mean). */
export function gaussianBlur8(src: Uint8Array, width: number, height: number, ksize: number): Uint8Array {
  const sigma = 0.3 * ((ksize - 1) * 0.5 - 1) + 0.8;
  const half = (ksize - 1) >> 1;
  const kernel = new Float64Array(ksize);
  let total = 0;
  for (let i = 0; i < ksize; i++) total += kernel[i] = Math.exp(-((i - half) ** 2) / (2 * sigma * sigma));
  for (let i = 0; i < ksize; i++) kernel[i]! /= total;
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = 0; k < ksize; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k - half));
        s += src[row + xx]! * kernel[k]!;
      }
      tmp[row + x] = s;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = 0; k < ksize; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k - half));
        s += tmp[yy * width + x]! * kernel[k]!;
      }
      out[y * width + x] = Math.round(s);
    }
  }
  return out;
}

/**
 * `cv2.adaptiveThreshold(g, 255, ADAPTIVE_THRESH_GAUSSIAN_C, THRESH_BINARY, ksize, C)`
 * inverted to a mask: 1 where the pixel is at least `C` darker than its
 * Gaussian neighbourhood, which is what a line looks like at any brightness.
 */
export function adaptiveInk(gray: Uint8Array, width: number, height: number, ksize: number, c: number): Uint8Array {
  const mean = gaussianBlur8(gray, width, height, ksize);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = gray[i]! <= mean[i]! - c ? 1 : 0;
  return out;
}

/** Box average downscale by an integer factor; edge blocks average what they hold. */
export function boxDownscale(src: Uint8Array, width: number, height: number, factor: number): { data: Uint8Array; width: number; height: number } {
  const w = Math.ceil(width / factor);
  const h = Math.ceil(height / factor);
  const data = new Uint8Array(w * h);
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      let sum = 0;
      let count = 0;
      for (let y = by * factor; y < Math.min(height, (by + 1) * factor); y++) {
        for (let x = bx * factor; x < Math.min(width, (bx + 1) * factor); x++) {
          sum += src[y * width + x]!;
          count++;
        }
      }
      data[by * w + bx] = Math.round(sum / count);
    }
  }
  return { data, width: w, height: h };
}

/** Square dilation of radius `r` (a (2r+1)^2 window), separable. */
export function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      for (let xx = Math.max(0, x - r); xx <= Math.min(width - 1, x + r); xx++) tmp[row + xx] = 1;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!tmp[y * width + x]) continue;
      for (let yy = Math.max(0, y - r); yy <= Math.min(height - 1, y + r); yy++) out[yy * width + x] = 1;
    }
  }
  return out;
}

export interface Components {
  /** 0 = background, otherwise 1..count. */
  labels: Int32Array;
  count: number;
  /** Indexed by label; index 0 unused. */
  area: Int32Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
}

/** Connected components of a 0/1 mask, labelled in raster order of their first pixel. */
export function labelComponents(mask: Uint8Array, width: number, height: number, eight: boolean): Components {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const area: number[] = [0];
  const minX: number[] = [0];
  const minY: number[] = [0];
  const maxX: number[] = [0];
  const maxY: number[] = [0];
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    let a = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    while (top > 0) {
      const p = stack[--top]!;
      const x = p % width;
      const y = (p - x) / width;
      a++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (mask[q] && !labels[q]) {
            labels[q] = count;
            stack[top++] = q;
          }
        }
      }
    }
    area.push(a);
    minX.push(x0);
    minY.push(y0);
    maxX.push(x1);
    maxY.push(y1);
  }
  return { labels, count, area: Int32Array.from(area), minX: Int32Array.from(minX), minY: Int32Array.from(minY), maxX: Int32Array.from(maxX), maxY: Int32Array.from(maxY) };
}

/** Pixels of `mask` 4-connected to the picture border. */
export function borderConnected(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  const seed = (p: number) => {
    if (mask[p] && !out[p]) {
      out[p] = 1;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (top > 0) {
    const p = stack[--top]!;
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < width * (height - 1)) seed(p + width);
  }
  return out;
}

/**
 * Mark every pixel whose centre lies within `radius` of the polyline (a chain
 * of round capped capsules), the shape a round capped canvas stroke of width
 * `2 * radius` paints. `upTo` truncates the polyline at that arc length.
 */
export function stampPolyline(cover: Uint8Array, width: number, height: number, pts: readonly number[], radius: number, upTo = Infinity): void {
  const r2 = radius * radius;
  let travelled = 0;
  const segment = (ax: number, ay: number, bx: number, by: number) => {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + radius));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + radius));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5 - ay;
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * dx;
        const ey = py - t * dy;
        if (ex * ex + ey * ey <= r2) cover[row + x] = 1;
      }
    }
  };
  if (pts.length < 2 || upTo <= 0) return;
  if (pts.length < 4) {
    segment(pts[0]!, pts[1]!, pts[0]!, pts[1]!);
    return;
  }
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const ax = pts[i - 2]!;
    const ay = pts[i - 1]!;
    let bx = pts[i]!;
    let by = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (travelled + len > upTo) {
      const t = len > 0 ? (upTo - travelled) / len : 0;
      bx = ax + (bx - ax) * t;
      by = ay + (by - ay) * t;
      segment(ax, ay, bx, by);
      return;
    }
    segment(ax, ay, bx, by);
    travelled += len;
  }
}

/** Fraction of `target` pixels that `cover` marks; 1 when the target is empty. */
export function coverageOf(target: Uint8Array, cover: Uint8Array): { covered: number; total: number; fraction: number } {
  let covered = 0;
  let total = 0;
  for (let i = 0; i < target.length; i++) {
    if (!target[i]) continue;
    total++;
    if (cover[i]) covered++;
  }
  return { covered, total, fraction: total === 0 ? 1 : covered / total };
}

/** Ramer Douglas Peucker on a flat `[x0, y0, x1, y1, ...]` list. */
export function simplifyPolyline(pts: readonly number[], epsilon: number): number[] {
  const n = pts.length >> 1;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const e2 = epsilon * epsilon;
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const ax = pts[2 * a]!;
    const ay = pts[2 * a + 1]!;
    const dx = pts[2 * b]! - ax;
    const dy = pts[2 * b + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = e2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i]! - ax;
      const py = pts[2 * i + 1]! - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      }
      if (d2 > worstD) {
        worstD = d2;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i]!, pts[2 * i + 1]!);
  return out;
}
