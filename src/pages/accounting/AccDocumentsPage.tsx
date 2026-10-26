/** Accounting document archive — upload, search, filter, preview, download.
 * Every document is two-way linked: attached from a transaction it shows on
 * that transaction, and here its card jumps straight to the transaction. */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeftCircle, FileText, ImageIcon, Paperclip, Receipt, Search, Trash2, Upload } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { SearchBox, FilterSelect, SearchSelect } from "../../components/ui/inputs";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatJalali } from "../../utils/jalali";
import { addAccDoc, deleteAccDoc } from "../../accounting/repo";
import { DOC_CATEGORY_LABELS, TX_TYPE_LABELS, type AccDoc } from "../../accounting/types";
import { useAccDocsMeta, useAccParties, useAccTransactions } from "../../accounting/hooks";
import { formatMoney } from "../../utils/num";

export function AccDocumentsPage() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();
  const docs = useAccDocsMeta();
  const parties = useAccParties();
  const transactions = useAccTransactions();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>("رسید");
  const [uploadParty, setUploadParty] = useState<string>("none");
  const [uploadTx, setUploadTx] = useState<string>("none");
  const [preview, setPreview] = useState<{ name: string; mime: string; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const partyName = (id?: string | null) => (parties ?? []).find((p) => p.id === id)?.name ?? "";
  const txById = useMemo(
    () => new Map((transactions ?? []).map((t) => [t.id, t])),
    [transactions],
  );
  const linkOptions = useMemo(
    () =>
      (transactions ?? [])
        .filter((t) => t.status === "final")
        .slice(0, 200)
        .map((t) => ({
          id: t.id,
          title: `${t.number} — ${TX_TYPE_LABELS[t.type]} — ${formatMoney(t.amount, t.currency)}`,
          subtitle: t.description || undefined,
        })),
    [transactions],
  );

  const rows = useMemo(() => {
    let list = docs ?? [];
    if (categoryFilter !== "all") list = list.filter((d) => (d.category ?? "سایر") === categoryFilter);
    const q = query.trim();
    if (q) {
      list = list.filter((d) => {
        const tx = d.transactionId ? txById.get(d.transactionId) : undefined;
        return `${d.name} ${d.notes ?? ""} ${partyName(d.partyId)} ${tx?.number ?? ""} ${tx?.description ?? ""}`.includes(q);
      });
    }
    return list;
  }, [docs, query, categoryFilter, parties, txById]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        await addAccDoc({
          file,
          partyId: uploadParty !== "none" ? uploadParty : null,
          transactionId: uploadTx !== "none" ? uploadTx : null,
          category: uploadCategory,
        });
        ok++;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `«${file.name}» بارگذاری نشد`);
      }
    }
    if (ok > 0) {
      toast.success(`${ok.toLocaleString("fa-IR")} سند بارگذاری شد`);
      setUploadTx("none");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeDoc = async (doc: Omit<AccDoc, "blob">) => {
    const ok = await confirm({
      title: `حذف سند «${doc.name}»`,
      message: "این عملیات قابل بازگشت نیست.",
      danger: true,
      confirmLabel: "حذف",
    });
    if (!ok) return;
    try {
      await deleteAccDoc(doc.id);
      toast.success("سند حذف شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف ناموفق بود.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام سند…" className="min-w-[200px] flex-1" />
        <FilterSelect
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={[
            { value: "all", label: "همه دسته‌ها" },
            ...DOC_CATEGORY_LABELS.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Button variant="primary" icon={Upload} onClick={() => setUploadOpen(true)}>
          بارگذاری سند
        </Button>
      </div>

      {!docs ? (
        <div className="glass h-24 animate-pulse rounded-3xl" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="سندی بایگانی نشده است"
          description="رسیدها، فاکتورها و قراردادها را اینجا نگه دارید. از فرم تراکنش هم می‌توانید مستقیم پیوست اضافه کنید."
          action={
            <Button variant="primary" icon={Upload} onClick={() => setUploadOpen(true)}>
              بارگذاری اولین سند
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((doc) => {
            const isImage = doc.mime.startsWith("image/");
            return (
              <div key={doc.id} className="glass flex flex-col gap-2 rounded-3xl p-3.5">
                <button
                  className="flex h-24 items-center justify-center overflow-hidden rounded-2xl bg-white/40 dark:bg-white/[0.04]"
                  onClick={async () => {
                    const full = doc as unknown as AccDoc;
                    // Blob not in meta list — fetch full record on demand.
                    const { db } = await import("../../db/schema");
                    const record = await db.accDocs.get(doc.id);
                    if (record) {
                      setPreview({ name: record.name, mime: record.mime, url: URL.createObjectURL(record.blob) });
                    }
                    void full;
                  }}
                >
                  {isImage ? <ImageIcon size={26} className="text-brand-500" /> : <FileText size={26} className="text-brand-500" />}
                </button>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold">{doc.name}</p>
                  <p className="text-[10.5px] text-ink-400">
                    {doc.category ?? "سند"} · {Math.round(doc.size / 1024).toLocaleString("fa-IR")} کیلوبایت
                  </p>
                  <p className="num truncate text-[10.5px] text-ink-400">
                    {formatJalali(new Date(doc.createdAt).toISOString().slice(0, 10))}
                    {doc.partyId ? ` — ${partyName(doc.partyId)}` : ""}
                  </p>
                  {(() => {
                    const tx = doc.transactionId ? txById.get(doc.transactionId) : undefined;
                    if (!tx) return null;
                    return (
                      <button
                        className="mt-1 flex w-full items-center gap-1 rounded-xl bg-brand-500/10 px-2 py-1 text-[10.5px] font-bold text-brand-600 transition-colors hover:bg-brand-500/20 dark:text-brand-300"
                        title={`مشاهده جزئیات تراکنش ${tx.number}`}
                        onClick={() => navigate(`/accounting/transactions?tx=${tx.id}`)}
                      >
                        <Receipt size={11} className="shrink-0" />
                        <span className="num truncate">{tx.number}</span>
                        <span className="truncate text-ink-400">· {TX_TYPE_LABELS[tx.type]}</span>
                        <ArrowLeftCircle size={11} className="mr-auto shrink-0" />
                      </button>
                    );
                  })()}
                </div>
                <div className="flex gap-1.5">
                  <button
                    className="btn btn-glass btn-sm flex-1"
                    onClick={async () => {
                      const { db } = await import("../../db/schema");
                      const record = await db.accDocs.get(doc.id);
                      if (!record) return;
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(record.blob);
                      a.download = record.name;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                    }}
                  >
                    دانلود
                  </button>
                  <button className="icon-btn text-[#dc3535]" onClick={() => void removeDoc(doc)} aria-label="حذف سند">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="بارگذاری سند"
        subtitle="فقط تصویر (JPG/PNG/WebP) و PDF — حداکثر ۱۵ مگابایت"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={() => setUploadOpen(false)}>
              بستن
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-[13px] font-bold">دسته سند</p>
            <FilterSelect
              value={uploadCategory}
              onChange={setUploadCategory}
              options={DOC_CATEGORY_LABELS.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-bold">طرف حساب (اختیاری)</p>
            <FilterSelect
              value={uploadParty}
              onChange={setUploadParty}
              options={[
                { value: "none", label: "— بدون طرف حساب —" },
                ...(parties ?? []).map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-bold">پیوست به تراکنش (اختیاری)</p>
            <SearchSelect
              items={linkOptions}
              value={uploadTx === "none" ? null : uploadTx}
              onSelect={(id) => setUploadTx(id ?? "none")}
              placeholder="جستجوی شماره تراکنش…"
              emptyLabel="تراکنشی نیست"
            />
            <p className="mt-1 text-[11px] text-ink-400">
              سند در جزئیات همان تراکنش هم نمایش داده می‌شود.
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-300/70 py-4 text-xs font-bold text-ink-500 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-ink-400"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip size={16} />
            انتخاب فایل‌ها و بارگذاری
          </button>
        </div>
      </Modal>

      {/* Preview modal */}
      <Modal
        open={preview != null}
        onClose={() => {
          if (preview) URL.revokeObjectURL(preview.url);
          setPreview(null);
        }}
        title={preview?.name ?? ""}
        size="lg"
      >
        {preview &&
          (preview.mime.startsWith("image/") ? (
            <img src={preview.url} alt={preview.name} className="max-h-[70vh] w-full rounded-2xl object-contain" />
          ) : (
            <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full rounded-2xl" />
          ))}
      </Modal>

      <p className="flex items-center gap-1.5 text-[11px] leading-5 text-ink-400">
        <Search size={12} />
        اسناد در همین مرورگر ذخیره می‌شوند؛ برای نگه‌داری بلندمدت، از بخش «پشتیبان و تنظیمات» فایل ZIP اسناد را دانلود کنید.
      </p>
    </div>
  );
}
