import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { StorageAdapter, StorageFileResult } from "./storage.interface";

@Injectable()
export class LocalStorageAdapter implements StorageAdapter {
  private readonly logger = new Logger(LocalStorageAdapter.name);
  private readonly baseDir: string;

  constructor() {
    const configuredDir = process.env.CRM_STORAGE_DIR;
    this.baseDir = path.resolve(configuredDir || path.join(process.cwd(), "storage"));
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    this.logger.log(`LocalStorageAdapter initialized with root directory: ${this.baseDir}`);
  }

  private resolveSafePath(key: string): string {
    // Prevent directory traversal
    const resolved = path.resolve(this.baseDir, key);

    const rootWithSep = this.baseDir.endsWith(path.sep) ? this.baseDir : this.baseDir + path.sep;
    if (!resolved.startsWith(rootWithSep) && resolved !== this.baseDir) {
      throw new Error(`Access denied: Invalid storage path traversal attempt: ${key}`);
    }
    return resolved;
  }

  async saveFile(key: string, buffer: Buffer, _mimeType?: string): Promise<StorageFileResult> {
    const fullPath = this.resolveSafePath(key);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    await fs.promises.writeFile(fullPath, buffer);
    return {
      key,
      sizeBytes: buffer.length,
    };
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    const fullPath = this.resolveSafePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in storage: ${key}`);
    }
    return fs.promises.readFile(fullPath);
  }

  async getFileStream(key: string): Promise<NodeJS.ReadableStream> {
    const fullPath = this.resolveSafePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found in storage: ${key}`);
    }
    return fs.createReadStream(fullPath);
  }

  async deleteFile(key: string): Promise<void> {
    const fullPath = this.resolveSafePath(key);
    try {
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        this.logger.log(`Deleted file: ${key}`);
      }
    } catch (err: any) {
      this.logger.warn(`Failed to delete file ${key}: ${err.message}`);
    }
  }

  async fileExists(key: string): Promise<boolean> {
    const fullPath = this.resolveSafePath(key);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
