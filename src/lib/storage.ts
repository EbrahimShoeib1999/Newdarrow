/**
 * Storage service — replaces Firebase Storage with a backend abstraction.
 * For development, files are stored as base64 data URLs in localStorage
 * (small assets only) or as blob URLs. For production, the backend provides
 * signed upload URLs.
 */
class StorageService {
  private bucket: string;

  constructor(bucket = "darrow-dev") {
    this.bucket = bucket;
  }

  async upload(
    path: string,
    file: File | Blob,
    options?: { contentType?: string; metadata?: Record<string, string> }
  ): Promise<{ url: string; path: string }> {
    // Development: store as data URL in localStorage (small assets < 100KB)
    if (file.size > 100 * 1024) {
      throw new Error(
        `File too large for local storage (${file.size} bytes). Use production storage adapter.`
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const base64 = btoa(String.fromCharCode(...bytes));
    const contentType =
      options?.contentType || file.type || "application/octet-stream";
    const dataUrl = `data:${contentType};base64,${base64}`;

    const key = `storage-${this.bucket}-${path}`;
    const existing = localStorage.getItem(key);
    const history = existing ? JSON.parse(existing) : [];
    history.push({ url: dataUrl, path, uploadedAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(history));

    return { url: dataUrl, path };
  }

  async getDownloadURL(path: string): Promise<string> {
    const key = `storage-${this.bucket}-${path}`;
    const existing = localStorage.getItem(key);
    if (!existing) {
      throw new Error(`File not found: ${path}`);
    }
    const history = JSON.parse(existing);
    return history[history.length - 1].url;
  }

  async delete(path: string): Promise<void> {
    const key = `storage-${this.bucket}-${path}`;
    localStorage.removeItem(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    const prefixKey = `storage-${this.bucket}-`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefixKey)) {
        keys.push(key.slice(prefixKey.length));
      }
    }
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
  }
}

export const storage = new StorageService();
