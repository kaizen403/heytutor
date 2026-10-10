/** Actual frame sampler/equality with deterministic browser-canvas adapters. */
import assert from "node:assert/strict";
import { lectureFramesLookSame, sampleLectureFrame } from "../../lib/lecture-export/lectureExportFrames";

class PixelCanvas {
  width = 1200;
  height = 700;
  bytes = new Uint8ClampedArray(this.width * this.height * 4).fill(255);
  getContext() {
    return {
      drawImage: (source: PixelCanvas, _x: number, _y: number, width: number, height: number) => {
        this.bytes = new Uint8ClampedArray(width * height * 4);
        // A browser adapter with nearest-center raster sampling exposes any
        // spatially skipped pixel. The native browser alias oracle separately
        // confirms that a real thin WRITE can disappear at 48×28.
        for (let y = 0; y < height; y++) {
          const sourceY = Math.min(source.height - 1, Math.floor((y + 0.5) * source.height / height));
          for (let x = 0; x < width; x++) {
            const sourceX = Math.min(source.width - 1, Math.floor((x + 0.5) * source.width / width));
            const sourceOffset = (sourceY * source.width + sourceX) * 4;
            this.bytes.set(source.bytes.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
          }
        }
      },
      getImageData: () => ({ data: this.bytes.slice() }),
    };
  }
  mark(x: number, y: number, color = [0, 0, 0, 255]) {
    this.bytes.set(color, (y * this.width + x) * 4);
  }
}
const sample = (source: PixelCanvas, dest: PixelCanvas) =>
  sampleLectureFrame(source as unknown as HTMLCanvasElement, dest as unknown as HTMLCanvasElement);

const scratch = new PixelCanvas();
const blank = new PixelCanvas();
const heldBlank = sample(blank, scratch);
const tiny = new PixelCanvas(); tiny.mark(3, 3);
const heldTiny = sample(tiny, scratch);
assert.equal(lectureFramesLookSame(heldBlank, heldTiny), false,
  "one committed ink pixel between coarse sample locations must change the encoded picture");
assert.equal(lectureFramesLookSame(heldTiny, sample(blank, scratch)), false,
  "erasing that pixel must change the picture");
const finalRow = new PixelCanvas();
for (let x = 30; x < 50; x++) finalRow.mark(x, 698);
assert.equal(lectureFramesLookSame(heldBlank, sample(finalRow, scratch)), false,
  "a thin final work row between coarse sampled scanlines survives");
const cursorBefore = new PixelCanvas(); cursorBefore.mark(3, 3);
const cursorAfter = new PixelCanvas(); cursorAfter.mark(4, 3);
assert.equal(lectureFramesLookSame(sample(cursorBefore, scratch), sample(cursorAfter, scratch)), false,
  "moving the cursor changes the picture even with the same pixel count and color");
const colorBefore = new PixelCanvas(); colorBefore.mark(3, 3, [1, 2, 3, 255]);
const colorAfter = new PixelCanvas(); colorAfter.mark(3, 3, [3, 2, 1, 255]);
assert.equal(lectureFramesLookSame(sample(colorBefore, scratch), sample(colorAfter, scratch)), false,
  "equal channel sums with different ink colors remain different");
assert.equal(lectureFramesLookSame(heldBlank, sample(new PixelCanvas(), scratch)), true,
  "an unchanged full-resolution board still coalesces into the prior span");
assert.equal(heldBlank.length, 1200 * 700 * 4);
assert.equal(heldBlank[(3 * 1200 + 3) * 4], 255,
  "later scratch-canvas reads never mutate a retained frame snapshot");
console.log("verify-lecture-export-pixels: tiny final ink, erasure, cursor/color changes, unchanged spans and owned full-resolution snapshots");
