export interface StorageFileResult {
  key: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  saveFile(key: string, buffer: Buffer, mimeType?: string): Promise<StorageFileResult>;
  getFileBuffer(key: string): Promise<Buffer>;
  getFileStream(key: string): Promise<NodeJS.ReadableStream>;
  deleteFile(key: string): Promise<void>;
  fileExists(key: string): Promise<boolean>;
}

export const STORAGE_ADAPTER = "STORAGE_ADAPTER";
