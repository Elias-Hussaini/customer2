/**
 * پر کردن فرم ویزا (PDF) — pick a customer + a saved template, preview the
 * mapping and download a filled PDF. Template management lives here too.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  FileDown,
  FilePlus2,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { PageHeader } from "../components/ui/StatCard";
import { SearchSelect } from "../components/ui/inputs";
import { FormField, Input } from "../components/ui/fields";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../hooks/useToast";
import { useCustomers, useLists, useRepresentatives } from "../hooks/useData";
import { customerFullName } from "../db/customers";
import {
  createTemplate,
  deleteTemplate,
  detectAcroFields,
  fillTemplate,
  listTemplates,
  saveTemplate,
  type AcroMapping,
  type DetectedField,
  type PdfTemplate,
  type TemplateSource,
  type FillReport,
} from "../lib/docex";
import { saveAs } from "file-saver";

const SOURCE_LABELS: Record<string, string> = {
  firstName: "نام", lastName: "نام خانوادگی", fullName: "نام و نام خانوادگی",
  passportNo: "شماره پاسپورت", birthDate: "تاریخ تولد",
  passportIssueDate: "تاریخ صدور پاسپورت", passportExpiryDate: "تاریخ انقضای پاسپورت",
  referrer: "معرف", notes: "توضیحات", listName: "نام لیست",
  representativeName: "نام نماینده", nationalId: "شماره ملی/تذکره",
  fatherName: "نام پدر", sex: "جنسیت", nationality: "ملیت", static: "متن ثابت", "": "—",
};

export function DocFillPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const customers = useCustomers();
  const lists = useLists();
  const representatives = useRepresentatives();

  const [tab, setTab] = useState<"fill" | "manage">("fill");
  const [templates, setTemplates] = useState<PdfTemplate[] | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(params.customerId ?? null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<FillReport | null>(null);

  const reload = async () => setTemplates(await listTemplates());
  useEffect(() => {
    void reload();
    if (searchParams.get("tab") === "manage") setTab("manage");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const customer = useMemo(
    () => (customers ?? []).find((c) => c.id === customerId),
    [customers, customerId],
  );
  const template = useMemo(
    () => (templates ?? []).find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const listName = useMemo(
    () => (lists ?? []).find((l) => l.id === customer?.listId)?.name ?? null,
    [lists, customer],
  );
  const repName = useMemo(
    () => (representatives ?? []).find((r) => r.id === customer?.representativeId)?.name ?? null,
    [representatives, customer],
  );

  const generate = async () => {
    if (!template || !customer) return;
    setBusy(true);
    setReport(null);
    try {
      const { bytes, report } = await fillTemplate(template, {
        customer,
        listName,
        representativeName: repName,
      });
      setReport(report);
      const name = `${template.name.replace(/[\\/:*?"<>|]/g, "-")} - ${customerFullName(customer)}.pdf`;
      saveAs(new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }), name);
      if (report.missing.length === 0 && report.errors.length === 0) {
        toast.success("فرم پر شد و دانلود شد");
      } else if (report.errors.length) {
        toast.error("فرم دانلود شد اما بعضی فیلدها نتوانستند پر شوند");
      } else {
        toast.error("فرم دانلود شد — فیلدهای خالی لازم را بررسی کنید");
      }
    } catch (e) {
      console.error("docfill:", e);
      toast.error("پر کردن فرم ناموفق بود");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        icon={Wand2}
        title="پر کردن فرم ویزا (PDF)"
        subtitle="قالب فرم را یک بار ذخیره کنید؛ بعدش با یک کلیک برای هر مشتری پر و دانلود می‌شود"
        back
      />

      {/* Tabs */}
      <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-2xl bg-ink-900/5 p-1.5 dark:bg-white/8">
        {([
          { id: "fill", label: "پر کردن فرم", icon: FileDown },
          { id: "manage", label: "مدیریت قالب‌ها", icon: Pencil },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-bold transition-all ${
              tab === t.id
                ? "bg-white text-brand-600 shadow-sm dark:bg-ink-800 dark:text-brand-300"
                : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100"
            }`}
          >
            <t.icon size={15} />
            {t.label}
            {t.id === "manage" && templates?.length ? (
              <span className="rounded-full bg-brand-500/15 px-1.5 text-[10px] text-brand-600 dark:text-brand-300">
                {templates.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "fill" ? (
        <div className="flex flex-col gap-4" data-page-form>
          <GlassCard className="flex flex-col gap-4 p-4">
            <FormField label="مشتری" required>
              <SearchSelect
                items={(customers ?? []).map((c) => ({
                  id: c.id,
                  title: customerFullName(c),
                  subtitle: c.passportNo,
                }))}
                value={customerId}
                onSelect={setCustomerId}
                placeholder="انتخاب مشتری…"
                clearable={false}
              />
            </FormField>
            <FormField label="قالب فرم" required hint={templates?.length ? undefined : "اول در «مدیریت قالب‌ها» یک قالب بسازید"}>
              <SearchSelect
                items={(templates ?? []).map((t) => ({
                  id: t.id,
                  title: t.name,
                  subtitle: t.kind === "acroform" ? "فرم تعاملی (AcroForm)" : `مختصاتی — ${t.pageCount} صفحه`,
                }))}
                value={templateId}
                onSelect={setTemplateId}
                placeholder="انتخاب قالب…"
                clearable
              />
            </FormField>

            {template && customer && (
              <MappingPreview template={template} customer={customer} listName={listName} repName={repName} />
            )}

            {report && (report.missing.length > 0 || report.errors.length > 0) && (
              <div className="flex flex-col gap-1 rounded-2xl bg-amber-500/10 px-3.5 py-3 text-[11.5px] leading-5 text-[#c77d0a] dark:text-[#f5b84f]">
                {report.missing.map((m, i) => (
                  <p key={`m${i}`} className="flex items-start gap-1.5">
                    <TriangleAlert size={13} className="mt-1 shrink-0" />
                    فیلد «{m.pdfField}» مقدار ندارد ({SOURCE_LABELS[m.source] ?? m.source}) — در پروفایل مشتری تکمیلش کنید.
                  </p>
                ))}
                {report.errors.map((e, i) => (
                  <p key={`e${i}`} className="flex items-start gap-1.5">
                    <TriangleAlert size={13} className="mt-1 shrink-0" />
                    {e}
                  </p>
                ))}
              </div>
            )}

            {report && report.transliterated.length > 0 && (
              <div className="flex flex-col gap-1 rounded-2xl bg-sky-500/10 px-3.5 py-3 text-[11.5px] leading-5 text-sky-700 dark:text-sky-300">
                <p className="font-bold">نوشته شد به‌صورت لاتین (محدودیت فونت فرم):</p>
                {report.transliterated.map((tr, i) => (
                  <p key={`t${i}`} className="flex items-start gap-1.5" dir="auto">
                    «{tr.from}» ← <b dir="ltr">{tr.to}</b> در «{tr.pdfField}»
                  </p>
                ))}
                <p className="text-[10.5px] text-sky-700/70 dark:text-sky-300/70">
                  فرم‌های PDF استاندارد فقط حروف لاتین را پشتیبانی می‌کنند؛ متن فارسی به‌صورت خودکار آوانویسی شد.
                </p>
              </div>
            )}

            <Button
              variant="primary"
              onClick={() => void generate()}
              loading={busy}
              disabled={!template || !customer}
              className="w-full"
            >
              <Download size={14} />
              تولید و دانلود PDF پرشده
            </Button>
            <p className="text-center text-[10.5px] leading-4 text-ink-400">
              فایل اصلی قالب هرگز تغییر نمی‌کند — همیشه یک نسخهٔ جدید ساخته می‌شود.
            </p>
          </GlassCard>
        </div>
      ) : (
        <TemplateManager
          templates={templates}
          onChanged={() => void reload()}
          onUse={(id) => {
            setTemplateId(id);
            setTab("fill");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fill preview                                                        */
/* ------------------------------------------------------------------ */

function MappingPreview({
  template,
  customer,
  listName,
  repName,
}: {
  template: PdfTemplate;
  customer: import("../types").Customer;
  listName: string | null;
  repName: string | null;
}) {
  const preview = (m: AcroMapping): string => {
    const v = previewValue(m, customer, listName, repName);
    return v === "" ? "—" : v;
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-900/8 dark:border-white/10">
      <div className="flex items-center gap-2 bg-ink-900/4 px-3 py-2 text-[11.5px] font-bold dark:bg-white/6">
        <FileText size={13} className="text-brand-500" />
        پیش‌نمایش نگاشت ({template.mappings.length} فیلد)
      </div>
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full text-[11.5px]">
          <tbody>
            {template.mappings.map((m) => (
              <tr key={m.pdfField} className="border-t border-ink-900/5 dark:border-white/5">
                <td className="px-3 py-1.5 text-ink-500 dark:text-ink-400" dir="ltr">
                  {m.pdfField}
                </td>
                <td className="px-2 py-1.5 text-ink-400">{SOURCE_LABELS[m.source ?? ""] ?? m.source}</td>
                <td className="px-3 py-1.5 text-left font-medium" dir="auto">
                  {preview(m)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function previewValue(
  m: AcroMapping,
  customer: import("../types").Customer,
  listName: string | null,
  repName: string | null,
): string {
  if (m.source === "static") return m.staticText ?? "";
  if (!m.source) return "";
  const map: Record<string, string | null | undefined> = {
    firstName: customer.firstName,
    lastName: customer.lastName,
    fullName: customerFullName(customer),
    passportNo: customer.passportNo,
    birthDate: customer.birthDate,
    passportIssueDate: customer.passportIssueDate,
    passportExpiryDate: customer.passportExpiryDate,
    referrer: customer.referrer,
    notes: customer.notes,
    listName,
    representativeName: repName,
    nationalId: customer.customValues?.["nationalId"] as string | undefined,
    fatherName: customer.customValues?.["fatherName"] as string | undefined,
    sex: customer.customValues?.["sex"] as string | undefined,
  };
  return map[m.source] ?? "";
}

/* ------------------------------------------------------------------ */
/* Template manager                                                    */
/* ------------------------------------------------------------------ */

function TemplateManager({
  templates,
  onChanged,
  onUse,
}: {
  templates: PdfTemplate[] | null;
  onChanged: () => void;
  onUse: (id: string) => void;
}) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PdfTemplate | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [detected, setDetected] = useState<DetectedField[] | null>(null);
  const [mappings, setMappings] = useState<AcroMapping[]>([]);
  const [busy, setBusy] = useState(false);

  const startCreate = async (f: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const fields = await detectAcroFields(bytes);
      setFile(f);
      setDetected(fields);
      setName(f.name.replace(/\.pdf$/i, ""));
      setMappings(
        fields.map((d) => ({
          pdfField: d.name,
          source: d.suggested,
          dateFormat: "iso",
          casing: "raw",
          required: false,
        })),
      );
      setCreating(true);
      if (fields.length === 0) {
        toast.error("این PDF فیلد تعاملی (AcroForm) ندارد — حالت مختصاتی بعداً اضافه می‌شود؛ فعلاً فرم‌های تعاملی پشتیبانی می‌شوند");
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (editing) {
        await saveTemplate({ ...editing, name: name.trim(), mappings });
        toast.success("قالب ذخیره شد");
      } else {
        await createTemplate(name.trim(), bytes, file.name, "acroform", 1, mappings);
        toast.success("قالب جدید ساخته شد");
      }
      setCreating(false);
      setEditing(null);
      setFile(null);
      setDetected(null);
      setMappings([]);
      setName("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (creating || editing) {
    return (
      <GlassCard className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <FilePlus2 size={16} className="text-brand-500" />
          <p className="text-[13px] font-bold">{editing ? "ویرایش قالب" : "قالب جدید"}</p>
          <span className="mr-auto text-[10.5px] text-ink-400" dir="ltr">
            {file?.name ?? editing?.fileName}
          </span>
        </div>
        <FormField label="نام قالب" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً فرم ویزای عراق" />
        </FormField>

        <p className="text-[11.5px] text-ink-500 dark:text-ink-400">
          {detected?.length
            ? `${detected.length} فیلد تعاملی پیدا شد. نگاشت هر فیلد را مشخص کنید (پیشنهاد خودکار را هم بازبینی کنید):`
            : "فیلدی پیدا نشد."}
        </p>

        <div className="max-h-80 overflow-y-auto rounded-2xl border border-ink-900/8 dark:border-white/10">
          <table className="w-full text-[11.5px]">
            <thead className="sticky top-0 bg-ink-900/4 text-[10.5px] dark:bg-white/6">
              <tr>
                <th className="px-3 py-2 text-right">فیلد PDF</th>
                <th className="px-2 py-2 text-right">نوع</th>
                <th className="px-2 py-2 text-right">داده مشتری</th>
                <th className="px-2 py-2 text-right">قالب تاریخ</th>
                <th className="px-2 py-2 text-center">الزامی</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, i) => (
                <tr key={m.pdfField} className="border-t border-ink-900/5 dark:border-white/5">
                  <td className="px-3 py-1.5" dir="ltr">
                    {m.pdfField}
                  </td>
                  <td className="px-2 py-1.5 text-ink-400">
                    {detected?.[i]?.type === "checkbox" ? "چک‌باکس" : detected?.[i]?.type === "radio" ? "رادیو" : detected?.[i]?.type === "dropdown" ? "لیست" : "متن"}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={m.source ?? ""}
                      onChange={(e) =>
                        setMappings((ms) =>
                          ms.map((x, j) => (j === i ? { ...x, source: (e.target.value || null) as TemplateSource | null } : x)),
                        )
                      }
                      className="w-full rounded-lg border border-ink-900/10 bg-transparent px-2 py-1 text-[11px] dark:border-white/15"
                    >
                      {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={m.dateFormat}
                      disabled={!["birthDate", "passportIssueDate", "passportExpiryDate"].includes(m.source ?? "")}
                      onChange={(e) =>
                        setMappings((ms) =>
                          ms.map((x, j) => (j === i ? { ...x, dateFormat: e.target.value as AcroMapping["dateFormat"] } : x)),
                        )
                      }
                      className="w-full rounded-lg border border-ink-900/10 bg-transparent px-2 py-1 text-[11px] disabled:opacity-40 dark:border-white/15"
                    >
                      <option value="iso">1997-03-10</option>
                      <option value="ddmmyyyy">10/03/1997</option>
                      <option value="ddmmyy">10/03/97</option>
                      <option value="yyyymmdd">19970310</option>
                      <option value="dmonyyyy">10 MAR 1997</option>
                      <option value="jalali">شمسی 1375/12/19</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={m.required}
                      onChange={(e) =>
                        setMappings((ms) => ms.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))
                      }
                      className="size-4"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setCreating(false);
              setEditing(null);
              setFile(null);
              setDetected(null);
              setMappings([]);
            }}
          >
            انصراف
          </button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            ذخیرهٔ قالب
          </Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void startCreate(f);
          e.target.value = "";
        }}
      />
      <Button variant="primary" onClick={() => fileRef.current?.click()} loading={busy} className="w-full">
        <FilePlus2 size={14} />
        افزودن قالب از روی فرم PDF
      </Button>
      <p className="text-[10.5px] leading-4 text-ink-400">
        فرم‌های تعاملی (AcroForm) کاملاً پشتیبانی می‌شوند. فیلدهای خودکار شناسایی و به دادهٔ
        مشتری نگاشت می‌شوند؛ شما نگاشت را بازبینی و ذخیره می‌کنید.
      </p>

      {(templates ?? []).length === 0 ? (
        <EmptyState icon={FileText} title="هنوز قالبی ذخیره نشده" description="با دکمهٔ بالا اولین فرم ویزا را اضافه کنید" />
      ) : (
        <div className="flex flex-col gap-2">
          {(templates ?? []).map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-2xl border border-ink-900/8 px-3 py-2.5 dark:border-white/10"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/12 text-brand-500">
                <FileText size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold">{t.name}</p>
                <p className="text-[10.5px] text-ink-400">
                  {t.mappings.length} فیلد نگاشت‌شده — {t.kind === "acroform" ? "AcroForm" : "مختصاتی"}
                </p>
              </div>
              <button
                className="rounded-lg p-2 text-ink-400 hover:bg-ink-900/5 hover:text-brand-500 dark:hover:bg-white/10"
                title="استفاده"
                onClick={() => onUse(t.id)}
              >
                <CheckCircle2 size={15} />
              </button>
              <button
                className="rounded-lg p-2 text-ink-400 hover:bg-ink-900/5 hover:text-brand-500 dark:hover:bg-white/10"
                title="ویرایش نگاشت"
                onClick={() => {
                  setEditing(t);
                  setName(t.name);
                  setMappings(t.mappings.map((m) => ({ ...m })));
                  setDetected(null);
                  void 0;
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                className="rounded-lg p-2 text-ink-400 hover:bg-rose-500/10 hover:text-rose-500"
                title="حذف"
                onClick={() => {
                  if (confirm(`قالب «${t.name}» حذف شود؟`)) {
                    void deleteTemplate(t.id).then(onChanged);
                  }
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
