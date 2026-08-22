const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function compressQuestionImage(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Image is too large. Use a photo under 8 MB.");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Could not read that image.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) {
    throw new Error("Could not read that image.");
  }
  return dataUrl;
}
