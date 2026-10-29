import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  ChevronDown,
  FileArchive,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Inbox,
  Loader2,
  Paperclip,
  PenLine,
  RotateCcw,
  Sparkles,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, SectionCard, SearchBox } from "../components/ui/inputs";
import { Checkbox, Input, Toggle } from "../components/ui/fields";
import { OptionPicker } from "../components/ui/OptionPicker";
import { ArchiveTree, buildTree, type ArchiveTreeActions } from "../components/domain/ArchiveTree";
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
import { loadPageFilter, savePageFilter } from "../utils/pageFilters";
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
  resolveTemplate,
  type ArchiveEntry,
  type FileNaming,
  type FolderMode,
  type PlanOverride,
} from "../utils/smartArchive/engine";

type ArchiveMode = "visas" | "documents";

/** Everything about the archive structure the user can tune — persisted
 *  per mode (visas / documents) so the last setup is always remembered. */
interface StructPrefs {
  folderMode: FolderMode;
  fileNaming: FileNaming;
  singleFolderName: string;
  zipName: string;
  folderTemplate: string;
  nameTemplate: string;
  docSubfolders: boolean;
}

const FOLDER_MODES: { value: FolderMode; label: string; hint: string }[] = [
  {
    value: "perAgentCustomer",
    label: "نماینده ← مشتری",
    hint: "احمدی / علی رضایی / ویزا.pdf",
  },
  {
    value: "perAgent",
    label: "هر نماینده یک پوشه",
    hint: "احمدی / علی رضایی.pdf — فایل‌ها مستقیم داخل پوشه نماینده",
  },
  {
    value: "perCustomer",
    label: "هر مشتری یک پوشه",
    hint: "علی رضایی / فایل‌های او",
  },
  {
    value: "perFile",
    label: "هر فایل یک پوشه",
    hint: "هر فایل داخل پوشه‌ای به نام صاحبش — مناسب ارسال تک‌به‌تک",
  },
  { value: "single", label: "همه در یک پوشه", hint: "نام پوشه را خودتان تعیین می‌کنید" },
  { value: "flat", label: "بدون پوشه", hint: "همه فایل‌ها در ریشه ZIP" },
  { value: "custom", label: "ساختار دلخواه (الگو)", hint: "مسیر را با الگو بسازید: {نماینده}/{مشتری}" },
];

const NAMING_MODES: { value: FileNaming; label: string; hint: string }[] = [
  { value: "customerName", label: "نام مشتری", hint: "علی رضایی.pdf" },
  { value: "customerDoc", label: "مشتری - نوع مدرک", hint: "علی رضایی - پاسپورت.jpg" },
  { value: "docCustomer", label: "نوع مدرک - مشتری", hint: "پاسپورت - علی رضایی.jpg" },
  { value: "docLabel", label: "نوع مدرک", hint: "پاسپورت.jpg • id روی.jpg • ویزا.pdf" },
  { value: "passportNo", label: "شماره پاسپورت", hint: "A12345678.pdf — بدون پاسپورت: نام مشتری" },
  { value: "customerOriginal", label: "مشتری - نام اصلی", hint: "علی رضایی - scan.jpg" },
  { value: "sequence", label: "شماره‌گذاری", hint: "۱.pdf • ۲.pdf • ۳.jpg" },
  { value: "original", label: "نام اصلی فایل", hint: "همان نامی که هنگام بارگذاری داشت" },
  { value: "custom", label: "الگوی دلخواه", hint: "مثلا: {مشتری} - {مدرک} یا {پاسپورت}" },
];

/** Tokens available inside folder/name templates (Persian + English). */
const TEMPLATE_TOKENS: { token: string; desc: string }[] = [
  { token: "{نماینده}", desc: "نام نمایندهٔ مشتری" },
  { token: "{کارفرما}", desc: "نام کارفرمای مشتری" },
  { token: "{مشتری}", desc: "نام مشتری" },
  { token: "{مدرک}", desc: "نوع مدرک / ویزا" },
  { token: "{نوع}", desc: "ویزا | مدرک | پروفایل | فایل" },
  { token: "{شماره}", desc: "شمارهٔ فایل هر مشتری" },
  { token: "{پاسپورت}", desc: "شمارهٔ پاسپورت" },
  { token: "{تاریخ}", desc: "تاریخ فایل (شمسی)" },
  { token: "{سال}", desc: "سال شمسی" },
  { token: "{ماه}", desc: "نام ماه شمسی" },
];

const MODE_DEFAULTS: Record<
  ArchiveMode,
  {
    folderMode: FolderMode;
    fileNaming: FileNaming;
    singleFolderName: string;
    zipName: string;
    dateBasis: RequestDateBasis;
    folderTemplate: string;
    nameTemplate: string;
  }
> = {
  visas: {
    folderMode: "single",
    fileNaming: "customerName",
    singleFolderName: "ویزا های امروز صادر شده",
    zipName: "ویزا های صادر شده",
    dateBasis: "issued",
    folderTemplate: "{نماینده}/{مشتری}",
    nameTemplate: "{مشتری} - {مدرک}",
  },
  documents: {
    folderMode: "perCustomer",
    fileNaming: "docLabel",
    singleFolderName: "مدارک مشتریان",
    zipName: "مدارک مشتریان",
    dateBasis: "registration",
    folderTemplate: "{نماینده}/{مشتری}",
    nameTemplate: "{مشتری} - {مدرک}",
  },
};

const isFolderMode = (v: string): v is FolderMode =>
  ["perCustomer", "perAgentCustomer", "perAgent", "perFile", "single", "flat", "custom"].includes(v);

const isFileNaming = (v: string): v is FileNaming =>
  [
    "customerName",
    "customerDoc",
    "docCustomer",
    "docLabel",
    "passportNo",
    "customerOriginal",
    "sequence",
    "original",
    "custom",
  ].includes(v);

/** Load the remembered structure setup for a mode (with per-key validation). */
function loadStructPrefs(mode: ArchiveMode): StructPrefs {
  const d = MODE_DEFAULTS[mode];
  const page = `smart-archive-${mode}`;
  return {
    folderMode: loadPageFilter<FolderMode>(page, "folderMode", d.folderMode, isFolderMode),
    fileNaming: loadPageFilter<FileNaming>(page, "fileNaming", d.fileNaming, isFileNaming),
    singleFolderName: loadPageFilter(page, "singleFolderName", d.singleFolderName, () => true),
    zipName: loadPageFilter(page, "zipName", d.zipName, () => true),
    folderTemplate: loadPageFilter(page, "folderTemplate", d.folderTemplate, () => true),
    nameTemplate: loadPageFilter(page, "nameTemplate", d.nameTemplate, () => true),
    docSubfolders: loadPageFilter<string>(page, "docSubfolders", "0", () => true) === "1",
  };
}

/** A sample rendering of a template so the user sees what it produces. */
function templateExample(tpl: string): string {
  return (
    resolveTemplate(tpl, {
      rep: "احمدی",
      customer: "علی رضایی",
      doc: "پاسپورت",
      kind: "مدرک",
      seq: "۱",
      passport: "A12345678",
      date: "۱۴۰۴/۰۸/۰۶",
      year: "۱۴۰۴",
      month: "آبان",
    }) || "—"
  );
}

/* ------------------------------------------------------------------ */

/**
 * بایگانی هوشمند — export customer documents and issued-visa files as a
 * fully customizable ZIP archive. All report filters apply; folder structure
 * (incl. per-representative grouping and free-form templates), file naming,
 * the ZIP name and every single destination are under the user's control,
 * with a live drag-and-drop tree preview before download.
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

  /* --------------------- structure (persisted per mode) ------------------- */
  const [struct, setStruct] = useState<StructPrefs>(() => loadStructPrefs("visas"));
  const [folderNameDirty, setFolderNameDirty] = useState(false);
  const prefsPage = `smart-archive-${mode}`;

  /* --------------------- extra (user-added) empty folders ----------------- */
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState("");

  /* ---------------------- externally imported files ------------------------ */
  const [externalFiles, setExternalFiles] = useState<ArchiveEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const externalInputRef = useRef<HTMLInputElement>(null);

  /* --------------------------- preview editing ---------------------------- */
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, PlanOverride>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** folder bulk-rename (path being renamed) */
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** per-file inline rename (entry id + working value) */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [fileRenameValue, setFileRenameValue] = useState("");
  /** multi-select for bulk moves */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** touch-friendly «move to folder…» prompt inside the selection toolbar */
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  /* ------------------------------- download ------------------------------- */
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const collectToken = useRef(0);

  const quickRanges = useMemo(() => quickDateRanges(), []);
  const rangePlaceholders = basisRangePlaceholders(dateBasis);

  /* --------------------- persist the structure setup ---------------------- */
  useEffect(() => {
    savePageFilter(prefsPage, "folderMode", struct.folderMode);
    savePageFilter(prefsPage, "fileNaming", struct.fileNaming);
    savePageFilter(prefsPage, "singleFolderName", struct.singleFolderName);
    savePageFilter(prefsPage, "zipName", struct.zipName);
    savePageFilter(prefsPage, "folderTemplate", struct.folderTemplate);
    savePageFilter(prefsPage, "nameTemplate", struct.nameTemplate);
    savePageFilter(prefsPage, "docSubfolders", struct.docSubfolders ? "1" : "0");
  }, [prefsPage, struct]);

  /* ---------- structure changes release old folder overrides -------------- */
  /** When the folder rules change, dragged/renamed destinations from the old
   *  structure would silently pin files to stale paths — release ONLY the
   *  folder part of each override; manual file renames stay untouched. */
  useEffect(() => {
    setOverrides((prev) => {
      const next: Record<string, PlanOverride> = {};
      let changed = false;
      for (const [id, ov] of Object.entries(prev)) {
        if (ov.folder !== undefined) changed = true;
        else next[id] = ov;
      }
      return changed ? next : prev;
    });
  }, [struct.folderMode, struct.folderTemplate, struct.docSubfolders]);

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
  }, [scopeKey, mode, includeDocs, includeVisas, includePhotos]);

  /* --------------------------------- plan --------------------------------- */
  /** DB entries + externally imported files — one candidate list. */
  const allEntries = useMemo(
    () => [...(entries ?? []), ...externalFiles],
    [entries, externalFiles],
  );
  const plan = useMemo(
    () =>
      buildPlan(
        allEntries,
        {
          folderMode: struct.folderMode,
          singleFolderName: struct.singleFolderName,
          folderTemplate: struct.folderTemplate,
          fileNaming: struct.fileNaming,
          nameTemplate: struct.nameTemplate,
          docSubfolders: struct.docSubfolders,
          extraFolders,
        },
        overrides,
      ),
    [allEntries, struct, extraFolders, overrides],
  );

  const tree = useMemo(() => buildTree(plan.items, plan.emptyFolders), [plan]);

  /* ------------------------------ interactions ---------------------------- */

  const switchMode = (m: string) => {
    if (m === mode) return;
    const next: ArchiveMode = m === "visas" || m === "documents" ? m : "visas";
    setMode(next);
    setStruct(loadStructPrefs(next));
    setFolderNameDirty(false);
    setDateBasis(MODE_DEFAULTS[next].dateBasis);
    setStatus("");
    setOverrides({});
    setSelectedIds(new Set());
  };

  const applyQuickRange = (fromIso: string, toIso: string, label: string) => {
    setFrom(fromIso);
    setTo(toIso);
    // helpful default folder name for the classic "visas issued today" case
    if (mode === "visas" && !folderNameDirty && struct.folderMode === "single") {
      setStruct((s) => ({ ...s, singleFolderName: `ویزا های ${label} صادر شده` }));
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

  /** Import files from the device (file picker or drag & drop) — any type,
   *  any count. Original bytes are kept; nothing is uploaded anywhere. */
  const addExternalFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const stamp = Date.now();
    const added: ArchiveEntry[] = arr.map((f, i) => ({
      id: `ext-${stamp}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      blob: f,
      originalName: f.name || `فایل ${i + 1}`,
      mime: f.type || "application/octet-stream",
      size: f.size,
      customerId: "external",
      customerName: "",
      kind: "external",
      docLabel: (f.name || "فایل").replace(/\.[a-z0-9]{1,6}$/i, ""),
    }));
    setExternalFiles((prev) => [...prev, ...added]);
    toast.success(
      `${toPersianDigits(added.length)} فایل اضافه شد — مقصدشان را در پیش‌نمایش عوض کنید`,
    );
  };

  const removeExternal = (id: string) =>
    setExternalFiles((prev) => prev.filter((e) => e.id !== id));

  /** Add a custom (possibly nested "a/b") folder — kept in the ZIP even when empty. */
  const addExtraFolder = () => {
    const v = newFolderName.trim().replace(/^[/\s]+|[/\s]+$/g, "");
    if (!v) return;
    if (!extraFolders.some((f) => f.toLowerCase() === v.toLowerCase())) {
      setExtraFolders((prev) => [...prev, v]);
    }
    setNewFolderName("");
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

  /** Bulk-rename a folder in the preview — moves EVERY file inside it,
   *  including files in nested subfolders (prefix-aware). */
  const applyFolderRename = () => {
    const key = renamingFolder;
    if (key === null) return;
    const old = key === "—" ? "" : key;
    const next = renameValue.trim().replace(/^\/+|\/+$/g, "");
    if (next !== old) {
      setOverrides((prev) => {
        const nextOv = { ...prev };
        for (const it of plan.items) {
          const inside =
            it.folder === old || (old !== "" && it.folder.startsWith(`${old}/`));
          if (inside) {
            const moved =
              it.folder === old ? next : `${next}${it.folder.slice(old.length)}`;
            nextOv[it.entry.id] = {
              ...nextOv[it.entry.id],
              folder: moved.replace(/^\/+|\/+$/g, ""),
            };
          }
        }
        return nextOv;
      });
    }
    setRenamingFolder(null);
  };

  const applyFileRename = () => {
    if (renamingId !== null && fileRenameValue.trim() !== "") {
      setOverride(renamingId, { fileName: fileRenameValue.trim() });
    }
    setRenamingId(null);
  };

  /** Drag & drop (or «انتقال به پوشه…») — move entries to a new folder. */
  const moveEntries = (ids: string[], folder: string) => {
    if (ids.length === 0) return;
    setOverrides((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { ...next[id], folder };
      return next;
    });
    setSelectedIds(new Set());
    setMoveOpen(false);
    setMoveTarget("");
    toast.success(
      ids.length === 1
        ? "فایل به پوشهٔ جدید منتقل شد"
        : `${toPersianDigits(ids.length)} فایل به پوشهٔ جدید منتقل شد`,
    );
  };

  const bulkExclude = () => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) next[id] = { ...next[id], excluded: true };
      return next;
    });
    setSelectedIds(new Set());
  };

  const resetEdits = () => {
    setOverrides({});
    setSelectedIds(new Set());
    setRenamingFolder(null);
    setRenamingId(null);
  };

  const download = async () => {
    if (plan.items.length === 0 && plan.emptyFolders.length === 0) return;
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      const res = await generateAndSave(
        plan.items,
        struct.zipName,
        setProgress,
        plan.emptyFolders,
      );
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

  const treeActions: ArchiveTreeActions = {
    overrides,
    collapsed,
    onToggleCollapse: (path) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    renamingFolder,
    folderRenameValue: renameValue,
    onFolderRenameStart: (path) => {
      setRenamingFolder(path);
      setRenameValue(path);
    },
    onFolderRenameChange: setRenameValue,
    onFolderRenameCommit: applyFolderRename,
    onFolderRenameCancel: () => setRenamingFolder(null),
    renamingId,
    fileRenameValue,
    onFileRenameStart: (id, currentName) => {
      setRenamingId(id);
      setFileRenameValue(currentName);
    },
    onFileRenameChange: setFileRenameValue,
    onFileRenameCommit: applyFileRename,
    onFileRenameCancel: () => setRenamingId(null),
    selection: selectedIds,
    onToggleSelect: (id) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onMoveEntries: moveEntries,
    onExclude: (id, excluded) => setOverride(id, { excluded }),
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
            disabled={busy || (plan.items.length === 0 && plan.emptyFolders.length === 0)}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
            {busy
              ? `در حال ساخت… ${toPersianDigits(progress)}٪`
              : `دانلود ZIP (${toPersianDigits(plan.items.length)} فایل)`}
          </button>
        }
      />

      {/* Mode — compact pill switcher (no stretching) */}
      <div
        className="glass mx-auto flex w-fit gap-1 rounded-full p-1.5"
        role="radiogroup"
        aria-label="نوع بایگانی"
      >
        {(
          [
            { value: "visas", label: "ویزاهای صادر شده", icon: BadgeCheck },
            { value: "documents", label: "مدارک مشتریان", icon: FolderOpen },
          ] as const
        ).map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            onClick={() => switchMode(m.value)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-5 py-2.5 text-[13px] font-bold transition-all ${
              mode === m.value
                ? "bg-brand-500 text-white shadow-[0_6px_18px_-6px_rgba(99,91,255,0.55)]"
                : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100"
            }`}
          >
            <m.icon size={16} />
            {m.label}
          </button>
        ))}
      </div>

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
                className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${
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

      {/* Extra files from the device — both modes */}
      <SectionCard
        title="فایل‌های اضافی از دستگاه (اختیاری)"
        icon={<Paperclip size={15} className="text-brand-500" />}
        action={
          externalFiles.length > 0 ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setExternalFiles([])}
            >
              حذف همه ({toPersianDigits(externalFiles.length)})
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2.5">
          <input
            ref={externalInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addExternalFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div
            role="button"
            tabIndex={0}
            aria-label="افزودن فایل"
            onClick={() => externalInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") externalInputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addExternalFiles(e.dataTransfer.files);
            }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-4 text-center transition-all ${
              dragOver
                ? "border-brand-500 bg-brand-500/8"
                : "border-ink-900/15 hover:border-brand-400 hover:bg-brand-500/4 dark:border-white/15"
            }`}
          >
            <Upload
              size={20}
              className={`mx-auto mb-1.5 ${dragOver ? "text-brand-500" : "text-ink-400"}`}
            />
            <p className="text-[12px] font-bold">
              انتخاب فایل — یا همین‌جا رها کنید (Drag & Drop)
            </p>
            <p className="mt-0.5 text-[10.5px] leading-4 text-ink-400">
              هر نوع فایلی و هر تعداد — PDF، عکس، آفیس و… محتوا تغییر نمی‌کند و جایی آپلود نمی‌شود
            </p>
          </div>
          {externalFiles.length > 0 && (
            <ul className="max-h-40 divide-y divide-ink-900/5 overflow-y-auto rounded-2xl border border-ink-900/8 dark:divide-white/5 dark:border-white/10">
              {externalFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2 px-3 py-1.5">
                  <Paperclip size={13} className="shrink-0 text-brand-500" />
                  <span className="min-w-0 flex-1 truncate text-[12px]" dir="auto" title={f.originalName}>
                    {f.originalName}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-400">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="icon-btn !h-6 !w-6 shrink-0 hover:!text-[#ef4444]"
                    title="حذف"
                    aria-label={`حذف ${f.originalName}`}
                    onClick={() => removeExternal(f.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      {/* Structure + naming — compact collapsible pickers instead of button grids */}
      <SectionCard title="ساختار پوشه‌ها و نام‌گذاری" icon={<FolderTree size={15} className="text-brand-500" />}>
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <div className="flex flex-col gap-2.5">
            <OptionPicker
              label="ساختار پوشه‌ها"
              icon={FolderTree}
              options={FOLDER_MODES}
              value={struct.folderMode}
              onChange={(v) => setStruct((s) => ({ ...s, folderMode: v as FolderMode }))}
              stayOpenOn={["custom", "single"]}
            >
              {struct.folderMode === "custom" && (
                <div className="mb-1.5 rounded-xl bg-brand-500/6 p-2.5">
                  <Input
                    dir="auto"
                    className="font-mono text-[12px]"
                    value={struct.folderTemplate}
                    onChange={(e) => setStruct((s) => ({ ...s, folderTemplate: e.target.value }))}
                    placeholder="{نماینده}/{مشتری}"
                    aria-label="الگوی مسیر پوشه‌ها"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {TEMPLATE_TOKENS.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        title={t.desc}
                        onClick={() =>
                          setStruct((s) => ({ ...s, folderTemplate: s.folderTemplate + t.token }))
                        }
                        className="rounded-full bg-brand-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-600 transition-all hover:bg-brand-500/20 dark:text-brand-300"
                        dir="ltr"
                      >
                        {t.token}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-4 text-ink-400" dir="auto">
                    نمونه: {templateExample(struct.folderTemplate)} — بخش‌های خالی حذف می‌شوند
                  </p>
                </div>
              )}
              {struct.folderMode === "single" && (
                <div className="mb-1.5 rounded-xl bg-brand-500/6 p-2.5">
                  <p className="mb-1 text-[11px] font-bold text-ink-500 dark:text-ink-400">نام پوشه:</p>
                  <Input
                    value={struct.singleFolderName}
                    onChange={(e) => {
                      setStruct((s) => ({ ...s, singleFolderName: e.target.value }));
                      setFolderNameDirty(true);
                    }}
                    placeholder="مثلا: ویزا های امروز صادر شده"
                  />
                </div>
              )}
              {(struct.folderMode === "perCustomer" ||
                struct.folderMode === "perAgent" ||
                struct.folderMode === "perAgentCustomer") && (
                <div className="mb-1.5 rounded-xl bg-brand-500/6 p-2.5">
                  <Toggle
                    checked={struct.docSubfolders}
                    onChange={() => setStruct((s) => ({ ...s, docSubfolders: !s.docSubfolders }))}
                    label="تفکیک در زیرپوشه‌های «مدارک» و «ویزاها»"
                  />
                </div>
              )}
            </OptionPicker>

            <OptionPicker
              label="نام‌گذاری فایل‌ها"
              icon={PenLine}
              options={NAMING_MODES}
              value={struct.fileNaming}
              onChange={(v) => setStruct((s) => ({ ...s, fileNaming: v as FileNaming }))}
              stayOpenOn={["custom"]}
            >
              {struct.fileNaming === "custom" && (
                <div className="mb-1.5 rounded-xl bg-brand-500/6 p-2.5">
                  <Input
                    dir="auto"
                    className="font-mono text-[12px]"
                    value={struct.nameTemplate}
                    onChange={(e) => setStruct((s) => ({ ...s, nameTemplate: e.target.value }))}
                    placeholder="{مشتری} - {مدرک}"
                    aria-label="الگوی نام فایل‌ها"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {TEMPLATE_TOKENS.map((t) => (
                      <button
                        key={t.token}
                        type="button"
                        title={t.desc}
                        onClick={() =>
                          setStruct((s) => ({ ...s, nameTemplate: s.nameTemplate + t.token }))
                        }
                        className="rounded-full bg-brand-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-600 transition-all hover:bg-brand-500/20 dark:text-brand-300"
                        dir="ltr"
                      >
                        {t.token}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10.5px] leading-4 text-ink-400" dir="auto">
                    نمونه: {templateExample(struct.nameTemplate)}.pdf
                  </p>
                </div>
              )}
            </OptionPicker>
          </div>

          <div className="flex flex-col gap-2.5">
            <div>
              <p className="mb-1.5 text-[12px] font-bold">نام فایل ZIP</p>
              <Input
                dir="auto"
                value={struct.zipName}
                onChange={(e) => setStruct((s) => ({ ...s, zipName: e.target.value }))}
                placeholder="archive"
              />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-bold">پوشه‌های خالی دلخواه (اختیاری)</p>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {extraFolders.map((f) => (
                    <span key={f} className="chip num !gap-1 !py-1">
                      <FolderOpen size={11} className="inline" /> {f}
                      <button
                        type="button"
                        className="mr-0.5 rounded-full px-1 text-[12px] leading-none hover:text-[#ef4444]"
                        aria-label={`حذف پوشه ${f}`}
                        onClick={() => setExtraFolders((p) => p.filter((x) => x !== f))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {extraFolders.length === 0 && (
                    <span className="text-[10.5px] text-ink-400">
                      پوشه‌ای اضافه نشده — برای ساخت پوشه خالی در ZIP، نامش را بنویسید
                    </span>
                  )}
                </div>
                <form
                  className="flex flex-wrap items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addExtraFolder();
                  }}
                >
                  <Input
                    dir="auto"
                    className="min-w-0 flex-1 !py-1.5 text-[12px] sm:!w-56 sm:flex-none"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder='مثلا: مدارک اضافی/۱۴۰۴ (با / تو در تو می‌شود)'
                  />
                  <button type="submit" className="btn btn-glass btn-sm">
                    <FolderPlus size={13} /> افزودن پوشه
                  </button>
                </form>
              </div>
            </div>
            <p className="mt-auto flex items-start gap-1.5 rounded-xl bg-brand-500/6 p-2.5 text-[10.5px] leading-5 text-ink-500 dark:text-ink-400">
              <Sparkles size={13} className="mt-0.5 shrink-0 text-brand-500" />
              آخرین تنظیمات ساختار برای هر حالت (ویزاها / مدارک) به‌خاطر سپرده می‌شود. برای
              گروه‌بندی بر اساس نماینده، ساختار «نماینده ← مشتری» را انتخاب کنید — هر
              نماینده یک پوشه و داخل آن پوشهٔ هر مشتری با فایل‌هایش.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* Preview */}
      <SectionCard
        title="پیش‌نمایش بایگانی"
        icon={<FolderTree size={15} className="text-brand-500" />}
        action={
          Object.keys(overrides).length > 0 || selectedIds.size > 0 ? (
            <button className="btn btn-ghost btn-sm" onClick={resetEdits}>
              <RotateCcw size={13} /> بازنشانی ویرایش‌ها
            </button>
          ) : undefined
        }
      >
        {collecting ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-400">
            <Loader2 size={17} className="animate-spin" /> در حال جمع‌آوری فایل‌ها…
          </div>
        ) : plan.items.length === 0 && plan.stats.excluded === 0 && plan.emptyFolders.length === 0 ? (
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
              {externalFiles.length > 0 && (
                <span className="chip num !bg-brand-500/12 !text-brand-600">
                  {toPersianDigits(externalFiles.length)} فایل اضافی
                </span>
              )}
              {plan.emptyFolders.length > 0 && (
                <span className="chip num">
                  {toPersianDigits(plan.emptyFolders.length)} پوشه خالی
                </span>
              )}
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

            {/* multi-select toolbar */}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-brand-400/40 bg-brand-500/8 px-3 py-2">
                <span className="text-[12px] font-bold text-brand-600 dark:text-brand-300">
                  {toPersianDigits(selectedIds.size)} فایل انتخاب شد — بکشید و روی پوشهٔ مقصد رها کنید
                </span>
                <div className="mr-auto flex flex-wrap items-center gap-1.5">
                  {moveOpen ? (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        moveEntries([...selectedIds], moveTarget.trim().replace(/^\/+|\/+$/g, ""));
                      }}
                    >
                      <Input
                        dir="auto"
                        className="!w-48 !py-1.5 text-[12px]"
                        value={moveTarget}
                        autoFocus
                        onChange={(e) => setMoveTarget(e.target.value)}
                        placeholder="مسیر پوشه (خالی = ریشه)"
                        aria-label="پوشه مقصد"
                      />
                      <button type="submit" className="btn btn-primary btn-sm !px-3.5">
                        انتقال
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm !px-3"
                        onClick={() => setMoveOpen(false)}
                      >
                        لغو
                      </button>
                    </form>
                  ) : (
                    <>
                      <button className="btn btn-glass btn-sm !px-3.5" onClick={() => setMoveOpen(true)}>
                        <FolderOpen size={13} /> انتقال به پوشه…
                      </button>
                      <button className="btn btn-danger-soft btn-sm !px-3.5" onClick={bulkExclude}>
                        حذف از بایگانی
                      </button>
                      <button
                        className="btn btn-ghost btn-sm !px-3"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        لغو انتخاب
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* the tree */}
            <ArchiveTree tree={tree} actions={treeActions} />

            <p className="text-[10.5px] leading-5 text-ink-400">
              فایل‌ها را بکشید و روی هر پوشه (حتی ریشه) رها کنید تا منتقل شوند؛ با تیک هر فایل،
              چندتایی را یک‌جا جابه‌جا یا حذف کنید. کلیک روی نام فایل = تغییر نام، مداد کنار
              پوشه = تغییر نام کل پوشه. نام‌های تکراری خودکار شماره می‌خورند تا هیچ فایلی جای
              دیگری را نگیرد. محتوای فایل‌ها هرگز تغییر نمی‌کند.
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
