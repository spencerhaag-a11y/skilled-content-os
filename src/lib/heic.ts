/**
 * HEIC → JPEG conversion.
 *
 * iPhones shoot HEIC by default and Google Drive hands the file back as-is.
 * No browser except Safari can decode it, so an unconverted HEIC would upload
 * fine and then render as a broken image everywhere — it has to be transcoded
 * before it reaches storage, not after.
 *
 * heic-to wraps a libheif wasm build that is several hundred KB, so it is
 * imported dynamically: a session that never picks a HEIC never pays for it.
 */

/** Drive reports either of these; some clients omit the type entirely. */
const HEIC_MIME = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXT = /\.(heic|heif)$/i;

/** JPEG quality for the transcode. High enough that the recompression is not visible. */
const JPEG_QUALITY = 0.92;

/**
 * Whether this needs transcoding before upload. Checks the extension as well
 * as the MIME type because Drive occasionally reports HEIC as a bare
 * application/octet-stream.
 */
export function isHeic(fileName: string, mimeType: string): boolean {
  return HEIC_MIME.has(mimeType.toLowerCase()) || HEIC_EXT.test(fileName);
}

/** The name a converted file should be stored under. */
export function heicNameToJpg(fileName: string): string {
  return HEIC_EXT.test(fileName) ? fileName.replace(HEIC_EXT, ".jpg") : `${fileName}.jpg`;
}

export interface ConvertedImage {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

/**
 * Transcodes a HEIC blob to JPEG, renaming it to match. Returns the input
 * untouched when it isn't HEIC, so callers can run everything through here.
 */
export async function convertHeicToJpeg(
  blob: Blob,
  fileName: string,
  mimeType: string
): Promise<ConvertedImage> {
  if (!isHeic(fileName, mimeType)) return { blob, fileName, mimeType };

  const { heicTo } = await import("heic-to");
  try {
    const jpeg = await heicTo({ blob, type: "image/jpeg", quality: JPEG_QUALITY });
    return {
      blob: jpeg,
      fileName: heicNameToJpg(fileName),
      mimeType: "image/jpeg",
    };
  } catch (err) {
    // A HEIC that libheif can't read is usually a Live Photo container or a
    // depth-map variant. Say so rather than surfacing a wasm stack trace.
    throw new Error(
      `"${fileName}" could not be converted from HEIC${
        err instanceof Error && err.message ? `: ${err.message}` : "."
      }`
    );
  }
}
