/** Accounting backup (complete ZIP system), restore, exports and settings. */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  DatabaseBackup,
  FileArchive,
  FileDown,
  FileUp,
  HardDriveDownload,
  Info,
  KeyRound,
  Loader2,
  Plus,
  Settings2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "../../components/ui/StatCard";
import { Button } from "../../components/ui/Button";
import { SectionCard, FilterSelect, RadioSelect } from "../../components/ui/inputs";
import { GlassCard } from "../../components/ui/GlassCard";
import { Modal } from "../../components/ui/Modal";
import { Input, FormField } from "../../components/ui/fields";
import { ExportDialog } from "../../components/exports/ExportDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { db } from "../../db/schema";
import { resetAccounting, updateAccSettings } from "../../accounting/repo";
import { buildAccBackup, buildAccDocsZip, exportAccBackupFile } from "../../accounting/backup";
import {
  applyAnyAccRestore,
  buildAccUnifiedPreview,
  buildFullAccZipBackup,
  createAccSafetyZipBackup,
  getAccStorageStats,
  readAnyAccBackupFile,
  type AccBackupProgress,
  type AnyAccBackup,
  type AccRestoreMode,
  type AccUnifiedPreview,
} from "../../accounting/zipbackup";
import {
  useAccAccounts,
  useAccOutstanding,
  useAccParties,
  useAccSettings,
  useAccTransactions,
} from "../../accounting/hooks";
import { outstandingRemaining } from "../../accounting/engine";
import { formatJalali, formatTimestamp, toPersianDigits } from "../../utils/jalali";
import { formatNumber } from "../../utils/num";
import type { Currency } from "../../types";

const PHASE_LABELS: Record<AccBackupProgress["phase"], string> = {
  reading: "در حال خواندن داده‌ها",
  packing: "در حال ساخت فایل ZIP",
  encrypting: "در حال رمزنگاری",
  validating: "در حال بررسی صحت بایگانی",
  writing: "در حال بازنویسی داده‌ها",
  verifying: "در حال تأیید نهایی",
  done: "آماده",
};

function ProgressLine({ progress }: { progress: AccBackupProgress }) {
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

const TABLE_LABELS: Record<string, string> = {
  parties: "طرف حساب‌ها",
  accounts: "حساب‌ها",
  transactions: "تراکنش‌ها",
  outstanding: "مانده‌ها",
  docs: "اسناد",
};

export function AccBackupPage() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const settings = useAccSettings();

  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<AccBackupProgress | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getAccStorageStats>> | null>(null);
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [useEncryption, setUseEncryption] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [exportKind, setExportKind] = useState<null | "parties" | "transactions" | "accounts" | "outstanding">(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const [restoreState, setRestoreState] = useState<{
    any: AnyAccBackup;
    preview: AccUnifiedPreview;
    mode: AccRestoreMode;
  } | null>(null);
  const [needsPassword, setNeedsPassword] = useState<{ file: File } | null>(null);
  const [restorePassword, setRestorePassword] = useState("");

  const refreshStats = async () => {
    setStats(await getAccStorageStats());
    const last = localStorage.getItem("customer2-acc-last-backup");
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
      const { downloadBlob } = await import("../../utils/export/tabular");
      const built = await buildFullAccZipBackup({
        password: useEncryption ? password : null,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      });
      downloadBlob(built.blob, built.filename);
      localStorage.setItem("customer2-acc-last-backup", String(Date.now()));
      toast.success(
        useEncryption ? "پشتیبان کامل رمزنگاری‌شده حسابداری دانلود شد" : "پشتیبان کامل حسابداری دانلود شد",
      );
      setPassword("");
      setPassword2("");
      await refreshStats();
    } catch (e) {
      if (e instanceof Error && e.name === "BackupCancelledError") {
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
      exportAccBackupFile(await buildAccBackup());
      toast.success("پشتیبان JSON قدیمی حسابداری دانلود شد");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "خطا در ساخت پشتیبان JSON");
    } finally {
      setBusy(null);
    }
  };

  const createBrowseZip = async () => {
    setBusy("zip");
    try {
      await buildAccDocsZip((p) => {
        if (p === 100) toast.success("بایگانی ZIP اسناد دانلود شد");
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ساخت بایگانی ناموفق بود.");
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------- restore ------------------------------- */

  const previewFile = async (file: File, pw?: string) => {
    setBusy("parse");
    setProgress({ phase: "validating", percent: 0 });
    try {
      const any = await readAnyAccBackupFile(file, pw);
      const preview = await buildAccUnifiedPreview(any);
      setNeedsPassword(null);
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

  const apply = async () => {
    if (!restoreState) return;
    const { any, mode } = restoreState;
    const ok = await confirm({
      title: mode === "replace" ? "جایگزینی کامل حسابداری" : "ادغام داده‌های حسابداری",
      message:
        mode === "replace"
          ? "همه داده‌های فعلی بخش حسابداری (شامل فایل اسناد) حذف و با محتوای فایل پشتیبان جایگزین می‌شود. قبل از ادامه، یک پشتیبان ایمنی ZIP از وضعیت فعلی به‌طور خودکار دانلود می‌شود."
          : "رکوردهای هم‌شناسه با نسخه پشتیبان جایگزین می‌شوند و بقیه داده‌های فعلی دست‌نخورده می‌مانند.",
      danger: mode === "replace",
      confirmLabel: mode === "replace" ? "جایگزینی قطعی" : "شروع ادغام",
    });
    if (!ok) return;
    setBusy("restore");
    setProgress({ phase: "writing", percent: 78 });
    try {
      if (mode === "replace") {
        // Full ZIP safety net (with every document file) before wiping.
        const safety = await createAccSafetyZipBackup();
        if (safety) {
          const { downloadBlob } = await import("../../utils/export/tabular");
          downloadBlob(safety.blob, `emanagement-acc-safety-${Date.now()}.zip`);
        }
      }
      const result = await applyAnyAccRestore(any, mode, setProgress);
      toast.success(
        `بازیابی انجام شد — ${toPersianDigits(result.inserted)} رکورد جدید، ${toPersianDigits(
          result.updated,
        )} به‌روزرسانی، ${toPersianDigits(result.docs)} سند`,
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

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    if (settings.categories.includes(name)) {
      toast.error("این دسته از قبل وجود دارد.");
      return;
    }
    await updateAccSettings({ categories: [...settings.categories, name] });
    setNewCategory("");
    toast.success("دسته اضافه شد");
  };

  const doReset = async () => {
    const ok = await confirm({
      title: "ریست کامل حسابداری",
      message:
        "همه طرف حساب‌ها، صندوق‌ها و بانک‌ها، تراکنش‌ها، مانده‌ها و اسناد (همراه فایل‌ها) بخش حسابداری برای همیشه پاک می‌شوند. قبل از پاک‌سازی، یک پشتیبان ایمنی کامل ZIP به‌طور خودکار دانلود می‌شود. داده‌های اصلی برنامه (مشتریان و ویزاها) دست‌نخورده می‌مانند.",
      confirmLabel: "بله، همه چیز را پاک کن",
      danger: true,
    });
    if (!ok) return;
    setBusy("reset");
    try {
      const safety = await createAccSafetyZipBackup();
      if (safety) {
        const { downloadBlob } = await import("../../utils/export/tabular");
        downloadBlob(safety.blob, `emanagement-acc-safety-${Date.now()}.zip`);
      }
      await resetAccounting();
      setRestoreState(null);
      toast.success("بخش حسابداری ریست شد — پشتیبان ایمنی کامل دانلود شد");
      await refreshStats();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ریست ناموفق بود.");
    } finally {
      setBusy(null);
    }
  };

  const exportDefs = {
    parties: {
      title: "فهرست طرف حساب‌ها",
      columns: [
        { key: "code", header: "کد حساب" },
        { key: "name", header: "نام" },
        { key: "type", header: "نوع" },
        { key: "phone", header: "تلفن" },
        { key: "email", header: "ایمیل" },
        { key: "idNumber", header: "شناسه" },
        { key: "active", header: "وضعیت" },
      ] as { key: string; header: string }[],
      rows: [] as Record<string, string>[],
    },
    transactions: {
      title: "فهرست تراکنش‌ها",
      columns: [
        { key: "number", header: "شماره" },
        { key: "date", header: "تاریخ" },
        { key: "amount", header: "مبلغ" },
        { key: "currency", header: "ارز" },
        { key: "type", header: "نوع" },
        { key: "status", header: "وضعیت" },
      ] as { key: string; header: string }[],
      rows: [] as Record<string, string>[],
    },
    accounts: {
      title: "فهرست حساب‌ها",
      columns: [
        { key: "name", header: "نام" },
        { key: "type", header: "نوع" },
        { key: "currency", header: "ارز" },
        { key: "active", header: "وضعیت" },
      ] as { key: string; header: string }[],
      rows: [] as Record<string, string>[],
    },
    outstanding: {
      title: "فهرست مانده‌ها",
      columns: [
        { key: "party", header: "طرف حساب" },
        { key: "kind", header: "نوع" },
        { key: "amount", header: "مبلغ" },
        { key: "remaining", header: "مانده" },
        { key: "status", header: "وضعیت" },
      ] as { key: string; header: string }[],
      rows: [] as Record<string, string>[],
    },
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={DatabaseBackup}
        title="پشتیبان و تنظیمات حسابداری"
        subtitle="پشتیبان کامل با فایل‌ها، بازیابی امن و تنظیمات بخش مالی"
      />

      {/* Status */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">آخرین پشتیبان حسابداری</p>
          <p className="mt-1 text-[13px] font-bold">
            {lastBackup ? formatTimestamp(lastBackup) : "هنوز تهیه نشده"}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">رکوردهای مالی</p>
          <p className="num mt-1 text-[13px] font-bold">
            {stats
              ? toPersianDigits(
                  stats.records.parties +
                    stats.records.accounts +
                    stats.records.transactions +
                    stats.records.outstanding,
                )
              : "…"}
          </p>
        </GlassCard>
        <GlassCard className="p-4">
          <p className="text-[11px] text-ink-500 dark:text-ink-400">اسناد حسابداری</p>
          <p className="num mt-1 text-[13px] font-bold">
            {stats
              ? `${toPersianDigits(stats.docs.count)} فایل (${bytesLabel(stats.docs.bytes)})`
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
        <SectionCard title="پشتیبان کامل (ZIP)" icon={<FileArchive size={15} className="text-brand-500" />}>
          <div className="flex flex-col gap-3.5">
            <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
              <b>همه‌چیز در یک فایل:</b> طرف حساب‌ها، صندوق‌ها و بانک‌ها، همه تراکنش‌ها، مطالبات و
              بدهی‌ها، تنظیمات و <b>خود فایل اسناد (تصاویر و PDFها)</b> — قابل بازیابی کامل در همین
              بخش.
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
        <SectionCard title="گزینه‌های دیگر" icon={<Archive size={15} className="text-brand-500" />}>
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-2">
              <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
                بایگانی ZIP اسناد به تفکیک پوشهٔ هر طرف حساب — فقط برای مرور فایل‌ها در خارج از
                برنامه (قابل بازیابی نیست؛ برای بازیابی از پشتیبان کامل بالا استفاده کنید).
              </p>
              <Button
                variant="glass"
                icon={FileArchive}
                loading={busy === "zip"}
                disabled={busy != null || (stats?.docs.count ?? 0) === 0}
                onClick={() => void createBrowseZip()}
              >
                بایگانی پوشه‌ای اسناد (ZIP)
              </Button>
            </div>
            <div className="border-t border-ink-500/8 pt-3.5 dark:border-white/8">
              <p className="mb-2 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
                پشتیبان JSON قدیمی حسابداری (بدون فایل اسناد) — فقط برای سازگاری با نسخه‌های قبلی.
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
            فایل پشتیبان <b>ZIP کامل حسابداری</b> (معمولی یا رمزنگاری‌شده) یا فایل <b>JSON قدیمی</b>{" "}
            حسابداری را انتخاب کنید. ابتدا محتوای فایل بررسی و پیش‌نمایش داده می‌شود، بعد روش بازیابی را
            انتخاب می‌کنید — هیچ رکوردی بدون تأیید شما بازنویسی نمی‌شود.
          </p>
          {progress && (busy === "parse" || busy === "restore") && <ProgressLine progress={progress} />}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.enc,.json,application/zip,application/json,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void previewFile(f);
              e.target.value = "";
            }}
          />
          <div>
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
        </div>
      </SectionCard>

      {/* Data-only exports */}
      <SectionCard title="خروجی داده‌ای (اکسل / CSV / PDF / تصویر)" icon={<FileDown size={15} className="text-brand-500" />}>
        <p className="mb-3 text-xs leading-6 text-ink-500 dark:text-ink-400">
          این خروجی‌ها برای گزارش‌گیری و اشتراک‌گذاری‌اند و «قابل بازیابی» نیستند؛ برای بازیابی فقط از
          پشتیبان کامل ZIP بالا استفاده کنید.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["parties", "transactions", "accounts", "outstanding"] as const).map((k) => (
            <Button key={k} size="sm" variant="glass" onClick={() => setExportKind(k)}>
              {exportDefs[k].title}
            </Button>
          ))}
        </div>
      </SectionCard>

      {/* Settings */}
      <SectionCard title="تنظیمات حسابداری" icon={<Settings2 size={15} className="text-brand-500" />}>
        <div className="flex flex-col gap-4">
          <div className="max-w-xs">
            <p className="mb-1.5 text-[13px] font-bold">ارز پیش‌فرض فرم تراکنش</p>
            <FilterSelect
              value={settings.defaultCurrency}
              onChange={async (v) => {
                await updateAccSettings({ defaultCurrency: v as Currency });
                toast.success("ارز پیش‌فرض ذخیره شد");
              }}
              options={[
                { value: "IRT", label: "تومان" },
                { value: "USD", label: "دلار" },
              ]}
            />
          </div>
          <div className="max-w-xs">
            <p className="mb-1.5 text-[13px] font-bold">پیشوند شماره تراکنش</p>
            <Input
              dir="ltr"
              className="text-left"
              defaultValue={settings.txPrefix}
              onBlur={async (e) => {
                const v = e.target.value.trim().replace(/[^A-Za-z]/g, "").slice(0, 5) || "TR";
                await updateAccSettings({ txPrefix: v });
                if (v !== settings.txPrefix) toast.success("پیشوند ذخیره شد");
              }}
              placeholder="TR"
            />
            <p className="mt-1 text-[11px] text-ink-400">
              شماره‌ها به شکل {settings.txPrefix || "TR"}-۱۴۰۴-۰۰۰۱ ساخته می‌شوند.
            </p>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-bold">دسته‌بندی‌های تراکنش</p>
            <div className="flex flex-wrap items-center gap-2">
              {settings.categories.map((c) => (
                <span
                  key={c}
                  className="flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1.5 text-xs font-bold text-brand-600 dark:text-brand-300"
                >
                  {c}
                  <button
                    onClick={async () => {
                      await updateAccSettings({ categories: settings.categories.filter((x) => x !== c) });
                      toast.success("دسته حذف شد");
                    }}
                    aria-label={`حذف ${c}`}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2.5 flex max-w-xs gap-2">
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="دسته جدید…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addCategory();
                }}
              />
              <Button size="sm" variant="glass" icon={Plus} onClick={() => void addCategory()}>
                افزودن
              </Button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Danger zone — full reset */}
      <GlassCard className="border-[#ef4444]/25 p-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-extrabold text-[#ef4444]">
          <ShieldAlert size={16} /> منطقه خطر — ریست کامل
        </div>
        <p className="mb-3 text-[12px] leading-6 text-ink-500 dark:text-ink-400">
          دکمه زیر کل بخش حسابداری را به روز اول برمی‌گرداند: طرف حساب‌ها، صندوق‌ها و بانک‌ها، همه
          تراکنش‌ها، مطالبات و بدهی‌ها و اسناد (همراه فایل‌ها) پاک می‌شوند و شماره‌گذاری‌ها از اول شروع
          می‌شود. پیش از پاک‌سازی، یک پشتیبان ایمنی کامل ZIP (شامل همه فایل‌ها) به‌طور خودکار دانلود
          می‌شود. داده‌های اصلی برنامه (مشتریان، ویزاها، پرداخت‌ها) دست‌نخورده می‌مانند.
        </p>
        <button className="btn btn-danger btn-sm" disabled={busy != null} onClick={() => void doReset()}>
          <Trash2 size={14} /> ریست کامل حسابداری
        </button>
      </GlassCard>

      {/* Backup vs export explanation */}
      <div className="glass flex items-start gap-3 rounded-3xl p-4 text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
        <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
        <p>
          <b className="text-ink-700 dark:text-ink-200">پشتیبان کامل ZIP</b> یعنی فایلی که کل بخش
          حسابداری را همراه روابط، شناسه‌ها و خود فایل اسناد برمی‌گرداند. <b className="text-ink-700 dark:text-ink-200">بایگانی پوشه‌ای</b> و{" "}
          <b className="text-ink-700 dark:text-ink-200">خروجی اکسل/PDF</b> فقط برای دیدن و گزارش‌دادن
          اند و قابل بازیابی نیستند. حسابداری بخشی جداست — پشتیبان اصلی برنامه شامل این داده‌ها
          نمی‌شود.
        </p>
      </div>

      {/* Restore preview modal */}
      <Modal
        open={restoreState != null}
        onClose={() => setRestoreState(null)}
        title="پیش‌نمایش بازیابی حسابداری"
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

            {restoreState.preview.docs ? (
              <div className="rounded-2xl bg-brand-500/6 px-3.5 py-3 text-[12px] leading-5">
                اسناد در این پشتیبان:{" "}
                <b className="num">
                  {toPersianDigits(restoreState.preview.docs.count)} فایل (
                  {bytesLabel(restoreState.preview.docs.bytes)})
                </b>{" "}
                — تصاویر و PDFها همراه رکوردها کامل بازیابی می‌شوند.
              </div>
            ) : (
              <div className="rounded-2xl bg-[#f59e0b]/10 px-3.5 py-3 text-xs leading-5 text-[#c77d0a]">
                این پشتیبان JSON قدیمی است و فایل‌های اسناد را شامل نمی‌شود.
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
                  setRestoreState({ ...restoreState, mode: v as AccRestoreMode })
                }
              />
            </FormField>
            <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">
              {restoreState.mode === "merge"
                ? "ادغام: رکوردهای موجود در فایل، روی رکوردهای هم‌شناسه فعلی نوشته می‌شوند؛ داده‌های دیگری که فقط در دستگاه فعلی وجود دارند حفظ می‌شوند."
                : "جایگزینی کامل: همه داده‌های فعلی حسابداری (شامل فایل اسناد) پاک و فقط محتوای فایل پشتیبان باقی می‌ماند. قبل از شروع، پشتیبان ایمنی ZIP دانلود می‌شود."}
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
            onKeyDown={(e) => e.key === "Enter" && needsPassword && void previewFile(needsPassword.file, restorePassword)}
          />
        </FormField>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setNeedsPassword(null)}>
            انصراف
          </button>
          <button
            className="btn btn-primary"
            onClick={() => needsPassword && void previewFile(needsPassword.file, restorePassword)}
          >
            {busy === "parse" ? <Loader2 size={15} className="animate-spin" /> : null}
            رمزگشایی
          </button>
        </div>
      </Modal>

      {/* Data exports */}
      {exportKind && (
        <DataOnlyExport
          kind={exportKind}
          onClose={() => setExportKind(null)}
          def={exportDefs[exportKind] as { title: string; columns: { key: string; header: string }[] }}
        />
      )}
    </div>
  );
}

/** Bridges live data into the shared ExportDialog for data-only exports. */
function DataOnlyExport({
  kind,
  onClose,
  def,
}: {
  kind: "parties" | "transactions" | "accounts" | "outstanding";
  onClose: () => void;
  def: { title: string; columns: { key: string; header: string }[] };
}) {
  const { useAccLiveRows } = useDataOnlyRows();
  const rows = useAccLiveRows(kind);
  return (
    <ExportDialog
      open
      onClose={onClose}
      title={def.title}
      columns={def.columns}
      rows={rows ?? []}
      defaultFilename={`acc-${kind}`}
      theme="acc"
    />
  );
}

function useDataOnlyRows() {
  return {
    useAccLiveRows(
      kind: "parties" | "transactions" | "accounts" | "outstanding",
    ): Record<string, string>[] | undefined {
      const parties = useAccParties();
      const transactions = useAccTransactions();
      const accounts = useAccAccounts();
      const outstanding = useAccOutstanding();
      switch (kind) {
        case "parties":
          return (parties ?? []).map((p) => ({
            code: p.code,
            name: p.name,
            type: p.type === "company" ? "شرکت" : "شخص حقیقی",
            phone: p.phone ?? "",
            email: p.email ?? "",
            idNumber: p.idNumber ?? "",
            active: p.active ? "فعال" : "غیرفعال",
          }));
        case "transactions":
          return (transactions ?? []).map((t) => ({
            number: t.number,
            date: formatJalali(t.date),
            amount: t.amount.toLocaleString("fa-IR"),
            currency: t.currency === "USD" ? "دلار" : "تومان",
            type: t.type,
            status: t.status,
          }));
        case "accounts":
          return (accounts ?? []).map((a) => ({
            name: a.name,
            type: a.type,
            currency: a.currency === "USD" ? "دلار" : "تومان",
            active: a.active ? "فعال" : "غیرفعال",
          }));
        case "outstanding": {
          const partyName = (id: string) => (parties ?? []).find((p) => p.id === id)?.name ?? "";
          return (outstanding ?? []).map((o) => ({
            party: partyName(o.partyId),
            kind: o.kind === "receivable" ? "مطالبه" : "بدهی",
            amount: o.amount.toLocaleString("fa-IR"),
            remaining: outstandingRemaining(o).toLocaleString("fa-IR"),
            status: o.status,
          }));
        }
      }
    },
  };
}
