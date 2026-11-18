import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Paperclip, Trash2, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import type { CrmAttachment } from "../../types/attachments.types";
import { validateCrmFileForUpload } from "../../api/crm-storage.service";
import { AttachmentsService } from "../../api/attachments.service";

interface CrmAttachmentsSectionProps {
  attachments: CrmAttachment[];
  canManage: boolean;
  isLoading?: boolean;
  onUpload: (file: File) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

function AuthenticatedImagePreview({ attachment }: { attachment: CrmAttachment }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(
    attachment.fileUrl.startsWith("data:") ? attachment.fileUrl : null
  );
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (attachment.fileUrl.startsWith("data:")) return;

    let isMounted = true;
    let currentBlobUrl: string | null = null;

    AttachmentsService.getAttachmentBlobUrl(attachment.id)
      .then((url) => {
        if (isMounted) {
          currentBlobUrl = url;
          setBlobUrl(url);
        } else {
          window.URL.revokeObjectURL(url);
        }
      })
      .catch(() => {
        if (isMounted) setHasError(true);
      });

    return () => {
      isMounted = false;
      if (currentBlobUrl) {
        window.URL.revokeObjectURL(currentBlobUrl);
      }
    };
  }, [attachment.id, attachment.fileUrl]);

  if (hasError || !blobUrl) {
    return (
      <div className="h-12 w-12 rounded-lg bg-default-100 flex items-center justify-center shrink-0">
        <FileText className="h-5 w-5 text-default-400" />
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={attachment.fileName}
      className="h-12 w-12 rounded-lg object-cover shrink-0 border border-default-200"
    />
  );
}

export function CrmAttachmentsSection({
  attachments,
  canManage,
  isLoading,
  onUpload,
  onDelete,
}: CrmAttachmentsSectionProps) {
  const { t } = useTranslation("crm");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    const validation = validateCrmFileForUpload(file);
    if (!validation.valid) {
      toast.error(validation.error || t("attachments.unsupported"));
      return;
    }
    setBusy(true);
    try {
      await onUpload(file);
    } catch {
      // Error is handled in mutation onError
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async (att: CrmAttachment) => {
    try {
      setDownloadingId(att.id);
      if (att.fileUrl.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = att.fileUrl;
        link.setAttribute("download", att.fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        await AttachmentsService.downloadAttachment(att.id, att.fileName);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "فشل تحميل الملف");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.xls,.xlsx,.doc,.docx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <Button
            color="primary"
            variant="flat"
            className="rounded-full"
            startContent={<Paperclip className="h-4 w-4" />}
            isLoading={busy || isLoading}
            onPress={() => inputRef.current?.click()}
          >
            {t("attachments.upload")}
          </Button>
        </>
      )}
      {attachments.length === 0 ? (
        <p className="text-default-500 text-sm">{t("leadDetail.attachments.empty")}</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-default-100 bg-default-50/50"
            >
              {isImage(att.mimeType) ? (
                <AuthenticatedImagePreview attachment={att} />
              ) : (
                <div className="h-12 w-12 rounded-lg bg-default-100 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-default-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{att.fileName}</p>
                <button
                  type="button"
                  onClick={() => handleDownload(att)}
                  disabled={downloadingId === att.id}
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-0.5 cursor-pointer disabled:opacity-50"
                >
                  {downloadingId === att.id ? (
                    <Spinner size="sm" className="h-3 w-3" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  {t("attachments.download")}
                </button>
              </div>
              {canManage && onDelete && (
                <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => onDelete(att.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
