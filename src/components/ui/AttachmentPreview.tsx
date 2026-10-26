import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { saveAs } from "file-saver";
import type { Attachment } from "../../types";
import { Modal } from "./Modal";

/** Glass preview modal for an attachment (receipt photos and other files). */
export function AttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: Pick<Attachment, "name" | "mime" | "blob"> | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attachment && attachment.mime.startsWith("image/")) {
      const u = URL.createObjectURL(attachment.blob);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(null);
  }, [attachment]);

  return (
    <Modal open={attachment != null} onClose={onClose} size="lg" title={attachment?.name}>
      {attachment &&
        (url ? (
          <img
            src={url}
            alt={attachment.name}
            className="mx-auto max-h-[64vh] rounded-2xl object-contain"
          />
        ) : (
          <p className="py-10 text-center text-sm text-ink-500">
            پیش‌نمایش این نوع فایل پشتیبانی نمی‌شود — از دکمه دانلود استفاده کنید.
          </p>
        ))}
      {attachment && (
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-glass" onClick={() => saveAs(attachment.blob, attachment.name)}>
            <Download size={15} />
            دانلود
          </button>
        </div>
      )}
    </Modal>
  );
}
