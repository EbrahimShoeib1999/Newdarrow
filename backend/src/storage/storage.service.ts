import { Inject, Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import { STORAGE_ADAPTER, StorageAdapter, StorageFileResult } from "./storage.interface";

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter
  ) {}

  generateKey(
    companyId: string,
    entityType: string,
    entityId: string,
    originalName: string
  ): string {
    const rawExt = path.extname(originalName).toLowerCase().replace(/[^a-z0-9]/g, "");
    const ext = rawExt ? `.${rawExt}` : ".bin";
    const cleanCompanyId = companyId.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanEntityType = entityType.replace(/[^a-zA-Z0-9_-]/g, "");
    const cleanEntityId = entityId.replace(/[^a-zA-Z0-9_-]/g, "");
    const fileId = uuidv4();

    return `crm/${cleanCompanyId}/${cleanEntityType}/${cleanEntityId}/${fileId}${ext}`;
  }

  async saveFile(key: string, buffer: Buffer, mimeType?: string): Promise<StorageFileResult> {
    return this.adapter.saveFile(key, buffer, mimeType);
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    return this.adapter.getFileBuffer(key);
  }

  async getFileStream(key: string): Promise<NodeJS.ReadableStream> {
    return this.adapter.getFileStream(key);
  }

  async deleteFile(key: string): Promise<void> {
    return this.adapter.deleteFile(key);
  }

  async fileExists(key: string): Promise<boolean> {
    return this.adapter.fileExists(key);
  }
}
