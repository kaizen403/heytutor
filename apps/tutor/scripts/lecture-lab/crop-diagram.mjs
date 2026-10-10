import sharp from "sharp";

// Portable equivalent of the original 760×620 board-zone crop, scaled to 700px.
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("Usage: crop-diagram.mjs <source> <destination>");
await sharp(source).extract({ left: 400, top: 80, width: 760, height: 620 })
  .resize({ width: 700 }).png().toFile(destination);
