export function pickClipboardImage(options: {
  items?: Array<{ kind: string; type: string; getAsFile(): File | null }>;
  files?: Iterable<File>;
}): File | null {
  for (const item of options.items ?? []) {
    if (item.kind === "file" && isImageType(item.type)) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of options.files ?? []) {
    if (isImageType(file.type) || isImageName(file.name)) {
      return file;
    }
  }
  return null;
}

export function fileFromClipboardData(
  data: DataTransfer | null | undefined,
): File | null {
  if (!data) return null;
  return pickClipboardImage({
    items: Array.from(data.items),
    files: data.files,
  });
}

function isImageType(type: string): boolean {
  return type.startsWith("image/");
}

function isImageName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif|heic|heif|bmp|tif?f)$/i.test(name);
}
