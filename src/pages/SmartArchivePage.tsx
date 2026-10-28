import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  ChevronDown,
  FileArchive,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Loader2,
  RotateCcw,
  UserRound,
  Users,
} from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, RadioSelect, SectionCard, SearchBox } from "../components/ui/inputs";
import { Checkbox, Input, Toggle } from "../components/ui/fields";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { useToast } from "../hooks/useToast";
import {
  useCustomers,
  useLists,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { toPersianDigits } from "../utils/jalali";
import {
  REQUEST_DATE_BASIS_OPTIONS,
  basisRangePlaceholders,
  isRequestDateBasis,
  quickDateRanges,
  requestBasisLabel,
  requestWithinRange,
  type RequestDateBasis,
} from "../utils/requestDateFilter";
import { collectEntries } from "../utils/smartArchive/collect";
import {
  buildPlan,
  formatBytes,
  generateAndSave,
  type ArchiveEntry,
  type FileNaming,
  type FolderMode,
  type PlanItem,
  type PlanOverride,
} from "../utils/smartArchive/engine";

type ArchiveMode = "visas" | "documents";

const MODE_DEFAULTS: Record<
  ArchiveMode,
  {
    folderMode: FolderMode;
    fileNaming: FileNaming;
    singleFolderName: string;
    zipName: string;
    dateBasis: RequestDateBasis;
  }
> = {
  visas: {
    folderMode: "single",
    fileNaming: "customerName",
    singleFolderName: "ویزا های امروز صادر شده",
    zipName: "ویزا های صادر شده",
    dateBasis: "issued",
  },
  documents: {
    folderMode: "perCustomer",
    fileNaming: "docLabel",
    singleFolderName: "مدارک مشتریان",
    zipName: "مدارک مشتریان",
    dateBasis: "registration",
  },
};

const FOLDER_MODES: { value: FolderMode; label: string; hint: string }[] = [
  { value: "perCustomer", label: "هر مشتری یک پوشه", hint: "فایل‌های هر مشتری داخل پوشه‌ای به نام خودش" },
  { value: "single", label: "همه در یک پوشه", hint: "نام پوشه را خودتان تعیین می‌کنید" },
  { value: "flat", label: "بدون پوشه", hint: "همه فایل‌ها در ریشه ZIP" },
];

const NAMING_MODES: { value: FileNaming; label: string; hint: string }[] = [
  { value: "customerName", label: "نام مشتری", hint: "علی رضایی.pdf" },
  { value: "docLabel", label: "نوع مدرک", hint: "پاسپورت.jpg • id روی.jpg • ویزا.pdf" },
  { value: "sequence", label: "شماره‌گذاری", hint: "۱.pdf • ۲.pdf • ۳.jpg" },
  { value: "original", label: "نام اصلی فایل", hint: "همان نامی که هنگام بارگذاری داشت" },
];

/**
 * بایگانی هوشمند — export customer documents and issued-visa files as a
 * fully customizable ZIP archive. All report filters apply; folder structure,
 * file naming, the ZIP name and even every single destination are under the
 * user's control, with a live preview before download.
 */
export function SmartArchivePage() {
  const toast = useToast();
  const requests = useRequests();
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags();

  /* ------------------------------- mode ---------------------------------- */
  const [mode, setMode] = useState<ArchiveMode>("visas");

  /* ------------------------------ filters -------------------------------- */
  const [repId, setRepId] = useState("");
  const [listId, setListId] = useState("");
  const [status, setStatus] = useState("");
  const [tagId, setTagId] = useState("");
  const [dateBasis, setDateBasis] = useState<RequestDateBasis>("issued");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  /* --------------------- manual customer selection ------------------------ */
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  /* ------------------------------- content ------------------------------- */
  const [includeDocs, setIncludeDocs] = useState(true);
  const [includeVisas, setIncludeVisas] = useState(true);
  const [includePhotos, setIncludePhotos] = useState(false);

  /* ------------------------------ structure ------------------------------ */
  const [folderMode, setFolderMode] = useState<FolderMode>("single");
  const [singleFolderName, setSingleFolderName] = useState(MODE_DEFAULTS.visas.singleFolderName);
  const [folderNameDirty, setFolderNameDirty] = useState(false);
  const [fileNaming, setFileNaming] = useState<FileNaming>("customerName");
  const [docSubfolders, setDocSubfolders] = useState(false);
  const [zipName, setZipName] = useState(MODE_DEFAULTS.visas.zipName);

  /* ------------------------- entries + overrides -------------------------- */
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, PlanOverride>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  /* ------------------------------- download ------------------------------- */
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const collectToken = useRef(0);

  const quickRanges = useMemo(() => quickDateRanges(), []);
  const rangePlaceholders = basisRangePlaceholders(dateBasis);

  /* --------------------------- scope resolution --------------------------- */
  const manualSelection = mode === "documents" && pickedIds.size > 0;

  const scopeCustomerIds = useMemo(() => {
    if (manualSelection) return [...pickedIds];
    const matched = (requests ?? []).filter((r) => {
      if (mode === "visas" && !r.issued) return false;
      if (repId && r.representativeId !== repId) return false;
      if (listId && r.listId !== listId) return false;
      if (mode === "documents") {
        if (status === "issued" && !r.issued) return false;
        if (status === "pending" && (r.issued || r.rejected)) return false;
        if (status === "rejected" && !r.rejected) return false;
      }
      if (tagId && !r.tags.includes(tagId)) return false;
      if (!requestWithinRange(r, dateBasis, from, to)) return false;
      return true;
    });
    return [...new Set(matched.map((r) => r.customerId))];
  }, [manualSelection, pickedIds, requests, mode, repId, listId, status, tagId, dateBasis, from, to]);

  /** issued-visa customers in scope WITHOUT an uploaded visa file (hint). */
  const issuedWithoutFile = useMemo(() => {
    if (mode !== "visas" || !entries) return 0;
    const withFile = new Set(entries.map((e) => e.customerId));
    return scopeCustomerIds.filter((id) => !withFile.has(id)).length;
  }, [mode, entries, scopeCustomerIds]);

  /* ------------------------------ collection ------------------------------ */
  const scopeKey = scopeCustomerIds.join(",");
  useEffect(() => {
    const token = ++collectToken.current;
    setCollecting(true);
    const t = setTimeout(async () => {
      try {
        const rows = await collectEntries({
          customerIds: scopeKey ? scopeKey.split(",") : [],
          includeDocs: mode === "documents" && includeDocs,
          includeIssuedVisas: mode === "visas" || includeVisas,
          includeProfilePhotos: mode === "documents" && includePhotos,
        });
        if (token === collectToken.current) setEntries(rows);
      } catch (e) {
        console.error(e);
        if (token === collectToken.current) setEntries([]);
      } finally {
        if (token === collectToken.current) setCollecting(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scopeKey,
    mode,
    includeDocs,
    includeVisas,
    includePhotos,
  ]);

  /* --------------------------------- plan --------------------------------- */
  const plan = useMemo(
    () =>
      buildPlan(entries ?? [], {
        folderMode,
        singleFolderName,
        fileNaming,
        docSubfolders,
      }, overrides),
    [entries, folderMode, singleFolderName, fileNaming, docSubfolders, overrides],
  );

  const tree = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of plan.items) {
      const key = it.folder || "—";
      const arr = m.get(key);
      if (arr) arr.push(it);
      else m.set(key, [it]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "fa"));
  }, [plan]);

  /* ------------------------------ interactions ---------------------------- */

  const switchMode = (m: string) => {
    if (m === mode) return;
    const next = m === "visas" || m === "documents" ? m : "visas";
    setMode(next);
    const d = MODE_DEFAULTS[next];
    setFolderMode(d.folderMode);
    setFileNaming(d.fileNaming);
    setSingleFolderName(d.singleFolderName);
    setZipName(d.zipName);
    setDateBasis(d.dateBasis);
    setFolderNameDirty(false);
    setStatus("");
    setOverrides({});
  };

  const applyQuickRange = (fromIso: string, toIso: string, label: string) => {
    setFrom(fromIso);
    setTo(toIso);
    // helpful default folder name for the classic "visas issued today" case
    if (mode === "visas" && !folderNameDirty && folderMode === "single") {
      setSingleFolderName(`ویزا های ${label} صادر شده`);
    }
  };

  const clearFilters = () => {
    setRepId("");
    setListId("");
    setStatus("");
    setTagId("");
    setFrom(null);
    setTo(null);
    setPickedIds(new Set());
  };

  const setOverride = (id: string, patch: PlanOverride) => {
    setOverrides((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      if (next[id].excluded === false && next[id].folder === undefined && next[id].fileName === undefined) {
        delete next[id];
      }
      return next;
    });
  };

  const download = async () => {
    if (plan.items.length === 0 || busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const res = await generateAndSave(plan.items, zipName, setProgress);
      toast.success(
        res.via === "picker"
          ? `بایگانی ZIP با ${toPersianDigits(plan.items.length)} فایل در محل انتخاب‌شده ذخیره شد`
          : `فایل ZIP با ${toPersianDigits(plan.items.length)} فایل دانلود شد`,
      );
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") {
        toast.info("ذخیره بایگانی لغو شد");
      } else {
        console.error(e);
        toast.error("خطا در ساخت بایگانی — دوباره تلاش کنید");
      }
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  /* --------------------------------- view --------------------------------- */

  const customerOptions = useMemo(() => {
    const q = pickerQuery.trim();
    return (customers ?? [])
      .filter((c) => !c.archivedAt)
      .filter((c) => {
        if (!q) return true;
        const rep = representatives?.find((r) => r.id === c.representativeId)?.name ?? "";
        return `${c.firstName ?? ""} ${c.lastName ?? ""} ${c.passportNo ?? ""} ${rep}`.includes(q);
      })
      .sort((a, b) =>
        `${a.firstName ?? ""} ${a.lastName ?? ""}`.localeCompare(
          `${b.firstName ?? ""} ${b.lastName ?? ""}`,
          "fa",
        ),
      );
  }, [customers, representatives, pickerQuery]);

  const repName = (id: string) => (representatives ?? []).find((r) => r.id === id)?.name ?? "";
  const filtersActive = repId || listId || status || tagId || from || to || pickedIds.size > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={FileArchive}
        title="بایگانی هوشمند"
        subtitle="خروجی ZIP مدارک و ویزاهای صادر شده — با ساختار پوشه و نام‌گذاری دلخواه"
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void download()}
            disabled={busy || plan.items.length === 0}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
            {busy
              ? `در حال ساخت… ${toPersianDigits(progress)}٪`
              : `دانلود ZIP (${toPersianDigits(plan.items.length)} فایل)`}
          </button>
        }
      />

      {/* Mode */}
      <RadioSelect
        options={[
          { value: "visas", label: "ویزاهای صادر شده" },
          { value: "documents", label: "مدارک مشتریان" },
        ]}
        value={mode}
        onChange={switchMode}
      />

      {/* Filters — the full report filter set */}
      <div className="glass flex flex-col gap-2.5 rounded-3xl p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            ariaLabel="نماینده"
            value={repId}
            onChange={setRepId}
            options={[
              { value: "", label: "همه نمایندگان" },
              ...(representatives ?? []).map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
          <FilterSelect
            ariaLabel="لیست"
            value={listId}
            onChange={setListId}
            options={[
              { value: "", label: "همه لیست‌ها" },
              ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
          {mode === "documents" && (
            <FilterSelect
              ariaLabel="وضعیت"
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: "همه وضعیت‌ها" },
                { value: "issued", label: "صادر شده" },
                { value: "pending", label: "در حال کار" },
                { value: "rejected", label: "رد شده" },
              ]}
            />
          )}
          <FilterSelect
            ariaLabel="تگ"
            value={tagId}
            onChange={setTagId}
            options={[
              { value: "", label: "همه تگ‌ها" },
              ...(tags ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <div className="flex items-center gap-1.5">
            <span className="hidden shrink-0 text-[11px] font-bold text-ink-400 sm:inline">
              مبنای بازه:
            </span>
            <FilterSelect
              ariaLabel="مبنای بازه تاریخ"
              value={dateBasis}
              onChange={(v) => setDateBasis(isRequestDateBasis(v) ? v : "registration")}
              options={REQUEST_DATE_BASIS_OPTIONS}
            />
          </div>
          <JalaliDatePicker
            value={from}
            onChange={setFrom}
            placeholder={rangePlaceholders.from}
            className="w-40"
          />
          <JalaliDatePicker
            value={to}
            onChange={setTo}
            placeholder={rangePlaceholders.to}
            className="w-40"
          />
          {filtersActive && (
            <button className="btn btn-ghost btn-sm mr-auto" onClick={clearFilters}>
              پاک‌کردن فیلترها
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-900/5 pt-2 dark:border-white/5">
          <span className="shrink-0 text-[11px] font-bold text-ink-400">بازه سریع:</span>
          {quickRanges.map((q) => {
            const active = from === q.from && to === q.to;
            return (
              <button
                key={q.key}
                type="button"
                className={`rounded-full px-3 py-1 text-[11px] font-bold transition-all ${
                  active
                    ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(99,91,255,0.5)]"
                    : "bg-ink-900/5 text-ink-500 hover:bg-brand-500/12 hover:text-brand-600 dark:bg-white/5 dark:text-ink-400 dark:hover:text-brand-300"
                }`}
                onClick={() => applyQuickRange(q.from, q.to, q.label)}
              >
                {q.label}
              </button>
            );
          })}
          {mode === "visas" && (
            <span className="text-[11px] text-ink-400">
              فقط ویزاهای صادرشده — بازه بر اساس «{requestBasisLabel(dateBasis)}»
            </span>
          )}
        </div>
        {/* scope summary */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="chip num">
            <Users size={12} className="inline" /> {toPersianDigits(scopeCustomerIds.length)} مشتری
            در محدوده
          </span>
          {manualSelection && (
            <button className="chip num !bg-brand-500/12 !text-brand-600" onClick={() => setPickedIds(new Set())}>
              انتخاب دستی: {toPersianDigits(pickedIds.size)} — پاک‌کردن
            </button>
          )}
          {mode === "visas" && issuedWithoutFile > 0 && (
            <span className="chip num !bg-[#fdf2dd] !text-[#a56a06]">
              {toPersianDigits(issuedWithoutFile)} مشتری بدون فایل ویزا
            </span>
          )}
        </div>
      </div>

      {/* Manual customer picker (documents mode) */}
      {mode === "documents" && (
        <SectionCard
          title="انتخاب مشتری‌های خاص (اختیاری)"
          icon={<UserRound size={15} className="text-brand-500" />}
          action={
            <button
              className="btn btn-glass btn-sm"
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`}
              />
              {pickerOpen ? "بستن" : `انتخاب از ${toPersianDigits((customers ?? []).length)} مشتری`}
            </button>
          }
        >
          {pickerOpen ? (
            <div className="flex flex-col gap-2.5">
              <SearchBox
                value={pickerQuery}
                onChange={setPickerQuery}
                placeholder="جستجوی نام، پاسپورت یا نماینده…"
              />
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-ink-900/8 p-2 dark:border-white/10">
                {customerOptions.length === 0 ? (
                  <p className="py-6 text-center text-xs text-ink-400">مشتری‌ای یافت نشد</p>
                ) : (
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {customerOptions.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-brand-500/6"
                      >
                        <Checkbox
                          checked={pickedIds.has(c.id)}
                          onChange={() =>
                            setPickedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            })
                          }
                          label={`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "بدون نام"}
                        />
                        <span className="mr-auto shrink-0 text-[10px] text-ink-400">
                          {repName(c.representativeId ?? "")}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {pickedIds.size > 0 && (
                <p className="text-[11px] text-ink-400">
                  با انتخاب دستی، فقط همین {toPersianDigits(pickedIds.size)} مشتری در بایگانی
                  می‌آیند و فیلترها نادیده گرفته می‌شوند.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
              پیش‌فرض: همه مشتری‌هایی که با فیلترهای بالا منطبق‌اند. اگر بخواهید مدارک افراد
              مشخصی را بگیرید، از دکمه بالا انتخابشان کنید.
            </p>
          )}
        </SectionCard>
      )}

      {/* Content (documents mode) */}
      {mode === "documents" && (
        <SectionCard title="چه چیزی داخل بایگانی باشد؟" icon={<Inbox size={15} className="text-brand-500" />}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="glass-soft rounded-2xl p-3">
              <Checkbox checked={includeDocs} onChange={() => setIncludeDocs((v) => !v)} label="مدارک (پاسپورت، تذکره، …)" />
              <p className="mt-1 pr-7 text-[10.5px] leading-4 text-ink-400">همه فایل‌های بخش «مدارک و تصاویر»</p>
            </div>
            <div className="glass-soft rounded-2xl p-3">
              <Checkbox checked={includeVisas} onChange={() => setIncludeVisas((v) => !v)} label="ویزاهای صادر شده" />
              <p className="mt-1 pr-7 text-[10.5px] leading-4 text-ink-400">فایل‌های بارگذاری‌شده در اسلات ویزا</p>
            </div>
            <div className="glass-soft rounded-2xl p-3">
              <Checkbox checked={includePhotos} onChange={() => setIncludePhotos((v) => !v)} label="عکس پروفایل مشتری" />
              <p className="mt-1 pr-7 text-[10.5px] leading-4 text-ink-400">عکس گرد پروفایل هر مشتری</p>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Structure + naming */}
      <SectionCard title="ساختار پوشه‌ها و نام‌گذاری" icon={<FolderOpen size={15} className="text-brand-500" />}>
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-1.5 text-[12px] font-bold">پوشه‌بندی</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {FOLDER_MODES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFolderMode(f.value)}
                  className={`rounded-2xl border p-2.5 text-right transition-all ${
                    folderMode === f.value
                      ? "border-brand-500 bg-brand-500/10"
                      : "border-ink-900/10 hover:border-brand-300 dark:border-white/10"
                  }`}
                >
                  <span className="block text-[12px] font-bold">{f.label}</span>
                  <span className="block text-[10.5px] leading-4 text-ink-400">{f.hint}</span>
                </button>
              ))}
            </div>
            {folderMode === "single" && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] font-bold text-ink-500 dark:text-ink-400">نام پوشه:</p>
                <Input
                  value={singleFolderName}
                  onChange={(e) => {
                    setSingleFolderName(e.target.value);
                    setFolderNameDirty(true);
                  }}
                  placeholder="مثلا: ویزا های امروز صادر شده"
                />
              </div>
            )}
            {folderMode === "perCustomer" && (
              <div className="mt-2">
                <Toggle
                  checked={docSubfolders}
                  onChange={() => setDocSubfolders((v) => !v)}
                  label="تفکیک در زیرپوشه‌های «مدارک» و «ویزاها»"
                />
              </div>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-bold">نام‌گذاری فایل‌ها</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {NAMING_MODES.map((n) => (
                <button
                  key={n.value}
                  type="button"
                  onClick={() => setFileNaming(n.value)}
                  className={`rounded-2xl border p-2.5 text-right transition-all ${
                    fileNaming === n.value
                      ? "border-brand-500 bg-brand-500/10"
                      : "border-ink-900/10 hover:border-brand-300 dark:border-white/10"
                  }`}
                >
                  <span className="block text-[12px] font-bold">{n.label}</span>
                  <span className="block truncate text-[10.5px] leading-4 text-ink-400" title={n.hint}>
                    {n.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] font-bold">نام فایل ZIP</p>
            <Input dir="ltr" className="text-left" value={zipName} onChange={(e) => setZipName(e.target.value)} placeholder="archive" />
          </div>
        </div>
      </SectionCard>

      {/* Preview */}
      <SectionCard
        title="پیش‌نمایش بایگانی"
        icon={<Folder size={15} className="text-brand-500" />}
        action={
          Object.keys(overrides).length > 0 ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setOverrides({})}>
              <RotateCcw size={13} /> بازنشانی ویرایش‌ها
            </button>
          ) : undefined
        }
      >
        {collecting ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-400">
            <Loader2 size={17} className="animate-spin" /> در حال جمع‌آوری فایل‌ها…
          </div>
        ) : plan.items.length === 0 && plan.stats.excluded === 0 ? (
          scopeCustomerIds.length === 0 ? (
            <EmptyState
              icon={FileArchive}
              title="مشتری‌ای در این محدوده نیست"
              description="فیلترها را تغییر دهید یا بازه تاریخ را پاک کنید"
              compact
            />
          ) : mode === "visas" ? (
            <EmptyState
              icon={BadgeCheck}
              title="هنوز فایل ویزایی بارگذاری نشده"
              description={`${toPersianDigits(scopeCustomerIds.length)} مشتری ویزای صادرشده دارند اما در پرونده‌شان PDF ویزا ثبت نشده — از پرونده مشتری، بخش «ویزای صادر شده» بارگذاری کنید`}
              compact
              action={
                <Link to="/customers" className="btn btn-glass btn-sm">
                  رفتن به مشتریان
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Inbox}
              title="فایلی برای این مشتری‌ها پیدا نشد"
              description="محتوای بایگانی (مدارک/ویزاها/عکس) را بررسی کنید یا فیلترها را تغییر دهید"
              compact
            />
          )
        ) : (
          <div className="flex flex-col gap-3">
            {/* stats */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="chip num">{toPersianDigits(plan.stats.included)} فایل</span>
              <span className="chip num">{toPersianDigits(plan.stats.folders)} پوشه</span>
              <span className="chip num">{formatBytes(plan.stats.bytes)}</span>
              {plan.stats.excluded > 0 && (
                <span className="chip num !bg-[#fdeaea] !text-[#c0392b]">
                  {toPersianDigits(plan.stats.excluded)} حذف‌شده
                </span>
              )}
              {plan.stats.renamed > 0 && (
                <span className="chip num !bg-[#fdf2dd] !text-[#a56a06]">
                  {toPersianDigits(plan.stats.renamed)} تغییر نام
                </span>
              )}
            </div>

            {/* issues */}
            {plan.issues.length > 0 && (
              <div className="rounded-2xl border border-[#fdf2dd] bg-[#fdf2dd]/50 p-2.5 text-[11px] leading-5 text-[#a56a06] dark:bg-[#fdf2dd]/10">
                {plan.issues.slice(0, 4).map((is, i) => (
                  <p key={i}>• {is.message}</p>
                ))}
                {plan.issues.length > 4 && (
                  <p>و {toPersianDigits(plan.issues.length - 4)} مورد دیگر…</p>
                )}
              </div>
            )}

            {/* tree */}
            <div className="max-h-[26rem] overflow-y-auto rounded-2xl border border-ink-900/8 dark:border-white/10">
              {tree.map(([folder, items]) => {
                const isRoot = folder === "—";
                const collapsedNow = collapsed.has(folder);
                return (
                  <div key={folder} data-folder={folder}>
                    <button
                      type="button"
                      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-ink-900/6 bg-white/85 px-3 py-2 text-right backdrop-blur dark:border-white/8 dark:bg-ink-950/80"
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(folder)) next.delete(folder);
                          else next.add(folder);
                          return next;
                        })
                      }
                      aria-expanded={!collapsedNow}
                    >
                      <ChevronDown
                        size={14}
                        className={`shrink-0 text-ink-400 transition-transform ${collapsedNow ? "-rotate-90" : ""}`}
                      />
                      {isRoot ? (
                        <FolderOpen size={15} className="shrink-0 text-brand-500" />
                      ) : (
                        <Folder size={15} className="shrink-0 text-brand-500" />
                      )}
                      <span className="min-w-0 truncate text-[12px] font-bold" dir="auto">
                        {isRoot ? "ریشه ZIP (بدون پوشه)" : folder}
                      </span>
                      <span className="chip-soft num mr-auto shrink-0 rounded-full px-2 py-0.5 text-[10px]">
                        {toPersianDigits(items.length)}
                      </span>
                    </button>
                    {!collapsedNow && (
                      <ul className="divide-y divide-ink-900/5 dark:divide-white/5">
                        {items.map((it) => {
                          const ov = overrides[it.entry.id];
                          const excluded = ov?.excluded === true;
                          return (
                            <li
                              key={it.entry.id}
                              className={`flex flex-wrap items-center gap-2 px-3 py-2 ${
                                excluded ? "opacity-45" : ""
                              }`}
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
                                {it.entry.kind === "issuedVisa" ? (
                                  <BadgeCheck size={15} />
                                ) : it.entry.mime.startsWith("image/") ? (
                                  <FileImage size={15} />
                                ) : (
                                  <FileText size={15} />
                                )}
                              </span>
                              <Input
                                dir="auto"
                                className="min-w-0 flex-1 !py-1.5 text-[12px]"
                                value={ov?.fileName ?? it.fileName}
                                onChange={(e) => setOverride(it.entry.id, { fileName: e.target.value })}
                                aria-label="نام فایل"
                              />
                              {!isRoot && (
                                <Input
                                  dir="auto"
                                  className="min-w-0 flex-1 !py-1.5 text-[12px]"
                                  value={ov?.folder ?? it.folder}
                                  onChange={(e) => setOverride(it.entry.id, { folder: e.target.value })}
                                  aria-label="پوشه مقصد"
                                />
                              )}
                              <span className="shrink-0 text-[10.5px] text-ink-400" title={it.entry.customerName}>
                                {it.entry.customerName}
                              </span>
                              <span className="shrink-0 text-[10.5px] text-ink-400">
                                {formatBytes(it.entry.size)}
                              </span>
                              <button
                                type="button"
                                className={`icon-btn !h-7 !w-7 shrink-0 ${excluded ? "" : "hover:!text-[#ef4444]"}`}
                                title={excluded ? "بازگرداندن به بایگانی" : "حذف از بایگانی"}
                                aria-label={excluded ? "بازگرداندن" : "حذف"}
                                onClick={() => setOverride(it.entry.id, { excluded: !excluded })}
                              >
                                {excluded ? <RotateCcw size={13} /> : "×"}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10.5px] leading-5 text-ink-400">
              نام هر فایل و پوشه مقصدش قابل ویرایش است؛ نام‌های تکراری خودکار شماره می‌خورند تا
              هیچ فایلی جای دیگری را نگیرد. محتوای فایل‌ها هرگز تغییر نمی‌کند.
            </p>
          </div>
        )}
      </SectionCard>

      {/* progress bar */}
      {busy && (
        <div className="glass fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md rounded-2xl p-3.5 shadow-lg sm:bottom-6">
          <div className="mb-2 flex items-center justify-between text-[12px] font-bold">
            <span className="flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" /> در حال ساخت بایگانی ZIP…
            </span>
            <span className="num">{toPersianDigits(progress)}٪</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-900/8 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-brand-500 transition-all"
              style={{ width: `${Math.max(3, progress)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
