import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  DatabaseBackup,
  FileArchive,
  FileUp,
  HardDriveDownload,
  KeyRound,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { SectionCard } from "../components/ui/inputs";
import { GlassCard } from "../components/ui/GlassCard";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { FormField, Input } from "../components/ui/fields";
import { RadioSelect } from "../components/ui/inputs";
import { db } from "../db/schema";
import {
  applyRestore,
  buildAttachmentsZip,
  buildBackup,
  buildRestorePreview,
  encryptBackup,
  exportBackupFile,
  getStorageStats,
  readBackupFile,
  type RestorePreview,
  type RestoreMode,
} from "../utils/backup";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { formatNumber } from "../utils/num";
import { formatTimestamp, toPersianDigits } from "../utils/jalali";

export function BackupPage() {
  const toast = useToast();
  const { confirm } = useConfirm();

  const [stats, setStats] = useState<Awaited<ReturnType<typeof getStorageStats>> | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [useEncryption, setUseEncryption] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<number | null>(null);

  const [restoreState, setRestoreState] = useState<{
    preview: RestorePreview;
    mode: RestoreMode;
  } | null>(null);
  const [needsPassword, setNeedsPassword] = useState<{ file: File } | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStats = async () => {
    setStats(await getStorageStats());
    const last = localStorage.getItem("customer2-last-backup");
    setLastBackup(last ? Number(last) : null);
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  const createBackup = async () => {
    if (useEncryption && password.length < 6) {
      toast.error("رمز عبور حداقل ۶ نویسه باشد");
      return;
    }
    if (useEncryption && password !== password2) {
      toast.error("تکرار رمز عبور مطابقت ندارد");
      return;
    }
    setBusy("backup");
    try {
      const backup = await buildBackup();
      if (useEncryption) {
        const encrypted = await encryptBackup(backup, password);
        const blob = new Blob([JSON.stringify(encrypted, null, 2)], {
          type: "application/json",
        });
        const stamp = new Date().toISOString().slice(0, 10);
        const { downloadBlob } = await import("../utils/export/tabular");
        downloadBlob(blob, `customer2-backup-encrypted-${stamp}.json`);
        localStorage.setItem("customer2-last-backup", String(Date.now()));
      } else {
        exportBackupFile(backup);
      }
      toast.success("فایل پشتیبان دانلود شد");
      setPassword("");
      setPassword2("");
      await refreshStats();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ساخت پشتیبان");
    } finally {
      setBusy(null);
    }
  };

  const createZip = async () => {
    setBusy("zip");
    setZipProgress(0);
    try {
      await buildAttachmentsZip((p) => setZipProgress(p));
      toast.success("بایگانی ZIP پیوست‌ها دانلود شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ساخت بایگانی");
    } finally {
      setBusy(null);
      setZipProgress(null);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = await readBackupFile(file);
      const preview = await buildRestorePreview(backup);
      setRestoreState({ preview, mode: "merge" });
    } catch (e) {
      if (e instanceof Error && e.message === "ENCRYPTED") {
        setNeedsPassword({ file });
        setRestorePassword("");
        return;
      }
      toast.error(e instanceof Error ? e.message : "فایل نامعتبر است");
    }
  };

  const decryptAndPreview = async () => {
    if (!needsPassword) return;
    try {
      const backup = await readBackupFile(needsPassword.file, restorePassword);
      const preview = await buildRestorePreview(backup);
      setNeedsPassword(null);
      setRestoreState({ preview, mode: "merge" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در رمزگشایی");
    }
  };

  const apply = async () => {
    if (!restoreState) return;
    const { preview, mode } = restoreState;
    const ok = await confirm({
      title: mode === "replace" ? "جایگزینی کامل داده‌ها" : "ادغام داده‌ها",
      message:
        mode === "replace"
          ? "همه داده‌های فعلی حذف و با محتوای فایل پشتیبان جایگزین می‌شود. توصیه می‌کنیم قبل از ادامه، یک پشتیبان از وضعیت فعلی بگیرید."
          : "رکوردهای هم‌شناسه با نسخه پشتیبان جایگزین می‌شوند و بقیه داده‌های فعلی دست‌نخورده می‌مانند.",
      danger: mode === "replace",
      confirmLabel: mode === "replace" ? "جایگزینی قطعی" : "شروع ادغام",
    });
    if (!ok) return;
    setBusy("restore");
    try {
      const result = await applyRestore(preview.backup, mode);
      toast.success(
        `بازیابی انجام شد — ${toPersianDigits(result.inserted)} رکورد جدید، ${toPersianDigits(result.updated)} به‌روزرسانی`,
      );
      setRestoreState(null);
      await refreshStats();
    } catch (e) {
      console.error(e);
      toast.error("خطا در بازیابی — داده‌ها تغییر نکرد");
    } finally {
      setBusy(null);
    }
  };

  const wipeAll = async () => {
    const ok = await confirm({
      title: "پاک کردن همه داده‌ها",
      message: "همه مشتریان، نمایندگان، درخواست‌ها، پرداخت‌ها، لیست‌ها، تگ‌ها و تنظیمات حذف می‌شوند. قبل از ادامه حتماً پشتیبان بگیرید!",
      danger: true,
      confirmLabel: "پاک کردن همه",
    });
    if (!ok) return;
    const ok2 = await confirm({
      title: "آخرین تأیید",
      message: "این عمل کاملاً بازگشت‌ناپذیر است. مطمئن هستید؟",
      danger: true,
      confirmLabel: "بله، همه را پاک کن",
    });
    if (!ok2) return;
    await db.transaction(
      "rw",
      [
        db.representatives,
        db.customers,
        db.requests,
        db.lists,
        db.payments,
        db.tags,
        db.visaTypes,
        db.customFields,
        db.activities,
        db.preferences,
      ],
      async () => {
        await Promise.all([
          db.representatives.clear(),
          db.customers.clear(),
          db.requests.clear(),
          db.lists.clear(),
          db.payments.clear(),
          db.tags.clear(),
          db.visaTypes.clear(),
          db.customFields.clear(),
          db.activities.clear(),
          db.preferences.clear(),
        ]);
      },
    );
    toast.info("همه داده‌ها پاک شد");
    await refreshStats();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="پشتیبان‌گیری و بازیابی"
        subtitle="داده‌ها فقط در مرورگر شما (IndexedDB) ذخیره می‌شوند — پشتیبان منظم فراموش نشود"
      />

      {/* Status */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">آخرین پشتیبان</p>
          <p className="mt-1 text-[13px] font-bold">
            {lastBackup ? formatTimestamp(lastBackup) : "هنوز تهیه نشده"}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">رکوردهای اصلی</p>
          <p className="num mt-1 text-[13px] font-bold">
            {stats
              ? toPersianDigits(
                  stats.tableCounts.customers +
                    stats.tableCounts.requests +
                    stats.tableCounts.representatives +
                    stats.tableCounts.payments,
                )
              : "…"}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">پیوست‌ها</p>
          <p className="num mt-1 text-[13px] font-bold">
            {stats
              ? `${toPersianDigits(stats.attachments.count)} فایل (${formatNumber(
                  Math.round(stats.attachments.bytes / 1024),
                )} کیلوبایت)`
              : "…"}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">نسخه ساختار داده</p>
          <p className="num mt-1 text-[13px] font-bold">{toPersianDigits(db.verno)}</p>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Create backup */}
        <SectionCard title="ایجاد پشتیبان JSON" icon={<DatabaseBackup size={15} className="text-brand-500" />}>
          <div className="flex flex-col gap-3.5">
            <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
              شامل همه مشتریان، نمایندگان، درخواست‌ها، لیست‌ها، پرداخت‌ها، تگ‌ها، فیلدهای
              سفارشی و تنظیمات — بدون تصاویر (برای تصاویر از بایگانی ZIP استفاده کنید). بخش
              <b> حسابداری </b>جداگانه است و در این پشتیبان نمی‌آید — پشتیبان مخصوص آن، داخل
              خود بخش حسابداری قرار دارد.
            </p>
            <div className="flex items-center justify-between rounded-2xl bg-brand-500/6 px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-bold">
                <KeyRound size={15} className="text-brand-500" />
                رمزنگاری با رمز عبور
              </div>
              <RadioSelect
                options={[
                  { value: "no", label: "خیر" },
                  { value: "yes", label: "بله" },
                ]}
                value={useEncryption ? "yes" : "no"}
                onChange={(v) => setUseEncryption(v === "yes")}
              />
            </div>
            {useEncryption && (
              <div className="grid grid-cols-2 gap-3">
                <FormField label="رمز عبور" hint="حداقل ۶ نویسه">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
                <FormField label="تکرار رمز عبور">
                  <Input
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                  />
                </FormField>
              </div>
            )}
            <Button
              variant="primary"
              icon={HardDriveDownload}
              loading={busy === "backup"}
              onClick={() => void createBackup()}
            >
              دانلود فایل پشتیبان
            </Button>
          </div>
        </SectionCard>

        {/* Attachments zip */}
        <SectionCard title="بایگانی تصاویر و پیوست‌ها" icon={<FileArchive size={15} className="text-brand-500" />}>
          <div className="flex flex-col gap-3.5">
            <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
              همه عکس‌های پاسپورت و تذکره در یک فایل ZIP، به تفکیک پوشه هر مشتری. چون حجم
              تصاویر بالاست، در فایل JSON پشتیبان قرار نمی‌گیرند. (اسناد بخش حسابداری در
              همین بایگانی نیست — بایگانی اسناد حسابداری داخل خود آن بخش است.)
            </p>
            <Button
              variant="glass"
              icon={FileArchive}
              loading={busy === "zip"}
              disabled={(stats?.attachments.count ?? 0) === 0}
              onClick={() => void createZip()}
            >
              {zipProgress != null ? `در حال ساخت… ${toPersianDigits(zipProgress)}٪` : "دانلود بایگانی ZIP"}
            </Button>
          </div>
        </SectionCard>
      </div>

      {/* Restore */}
      <SectionCard title="بازیابی از فایل پشتیبان" icon={<FileUp size={15} className="text-brand-500" />}>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
            فایل JSON پشتیبان را انتخاب کنید؛ ابتدا پیش‌نمایش می‌بینید، بعد روش بازیابی را
            انتخاب می‌کنید. هیچ رکوردی بدون تأیید شما بازنویسی نمی‌شود.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant="primary" icon={FileUp} onClick={() => fileInputRef.current?.click()}>
            انتخاب فایل پشتیبان
          </Button>
        </div>
      </SectionCard>

      {/* Danger zone */}
      <GlassCard className="border-[#ef4444]/25 p-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-[#ef4444]">
          <ShieldAlert size={16} /> منطقه خطر
        </div>
        <p className="mb-3 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
          پاک کردن دائمی همه داده‌های برنامه. توجه: پاک کردن حافظه مرورگر یا عوض کردن پروفایل
          مرورگر هم همین اثر را دارد — پس پشتیبان‌های دانلودشده را جای امنی نگه دارید.
        </p>
        <button className="btn btn-danger btn-sm" onClick={() => void wipeAll()}>
          <Trash2 size={14} /> پاک کردن همه داده‌ها
        </button>
      </GlassCard>

      {/* Restore preview modal */}
      <Modal
        open={restoreState != null}
        onClose={() => setRestoreState(null)}
        title="پیش‌نمایش بازیابی"
        size="md"
        footer={
          <div className="flex items-center justify-between gap-3">
            <button className="btn btn-ghost btn-sm" onClick={() => setRestoreState(null)}>
              انصراف
            </button>
            <Button variant="primary" loading={busy === "restore"} onClick={() => void apply()}>
              شروع بازیابی
            </Button>
          </div>
        }
      >
        {restoreState && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
              {Object.entries(restoreState.preview.backup.counts).map(([k, v]) => (
                <div key={k} className="glass-soft rounded-xl px-3 py-2">
                  <span className="text-ink-500 dark:text-ink-400">{TABLE_LABELS[k] ?? k}: </span>
                  <span className="num font-bold">{toPersianDigits(v)}</span>
                </div>
              ))}
            </div>

            {restoreState.preview.warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-2xl bg-[#f59e0b]/10 px-3.5 py-3 text-xs leading-5 text-[#c77d0a]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                {restoreState.preview.warnings.join(" ")}
              </div>
            )}

            <div className="rounded-2xl bg-brand-500/6 px-3.5 py-3 text-[12px] leading-5">
              رکوردهای تکراری با داده‌های فعلی:{" "}
              <b className="num">{toPersianDigits(restoreState.preview.duplicates)}</b> — در حالت
              «ادغام» جایگزین می‌شوند.
            </div>

            <FormField label="روش بازیابی">
              <RadioSelect
                options={[
                  { value: "merge", label: "ادغام" },
                  { value: "replace", label: "جایگزینی کامل" },
                ]}
                value={restoreState.mode}
                onChange={(v) => setRestoreState({ ...restoreState, mode: v as RestoreMode })}
              />
            </FormField>
            <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">
              {restoreState.mode === "merge"
                ? "ادغام: رکوردهای موجود در فایل، روی رکوردهای هم‌شناسه فعلی نوشته می‌شوند؛ داده‌های دیگری که فقط در دستگاه فعلی وجود دارند حفظ می‌شوند."
                : "جایگزینی کامل: همه داده‌های فعلی پاک و فقط محتوای فایل پشتیبان باقی می‌ماند."}
            </p>
          </div>
        )}
      </Modal>

      {/* Password modal for encrypted backups */}
      <Modal
        open={needsPassword != null}
        onClose={() => setNeedsPassword(null)}
        title="فایل پشتیبان رمزنگاری‌شده"
        size="sm"
      >
        <FormField label="رمز عبور فایل پشتیبان">
          <Input
            type="password"
            value={restorePassword}
            onChange={(e) => setRestorePassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void decryptAndPreview()}
          />
        </FormField>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setNeedsPassword(null)}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={() => void decryptAndPreview()}>
            {busy === "restore" ? <Loader2 size={15} className="animate-spin" /> : null}
            رمزگشایی
          </button>
        </div>
      </Modal>
    </div>
  );
}

const TABLE_LABELS: Record<string, string> = {
  representatives: "نمایندگان",
  customers: "مشتریان",
  requests: "درخواست‌ها",
  lists: "لیست‌ها",
  payments: "پرداخت‌ها",
  tags: "تگ‌ها",
  visaTypes: "انواع ویزا",
  customFields: "فیلدهای سفارشی",
  activities: "فعالیت‌ها",
  attachments: "پیوست‌ها",
};
