import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  DatabaseBackup,
  FileArchive,
  FileUp,
  HardDriveDownload,
  KeyRound,
  Loader2,
  ShieldAlert,
  Trash2,
  X,
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
  buildAttachmentsZip,
  buildBackup,
  exportBackupFile,
  getStorageStats,
} from "../utils/backup";
import {
  applyAnyRestore,
  BackupCancelledError,
  buildFullZipBackup,
  buildUnifiedPreview,
  readAnyBackupFile,
  type AnyBackup,
  type BackupProgress,
  type RestoreMode,
  type UnifiedPreview,
} from "../utils/zipbackup";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { formatNumber } from "../utils/num";
import { formatTimestamp, toPersianDigits } from "../utils/jalali";

const PHASE_LABELS: Record<BackupProgress["phase"], string> = {
  reading: "در حال خواندن داده‌ها",
  packing: "در حال ساخت فایل ZIP",
  encrypting: "در حال رمزنگاری",
  validating: "در حال بررسی صحت بایگانی",
  writing: "در حال بازنویسی داده‌ها",
  verifying: "در حال تأیید نهایی",
  done: "آماده",
};

function ProgressLine({ progress }: { progress: BackupProgress }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px] text-ink-500 dark:text-ink-400">
        <span>{PHASE_LABELS[progress.phase]}</span>
        <span className="num font-bold">{toPersianDigits(progress.percent)}٪</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-500/10">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${formatNumber(bytes / (1024 * 1024))} مگابایت`;
  return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

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
  const [progress, setProgress] = useState<BackupProgress | null>(null);

  const [restoreState, setRestoreState] = useState<{
    any: AnyBackup;
    preview: UnifiedPreview;
    mode: RestoreMode;
  } | null>(null);
  const [needsPassword, setNeedsPassword] = useState<{ file: File } | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const refreshStats = async () => {
    setStats(await getStorageStats());
    const last = localStorage.getItem("customer2-last-backup");
    setLastBackup(last ? Number(last) : null);
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  /* ------------------------------- backup -------------------------------- */

  const createBackup = async () => {
    if (useEncryption && password.length < 6) {
      toast.error("رمز عبور حداقل ۶ نویسه باشد");
      return;
    }
    if (useEncryption && password !== password2) {
      toast.error("تکرار رمز عبور مطابقت ندارد");
      return;
    }
    cancelRef.current = false;
    setBusy("backup");
    setProgress({ phase: "reading", percent: 0 });
    try {
      const { downloadBlob } = await import("../utils/export/tabular");
      const built = await buildFullZipBackup({
        password: useEncryption ? password : null,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
      downloadBlob(built.blob, built.filename);
      localStorage.setItem("customer2-last-backup", String(Date.now()));
      toast.success(
        useEncryption ? "پشتیبان کامل رمزنگاری‌شده دانلود شد" : "پشتیبان کامل دانلود شد",
      );
      setPassword("");
      setPassword2("");
      await refreshStats();
    } catch (e) {
      if (e instanceof BackupCancelledError) {
        toast.info("ساخت پشتیبان لغو شد");
      } else {
        console.error(e);
        toast.error(e instanceof Error ? e.message : "خطا در ساخت پشتیبان");
      }
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const createLegacyJson = async () => {
    setBusy("json");
    try {
      exportBackupFile(await buildBackup());
      toast.success("پشتیبان JSON قدیمی دانلود شد");
      await refreshStats();
    } catch (e) {
      console.error(e);
      toast.error("خطا در ساخت پشتیبان JSON");
    } finally {
      setBusy(null);
    }
  };

  const createBrowseZip = async () => {
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

  /* ------------------------------- restore ------------------------------- */

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("parse");
    setProgress({ phase: "validating", percent: 0 });
    try {
      const any = await readAnyBackupFile(file);
      const preview = await buildUnifiedPreview(any);
      setRestoreState({ any, preview, mode: "merge" });
    } catch (e) {
      if (e instanceof Error && e.message === "ENCRYPTED") {
        setNeedsPassword({ file });
        setRestorePassword("");
        return;
      }
      toast.error(e instanceof Error ? e.message : "فایل نامعتبر است");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const decryptAndPreview = async () => {
    if (!needsPassword) return;
    setBusy("parse");
    try {
      const any = await readAnyBackupFile(needsPassword.file, restorePassword);
      const preview = await buildUnifiedPreview(any);
      setNeedsPassword(null);
      setRestoreState({ any, preview, mode: "merge" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در رمزگشایی");
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!restoreState) return;
    const { any, mode } = restoreState;
    const ok = await confirm({
      title: mode === "replace" ? "جایگزینی کامل داده‌ها" : "ادغام داده‌ها",
      message:
        mode === "replace"
          ? "همه داده‌های فعلی (شامل تصاویر و پیوست‌ها) حذف و با محتوای فایل پشتیبان جایگزین می‌شود. توصیه می‌کنیم قبل از ادامه، یک پشتیبان از وضعیت فعلی بگیرید."
          : "رکوردهای هم‌شناسه با نسخه پشتیبان جایگزین می‌شوند و بقیه داده‌های فعلی دست‌نخورده می‌مانند.",
      danger: mode === "replace",
      confirmLabel: mode === "replace" ? "جایگزینی قطعی" : "شروع ادغام",
    });
    if (!ok) return;
    setBusy("restore");
    setProgress({ phase: "writing", percent: 78 });
    try {
      const result = await applyAnyRestore(any, mode, setProgress);
      toast.success(
        `بازیابی انجام شد — ${toPersianDigits(result.inserted)} رکورد جدید، ${toPersianDigits(
          result.updated,
        )} به‌روزرسانی، ${toPersianDigits(result.attachments)} پیوست`,
      );
      setRestoreState(null);
      await refreshStats();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "خطا در بازیابی — داده‌ها تغییر نکرد");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const wipeAll = async () => {
    const ok = await confirm({
      title: "پاک کردن همه داده‌ها",
      message:
        "همه مشتریان، نمایندگان، درخواست‌ها، پرداخت‌ها، لیست‌ها، تگ‌ها، مدارک، تصاویر و پیوست‌ها و تنظیمات حذف می‌شوند. قبل از ادامه حتماً پشتیبان بگیرید!",
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
        db.docTypes,
        db.attachments,
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
          db.docTypes.clear(),
          db.attachments.clear(),
        ]);
      },
    );
    toast.info("همه داده‌ها پاک شد");
    await refreshStats();
  };

  /* -------------------------------- render ------------------------------- */

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
        {/* Full ZIP backup */}
        <SectionCard
          title="پشتیبان کامل (ZIP)"
          icon={<FileArchive size={15} className="text-brand-500" />}
        >
          <div className="flex flex-col gap-3.5">
            <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
              <b>همه‌چیز در یک فایل:</b> مشتریان، نمایندگان، درخواست‌ها، پرداخت‌ها، لیست‌ها،
              تنظیمات و <b>همه تصاویر و فایل‌های PDF</b> — قابل بازیابی کامل در همین برنامه.
              بخش <b>حسابداری</b> جداگانه است و پشتیبان مخصوص خودش را داخل همان بخش دارد.
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
              <>
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
                <p className="rounded-2xl bg-brand-500/6 px-3.5 py-2.5 text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                  در حالت رمزنگاری‌شده، تنظیمات هوش مصنوعی (آدرس و کلید اکانت‌ها) هم داخل
                  پشتیبان قرار می‌گیرد؛ بدون رمز، کلیدها به دلایل امنیتی در فایل نمی‌آیند.
                </p>
              </>
            )}
            {progress && busy === "backup" && <ProgressLine progress={progress} />}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                icon={HardDriveDownload}
                loading={busy === "backup"}
                disabled={busy != null}
                onClick={() => void createBackup()}
                className="flex-1"
              >
                دانلود پشتیبان کامل (ZIP)
              </Button>
              {busy === "backup" && (
                <Button
                  variant="glass"
                  icon={X}
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  لغو
                </Button>
              )}
            </div>
          </div>
        </SectionCard>

        {/* Other options */}
        <SectionCard
          title="گزینه‌های دیگر"
          icon={<Archive size={15} className="text-brand-500" />}
        >
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
                بایگانی ZIP تصاویر به تفکیک پوشهٔ هر مشتری — فقط برای مرور فایل‌ها در خارج از
                برنامه (قابل بازیابی نیست؛ برای بازیابی از پشتیبان کامل بالا استفاده کنید).
              </p>
              <Button
                variant="glass"
                icon={FileArchive}
                loading={busy === "zip"}
                disabled={busy != null || (stats?.attachments.count ?? 0) === 0}
                onClick={() => void createBrowseZip()}
              >
                {zipProgress != null
                  ? `در حال ساخت… ${toPersianDigits(zipProgress)}٪`
                  : "بایگانی پوشه‌ای تصاویر (ZIP)"}
              </Button>
            </div>
            <div className="border-t border-ink-500/8 pt-3.5 dark:border-white/8">
              <p className="mb-2 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
                پشتیبان JSON قدیمی (بدون تصاویر) — فقط برای سازگاری با نسخه‌های قبلی.
              </p>
              <Button
                variant="glass"
                icon={DatabaseBackup}
                loading={busy === "json"}
                disabled={busy != null}
                onClick={() => void createLegacyJson()}
              >
                دانلود پشتیبان JSON قدیمی
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Restore */}
      <SectionCard title="بازیابی از فایل پشتیبان" icon={<FileUp size={15} className="text-brand-500" />}>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
            فایل پشتیبان <b>ZIP کامل</b> (معمولی یا رمزنگاری‌شده) یا فایل <b>JSON قدیمی</b> را
            انتخاب کنید. ابتدا محتوای فایل بررسی و پیش‌نمایش داده می‌شود، بعد روش بازیابی را
            انتخاب می‌کنید — هیچ رکوردی بدون تأیید شما بازنویسی نمی‌شود.
          </p>
          {progress && (busy === "parse" || busy === "restore") && (
            <ProgressLine progress={progress} />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.enc,.json,application/zip,application/json,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              void onPickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            variant="primary"
            icon={FileUp}
            loading={busy === "parse"}
            disabled={busy != null}
            onClick={() => fileInputRef.current?.click()}
          >
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
          پاک کردن دائمی همه داده‌های برنامه (شامل تصاویر و پیوست‌ها). توجه: پاک کردن حافظه
          مرورگر یا عوض کردن پروفایل مرورگر هم همین اثر را دارد — پس پشتیبان‌های دانلودشده را
          جای امنی نگه دارید.
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
            <Button
              variant="primary"
              loading={busy === "restore"}
              disabled={busy === "restore"}
              onClick={() => void apply()}
            >
              شروع بازیابی
            </Button>
          </div>
        }
      >
        {restoreState && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
              {Object.entries(restoreState.preview.counts).map(([k, v]) => (
                <div key={k} className="glass-soft rounded-xl px-3 py-2">
                  <span className="text-ink-500 dark:text-ink-400">{TABLE_LABELS[k] ?? k}: </span>
                  <span className="num font-bold">{toPersianDigits(v)}</span>
                </div>
              ))}
            </div>

            {restoreState.preview.attachments ? (
              <div className="rounded-2xl bg-brand-500/6 px-3.5 py-3 text-[12px] leading-5">
                پیوست‌ها در این پشتیبان:{" "}
                <b className="num">
                  {toPersianDigits(restoreState.preview.attachments.count)} فایل (
                  {bytesLabel(restoreState.preview.attachments.bytes)})
                </b>{" "}
                — تصاویر و PDFها همراه رکوردها کامل بازیابی می‌شوند.
              </div>
            ) : (
              <div className="rounded-2xl bg-[#f59e0b]/10 px-3.5 py-3 text-xs leading-5 text-[#c77d0a]">
                این پشتیبان JSON قدیمی است و تصاویر را شامل نمی‌شود.
              </div>
            )}

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
                onChange={(v) =>
                  setRestoreState({ ...restoreState, mode: v as RestoreMode })
                }
              />
            </FormField>
            <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">
              {restoreState.mode === "merge"
                ? "ادغام: رکوردهای موجود در فایل، روی رکوردهای هم‌شناسه فعلی نوشته می‌شوند؛ داده‌های دیگری که فقط در دستگاه فعلی وجود دارند حفظ می‌شوند."
                : "جایگزینی کامل: همه داده‌های فعلی (شامل تصاویر و پیوست‌ها) پاک و فقط محتوای فایل پشتیبان باقی می‌ماند."}
            </p>
          </div>
        )}
      </Modal>

      {/* Password modal for encrypted backups (ZIP envelope or legacy JSON) */}
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
            {busy === "parse" ? <Loader2 size={15} className="animate-spin" /> : null}
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
  docTypes: "انواع مدرک",
  activities: "فعالیت‌ها",
  attachments: "پیوست‌ها",
};
