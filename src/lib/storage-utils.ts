import { storage } from "@/lib/storage";

let bucketUnavailable = false;

export function isStorageBucketAvailable(): boolean {
  return !bucketUnavailable;
}

export async function uploadStorageFile(
  path: string,
  file: File | Blob,
  mimeType?: string
): Promise<string> {
  try {
    const { url } = await storage.upload(path, file, {
      contentType: mimeType || (file instanceof File ? file.type : "application/octet-stream"),
    });
    return url;
  } catch (e: any) {
    if (e?.message?.includes("File too large")) {
      throw e;
    }
    // Fall back to inline data URL for small assets
    const { blobToDataUrl } = await import("@/lib/image-utils");
    if (file.size <= 100 * 1024) {
      return blobToDataUrl(file);
    }
    throw e;
  }
}

export async function deleteStorageFileByUrl(url?: string | null): Promise<void> {
  if (!url || url.startsWith("data:")) return;
  try {
    // Extract path from data URL storage key pattern
    // Inline data URLs don't need deletion
    return;
  } catch (e) {
    console.warn("[deleteStorageFileByUrl] Could not delete stored file:", e);
  }
}
