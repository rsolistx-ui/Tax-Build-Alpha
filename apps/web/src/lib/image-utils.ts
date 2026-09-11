/**
 * Client-side HEIC/HEIF to JPEG conversion using heic2any.
 * Dynamically imports the library only when needed to keep bundle size small.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  try {
    const { default: heic2any } = await import("heic2any");
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.92,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return new File([blob], file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (e) {
    console.warn("HEIC conversion failed, uploading original:", e);
    return file;
  }
}

export function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type === "image/heic" || type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif");
}

export type CaptureSource = "file" | "camera" | "library";

export function createCaptureInput(source: CaptureSource, accept: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.style.display = "none";

  if (source === "camera") {
    input.capture = "environment";
  } else if (source === "library") {
    // For photo library, we still use the file input but on mobile
    // browsers this will offer the library picker. Some browsers
    // distinguish via capture attribute.
    input.capture = "user";
  }

  return input;
}