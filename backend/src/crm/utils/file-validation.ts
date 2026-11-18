import * as path from "path";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  sanitizedName: string;
  mimeType: string;
}

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "xlsx",
  "xls",
  "docx",
  "doc",
]);

export function sanitizeFilename(filename: string): string {
  const parsed = path.parse(filename || "unnamed_file");
  const base = parsed.name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim()
    .slice(0, 100);
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  return `${base || "file"}${ext}`;
}

export function detectMagicBytes(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;

  // PDF: %PDF- (0x25 0x50 0x44 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "application/pdf";
  }

  // PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: GIF87a or GIF89a (0x47 0x49 0x46 0x38)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // Zip-based documents (DOCX, XLSX): PK\x03\x04
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return "application/zip";
  }

  // OLE compound document (Legacy DOC, XLS): 0xD0 0xCF 0x11 0xE0 0xA1 0xB1 0x1A 0xE1
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    return "application/x-ole-storage";
  }

  return null;
}

export function validateUploadedFile(file: {
  originalname: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}): FileValidationResult {
  const sanitizedName = sanitizeFilename(file.originalname);
  const ext = path.extname(sanitizedName).toLowerCase().replace(/^\./, "");

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds the 10 MB limit (${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
      sanitizedName,
      mimeType: file.mimetype || "application/octet-stream",
    };
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File type .${ext} is not supported. Allowed formats: PDF, PNG, JPG/JPEG, GIF, WEBP, XLSX, XLS, DOCX, DOC.`,
      sanitizedName,
      mimeType: file.mimetype || "application/octet-stream",
    };
  }

  const detectedMagic = detectMagicBytes(file.buffer);

  // Validate magic bytes match extension
  if (ext === "pdf" && detectedMagic !== "application/pdf") {
    return {
      valid: false,
      error: "File content does not match a valid PDF document.",
      sanitizedName,
      mimeType: "application/pdf",
    };
  }

  if (["png"].includes(ext) && detectedMagic !== "image/png") {
    return {
      valid: false,
      error: "File content does not match a valid PNG image.",
      sanitizedName,
      mimeType: "image/png",
    };
  }

  if (["jpg", "jpeg"].includes(ext) && detectedMagic !== "image/jpeg") {
    return {
      valid: false,
      error: "File content does not match a valid JPEG image.",
      sanitizedName,
      mimeType: "image/jpeg",
    };
  }

  if (ext === "gif" && detectedMagic !== "image/gif") {
    return {
      valid: false,
      error: "File content does not match a valid GIF image.",
      sanitizedName,
      mimeType: "image/gif",
    };
  }

  if (ext === "webp" && detectedMagic !== "image/webp") {
    return {
      valid: false,
      error: "File content does not match a valid WebP image.",
      sanitizedName,
      mimeType: "image/webp",
    };
  }

  if (["docx", "xlsx"].includes(ext) && detectedMagic !== "application/zip") {
    return {
      valid: false,
      error: `File content does not match a valid ${ext.toUpperCase()} document.`,
      sanitizedName,
      mimeType: ext === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (["doc", "xls"].includes(ext) && detectedMagic !== "application/x-ole-storage") {
    return {
      valid: false,
      error: `File content does not match a valid ${ext.toUpperCase()} document.`,
      sanitizedName,
      mimeType: ext === "xls" ? "application/vnd.ms-excel" : "application/msword",
    };
  }

  let finalMime = file.mimetype || "application/octet-stream";
  if (ext === "pdf") finalMime = "application/pdf";
  else if (ext === "png") finalMime = "image/png";
  else if (["jpg", "jpeg"].includes(ext)) finalMime = "image/jpeg";
  else if (ext === "gif") finalMime = "image/gif";
  else if (ext === "webp") finalMime = "image/webp";
  else if (ext === "xlsx") finalMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  else if (ext === "xls") finalMime = "application/vnd.ms-excel";
  else if (ext === "docx") finalMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  else if (ext === "doc") finalMime = "application/msword";

  return {
    valid: true,
    sanitizedName,
    mimeType: finalMime,
  };
}
