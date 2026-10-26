/** Accounting backup, restore, document archive and module settings. */

import { useMemo, useRef, useState } from "react";
import {
  DatabaseBackup,
  FileArchive,
  FileDown,
  HardDriveDownload,
  Info,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  X,
} from "lucide-react";
import { PageHeader } from "../../components/ui/StatCard";
import { Button } from "../../components/ui/Button";
import { SectionCard, FilterSelect } from "../../components/ui/inputs";
import { Input } from "../../components/ui/fields";
import { ExportDialog } from "../../components/exports/ExportDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { updateAccSettings } from "../../accounting/repo";
import {
  applyAccBackup,
  buildAccBackup,
  buildAccDocsZip,
  buildAccRestorePreview,
  createAccSafetyBackup,
  exportAccBackupFile,
  readAccBackupFile,
  type AccRestorePreview,
} from "../../accounting/backup";
import {
  useAccAccounts,
  useAccOutstanding,
  useAccParties,
  useAccSettings,
  useAccTransactions,
} from "../../accounting/hooks";
import { outstandingRemaining } from "../../accounting/engine";
import { formatJalali } from "../../utils/jalali";
import type { Currency } from "../../types";

export function AccBackupPage() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const settings = useAccSettings();

  const [busy, setBusy] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<AccRestorePreview | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [exportKind, setExportKind] = useState<null | "parties" | "transactions" | "accounts" | "outstanding">(null);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  const doBackup = async () => {
    setBusy("backup");
    try {
      const backup = await buildAccBackup();
      exportAccBackupFile(backup);
      toast.success("فایل پشتیبان حسابداری دانلود شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "پشتیبان‌گیری ناموفق بود.");
    } finally {
      setBusy(null);
    }
  };

  const doDocsZip = async () => {
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

  const pickRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const backup = await readAccBackupFile(file);
      const preview = await buildAccRestorePreview(backup);
      setRestorePreview(preview);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خواندن فایل ناموفق بود.");
    }
    if (restoreFileRef.current) restoreFileRef.current.value = "";
  };

  const doRestore = async (mode: "merge" | "replace") => {
    if (!restorePreview) return;
    const ok = await confirm({
      title: mode === "replace" ? "بازیابی جایگزین" : "بازیابی ادغامی",
      message:
        mode === "replace"
          ? "همه داده‌های حسابداری فعلی پاک و با فایل پشتیبان جایگزین می‌شوند. قبل از ادامه، یک پشتیبان ایمنی از وضعیت فعلی دانلود می‌شود."
          : "رکوردهای پشتیبان با داده‌های فعلی ادغام می‌شوند (رکورد همسان به‌روزرسانی می‌شود).",
      confirmLabel: "شروع بازیابی",
      danger: mode === "replace",
    });
    if (!ok) return;
    setBusy("restore");
    try {
      if (mode === "replace") {
        const safety = await createAccSafetyBackup();
        if (safety) exportAccBackupFile(safety);
      }
      const result = await applyAccBackup(restorePreview.backup.data, mode);
      toast.success(
        `بازیابی انجام شد — ${result.inserted.toLocaleString("fa-IR")} جدید، ${result.updated.toLocaleString("fa-IR")} به‌روزرسانی`,
      );
      setRestorePreview(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "بازیابی ناموفق بود.");
    } finally {
      setBusy(null);
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
        subtitle="پشتیبان کامل، بازیابی امن و تنظیمات بخش مالی"
      />

      {/* Backup */}
      <SectionCard title="پشتیبان‌گیری" icon={<Save size={16} className="text-brand-500" />}>
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-6 text-ink-500 dark:text-ink-400">
            پشتیبان کامل شامل طرف حساب‌ها، صندوق‌ها و بانک‌ها، همه تراکنش‌ها، مانده‌ها، متادیتای اسناد و
            تنظیمات است. فایل JSON سبک است و می‌توانید آن را هر جا ذخیره کنید. پشتیبان اصلی برنامه
            (بخش «پشتیبان‌گیری» در منوی بیشتر) هم به‌صورت خودکار شامل همین داده‌ها می‌شود.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={HardDriveDownload} loading={busy === "backup"} onClick={() => void doBackup()}>
              دانلود پشتیبان کامل (JSON)
            </Button>
            <Button variant="glass" icon={FileArchive} loading={busy === "zip"} onClick={() => void doDocsZip()}>
              بایگانی ZIP اسناد
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Restore */}
      <SectionCard title="بازیابی" icon={<RotateCcw size={16} className="text-brand-500" />}>
        <div className="flex flex-col gap-3">
          <input
            ref={restoreFileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => void pickRestoreFile(e.target.files?.[0])}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="glass" icon={FileDown} onClick={() => restoreFileRef.current?.click()}>
              انتخاب فایل پشتیبان…
            </Button>
          </div>
          {restorePreview && (
            <div className="flex flex-col gap-3 rounded-2xl border border-brand-500/25 bg-brand-500/[0.05] p-3.5">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold">
                <span>طرف حساب: {restorePreview.backup.counts.parties.toLocaleString("fa-IR")}</span>
                <span>حساب: {restorePreview.backup.counts.accounts.toLocaleString("fa-IR")}</span>
                <span>تراکنش: {restorePreview.backup.counts.transactions.toLocaleString("fa-IR")}</span>
                <span>مانده: {restorePreview.backup.counts.outstanding.toLocaleString("fa-IR")}</span>
                <span>سند: {restorePreview.backup.counts.docs.toLocaleString("fa-IR")}</span>
              </div>
              {restorePreview.duplicates > 0 && (
                <p className="text-xs font-bold text-[#c77d0a] dark:text-[#f5b84f]">
                  {restorePreview.duplicates.toLocaleString("fa-IR")} رکورد همسان با داده‌های فعلی پیدا شد.
                </p>
              )}
              {restorePreview.warnings.map((w) => (
                <p key={w} className="text-[11px] leading-5 text-ink-400">
                  • {w}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="glass" loading={busy === "restore"} onClick={() => void doRestore("merge")}>
                  بازیابی ادغامی
                </Button>
                <Button size="sm" variant="danger-soft" loading={busy === "restore"} onClick={() => void doRestore("replace")}>
                  جایگزینی کامل (با پشتیبان ایمنی)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRestorePreview(null)}>
                  انصراف
                </Button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* Data-only exports */}
      <SectionCard title="خروجی داده‌ای (اکسل / CSV / PDF / تصویر)" icon={<FileDown size={16} className="text-brand-500" />}>
        <p className="mb-3 text-xs leading-6 text-ink-500 dark:text-ink-400">
          این خروجی‌ها برای گزارش‌گیری و اشتراک‌گذاری‌اند و «قابل بازیابی» نیستند؛ برای بازیابی فقط از
          پشتیبان JSON بالا استفاده کنید.
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
      <SectionCard title="تنظیمات حسابداری" icon={<Settings2 size={16} className="text-brand-500" />}>
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

      {/* Backup vs export explanation */}
      <div className="glass flex items-start gap-3 rounded-3xl p-4 text-[11.5px] leading-6 text-ink-500 dark:text-ink-400">
        <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
        <p>
          <b className="text-ink-700 dark:text-ink-200">پشتیبان</b> یعنی فایلی که می‌توانید برنامه را با آن
          به همین وضعیت برگردانید (شامل همه روابط و شناسه‌ها). <b className="text-ink-700 dark:text-ink-200">خروجی</b>{" "}
          (اکسل/CSV/PDF/تصویر) فقط برای دیدن و گزارش‌دادن است و قابل بازیابی نیست. برای امنیت کامل، هر دو را
          نگه دارید: پشتیبان JSON برای بازیابی، ZIP اسناد برای فایل‌ها.
        </p>
      </div>

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
