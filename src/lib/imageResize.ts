// Client-side photo shrinking (T5.2): phone photos are huge, so anything over 5 MB or
// longer than 1600 px is redrawn on a canvas as a JPEG (quality 0.85) before upload.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_EDGE_PX = 1600;
export const JPEG_QUALITY = 0.85;

/** Size after scaling so the longer edge is at most `maxEdge` (never upscales). Pure. */
export function scaledSize(width: number, height: number, maxEdge = MAX_EDGE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** Whether the file needs shrinking. Pure. */
export function needsResize(bytes: number, width: number, height: number): boolean {
  return bytes > MAX_UPLOAD_BYTES || Math.max(width, height) > MAX_EDGE_PX;
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  // "from-image" applies the EXIF orientation, so portrait phone photos stay upright.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    // Modern browsers orient <img> by EXIF by default, and naturalWidth/Height reflect that.
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Re-encodes the photo as a JPEG (longer edge at most 1600 px, orientation applied, metadata stripped). Throws if it cannot be read. */
export async function prepareImage(file: File): Promise<File> {
  const image = await decode(file);
  try {
    // Always redrawn, even when small: the canvas drops EXIF/GPS metadata from phone photos.
    const { width, height } = scaledSize(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#fff"; // JPEG has no alpha
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("toBlob failed");
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } finally {
    image.close();
  }
}
