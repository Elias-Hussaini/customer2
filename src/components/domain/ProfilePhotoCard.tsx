/**
 * Big round profile photo card shown at the top of the customer and
 * representative detail pages (right side of the page in RTL). Clicking the
 * photo (or the button) opens the file picker — the image is square-cropped,
 * downscaled and saved straight onto the record. Editable and removable.
 */

import { useRef, useState } from "react";
import { Camera, Eye, Loader2, Trash2 } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import {
  fileToSquareDataUrl,
  setCustomerPhoto,
  setRepresentativePhoto,
  validatePhotoFile,
} from "../../db/photos";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";

interface Props {
  kind: "customer" | "rep";
  id: string;
  photo?: string | null;
  name: string;
  subtitle?: string;
}

export function ProfilePhotoCard({ kind, id, photo, name, subtitle }: Props) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);

  const pick = () => fileRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const err = validatePhotoFile(file);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToSquareDataUrl(file);
      if (kind === "customer") await setCustomerPhoto(id, dataUrl, name);
      else await setRepresentativePhoto(id, dataUrl, name);
      toast.success("عکس پروفایل ذخیره شد");
    } catch {
      toast.error("خواندن عکس ناموفق بود — فایل دیگری امتحان کنید");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: "حذف عکس پروفایل",
      message: "عکس حذف می‌شود و به‌جایش حرف اول نام نشان داده می‌شود.",
      danger: true,
      confirmLabel: "حذف عکس",
    });
    if (!ok) return;
    if (kind === "customer") await setCustomerPhoto(id, null, name);
    else await setRepresentativePhoto(id, null, name);
    toast.info("عکس پروفایل حذف شد");
  };

  return (
    <div className="glass flex flex-wrap items-center gap-4 rounded-3xl p-5">
      {/* The photo itself — click to replace */}
      <button
        type="button"
        onClick={pick}
        disabled={busy}
        title={photo ? "تغییر عکس پروفایل" : "ثبت عکس پروفایل"}
        className="group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <Avatar photo={photo} name={name} size="lg" className={photo ? "shadow-lg shadow-ink-900/10" : ""} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ink-900/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-disabled:opacity-100">
          {busy ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} />}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-extrabold">{name}</p>
        {subtitle && <p className="mt-0.5 truncate text-[12px] text-ink-500 dark:text-ink-400">{subtitle}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="glass" icon={busy ? undefined : Camera} onClick={pick} disabled={busy}>
            {busy ? "در حال ذخیره…" : photo ? "تغییر عکس" : "ثبت عکس پروفایل"}
          </Button>
          {photo && (
            <Button size="sm" variant="glass" icon={Eye} onClick={() => setViewing(true)}>
              مشاهده عکس
            </Button>
          )}
          {photo && (
            <Button size="sm" variant="ghost" icon={Trash2} className="!text-rose-600 dark:!text-rose-400" onClick={() => void remove()}>
              حذف عکس
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onFile(file);
        }}
      />

      {/* Full-size photo lightbox */}
      <Modal
        open={viewing && !!photo}
        onClose={() => setViewing(false)}
        title="عکس پروفایل"
        subtitle={name}
        size="sm"
        footer={
          <div className="flex items-center justify-between gap-2">
            <a
              className="btn btn-glass btn-sm"
              href={photo ?? undefined}
              download={`${name || "profile"}.jpg`}
              onClick={() => setViewing(false)}
            >
              دانلود عکس
            </a>
            <button className="btn btn-primary btn-sm" onClick={() => setViewing(false)}>
              بستن
            </button>
          </div>
        }
      >
        {photo && (
          <img
            src={photo}
            alt={name}
            className="mx-auto max-h-[64vh] rounded-3xl border border-ink-900/5 object-contain dark:border-white/10"
          />
        )}
      </Modal>
    </div>
  );
}
