import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  FileDown,
  FilePenLine,
  FilePlus2,
  FolderInput,
  FolderPlus,
  Home,
  ListChecks,
  Users,
} from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, SearchBox, SectionCard } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { Modal } from "../components/ui/Modal";
import { RequestsTable } from "../components/domain/RequestsTable";
import { ListFormModal } from "../components/domain/ListFormModal";
import { WinFolderIcon } from "../components/domain/FolderIcon";
import { ExportDialog } from "../components/exports/ExportDialog";
import { StageIndicators } from "../components/ui/StageBadge";
import { beginCustomerHover, endCustomerHover } from "../components/domain/customerHotkeys";
import { moveRequestsToList } from "../db/requests";
import { childrenOf } from "../db/lists";
import { uiActions } from "../components/layout/uiStore";
import {
  useCustomers,
  useLists,
  useList,
  useRepresentatives,
  useRequests,
  useStageMap,
  useTags,
  useEmployers,
  usePrefs,
} from "../hooks/useData";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { normalizeFa } from "../utils/normalize";
import {
  REQUEST_DATE_BASIS_OPTIONS,
  basisRangePlaceholders,
  isRequestDateBasis,
  requestWithinRange,
  type RequestDateBasis,
} from "../utils/requestDateFilter";
import { customerFullName } from "../db/customers";
import { requestStatusFa } from "../types";
import type { VisaRequest, ListFolder } from "../types";
import { currencyLabel } from "../types";

export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const list = useList(id);
  const lists = useLists();
  const requests = useRequests();
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const employers = useEmployers();
  const prefs = usePrefs();
  const tags = useTags();
  const stageMap = useStageMap();
  /** کارفرما joins exports when the feature is on. */
  const employerFieldOn = (prefs.employerFieldEnabled ?? true) !== false;

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  /** Which request date (registration / issuance / rejection) the range applies to. */
  const [dateBasis, setDateBasis] = useState<RequestDateBasis>("registration");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<VisaRequest | null>(null);
  const [moveListId, setMoveListId] = useState("");

  /** Breadcrumb chain of THIS folder (root → parent → … → this list). */
  const path = useMemo<ListFolder[]>(() => {
    if (!list || !lists) return [];
    const byId = new Map(lists.map((l) => [l.id, l]));
    const chain: ListFolder[] = [];
    let cursor: string | null = list.parentId ?? null;
    const seen = new Set<string>([list.id]);
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const f: ListFolder | undefined = byId.get(cursor);
      if (!f) break;
      chain.unshift(f);
      cursor = f.parentId ?? null;
    }
    return chain;
  }, [list, lists]);

  /** Sub-folders living directly inside this folder. */
  const subFolders = useMemo(
    () => (list ? childrenOf(lists ?? [], list.id) : []),
    [lists, list],
  );

  const inList = useMemo(
    () => (requests ?? []).filter((r) => r.listId === id),
    [requests, id],
  );

  /** Customers registered inside this list (directly, or via a request). */
  const listCustomers = useMemo(() => {
    const ids = new Set(inList.map((r) => r.customerId));
    return (customers ?? []).filter((c) => c.listId === id || ids.has(c.id));
  }, [customers, inList, id]);

  const repById = useMemo(
    () => new Map((representatives ?? []).map((r) => [r.id, r])),
    [representatives],
  );

  const filtered = useMemo(() => {
    const q = normalizeFa(query);
    return inList.filter((r) => {
      if (status === "issued" && !r.issued) return false;
      if (status === "pending" && (r.issued || r.rejected)) return false;
      if (status === "rejected" && !r.rejected) return false;
      if (!requestWithinRange(r, dateBasis, from, to)) return false;
      if (q) {
        const c = (customers ?? []).find((x) => x.id === r.customerId);
        const hay = normalizeFa(`${c ? customerFullName(c) : ""} ${c?.passportNo ?? ""} ${r.visaType ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [inList, query, status, dateBasis, from, to, customers]);

  if (!list) {
    return (
      <EmptyState
        icon={ListChecks}
        title="لیست یافت نشد"
        action={<Link to="/lists" className="btn btn-glass btn-sm">بازگشت به لیست‌ها</Link>}
      />
    );
  }

  const issued = inList.filter((r) => r.issued).length;
  const rejectedCount = inList.filter((r) => r.rejected && !r.issued).length;

  const doMove = async () => {
    if (!moveTarget || !moveListId) return;
    await moveRequestsToList([moveTarget.id], moveListId);
    toast.success("درخواست به لیست جدید منتقل شد");
    setMoveTarget(null);
    setMoveListId("");
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={list.name}
        subtitle={
          <>
            {list.category ? `${list.category} • ` : ""}
            {toPersianDigits(listCustomers.length)} مشتری • {toPersianDigits(inList.length)} درخواست • {toPersianDigits(issued)} صادر شده
            {rejectedCount > 0 && (
              <span className="text-[#dc3535] dark:text-[#f87b7b]"> • {toPersianDigits(rejectedCount)} رد شده</span>
            )}
            {(list.startDate || list.endDate) && (
              <span className="num">
                {" "}
                • {list.startDate ? formatJalali(list.startDate, "medium") : "…"} تا{" "}
                {list.endDate ? formatJalali(list.endDate, "medium") : "…"}
              </span>
            )}
          </>
        }
        actions={
          <>
            <button className="btn btn-glass btn-sm" onClick={() => setExportOpen(true)}>
              <FileDown size={14} /> خروجی
            </button>
            <button className="btn btn-glass btn-sm" onClick={() => setEditOpen(true)}>
              <FilePenLine size={14} /> ویرایش
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => uiActions.openRequestModal({ listId: list.id })}
            >
              <FilePlus2 size={14} /> درخواست جدید
            </button>
          </>
        }
      />

      {/* ------------------- explorer breadcrumb + back ------------------- */}
      <div className="glass flex flex-wrap items-center gap-1.5 rounded-2xl px-2.5 py-2">
        <button
          className="icon-btn glass !h-8 !w-8"
          aria-label="بازگشت"
          title="بازگشت به پوشه قبلی"
          onClick={() =>
            list.parentId ? navigate(`/lists?folder=${list.parentId}`) : navigate("/lists")
          }
        >
          <ChevronLeft size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-ink-900/10 dark:bg-white/10" />
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" aria-label="مسیر پوشه">
          <Link
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-bold transition-colors hover:bg-brand-500/10"
            to="/lists"
          >
            <Home size={14} />
            خانه
          </Link>
          {path.map((f) => (
            <span key={f.id} className="flex shrink-0 items-center gap-0.5">
              <ChevronLeft size={13} className="text-ink-400" />
              <Link
                className="shrink-0 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-ink-600 transition-colors hover:bg-brand-500/10 dark:text-ink-300"
                to={`/lists?folder=${f.id}`}
              >
                {f.name}
              </Link>
            </span>
          ))}
          <span className="flex shrink-0 items-center gap-0.5">
            <ChevronLeft size={13} className="text-ink-400" />
            <span className="rounded-lg px-2 py-1.5 text-[12.5px] font-extrabold text-brand-600 dark:text-brand-300">
              {list.name}
            </span>
          </span>
        </nav>
        <button className="btn btn-glass btn-sm shrink-0" onClick={() => setSubOpen(true)}>
          <FolderPlus size={14} /> زیرپوشه جدید
        </button>
      </div>

      {/* ------------------------- sub-folders --------------------------- */}
      {subFolders.length > 0 && (
        <div className="glass rounded-3xl p-3">
          <p className="mb-1.5 px-1 text-[11px] font-bold text-ink-500 dark:text-ink-400">
            زیرپوشه‌های این پوشه
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {subFolders.map((sub) => (
              <button
                key={sub.id}
                className="win-folder"
                onClick={() => navigate(`/lists/${sub.id}`)}
                aria-label={`باز کردن پوشه ${sub.name}`}
              >
                <WinFolderIcon size={44} />
                <span className="win-folder-name">{sub.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {list.description && (
        <p className="text-[13px] leading-6 text-ink-600 dark:text-ink-300">{list.description}</p>
      )}

      <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-3.5">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="جستجو در این لیست…"
          className="min-w-[180px] flex-1"
        />
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
        <FilterSelect
          ariaLabel="مبنای بازه تاریخ"
          value={dateBasis}
          onChange={(v) => setDateBasis(isRequestDateBasis(v) ? v : "registration")}
          options={REQUEST_DATE_BASIS_OPTIONS.map((o) => ({ value: o.value, label: `مبنای بازه: ${o.label}` }))}
        />
        <JalaliDatePicker
          value={from}
          onChange={setFrom}
          placeholder={basisRangePlaceholders(dateBasis).from}
          className="w-40"
        />
        <JalaliDatePicker
          value={to}
          onChange={setTo}
          placeholder={basisRangePlaceholders(dateBasis).to}
          className="w-40"
        />
      </div>

      {/* Customers registered in this list */}
      {listCustomers.length > 0 && (
        <SectionCard
          title={`مشتریان این لیست (${toPersianDigits(listCustomers.length)})`}
          icon={<Users size={15} className="text-brand-500" />}
        >
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {listCustomers.map((c) => {
              const rep = repById.get(c.representativeId ?? "");
              return (
                <button
                  key={c.id}
                  className="glass rounded-2xl p-3.5 text-right transition-transform active:scale-95"
                  onClick={() => navigate(`/customers/${c.id}`)}
                  onMouseEnter={(e) => beginCustomerHover(c.id, e.currentTarget)}
                  onMouseLeave={() => endCustomerHover(c.id)}
                >
                  <p className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold">{customerFullName(c)}</span>
                    <StageIndicators
                      stage={stageMap?.get(c.id)}
                      hasCode={!!c.referrer?.trim()}
                      dotSize={9}
                    />
                  </p>
                  {c.passportNo && (
                    <p dir="ltr" className="num mt-1 text-[11px] text-ink-400">
                      {c.passportNo}
                    </p>
                  )}
                  {rep && (
                    <p className="mt-1 truncate text-[10.5px] text-ink-500 dark:text-ink-400">
                      نماینده: {rep.name}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      <RequestsTable
        requests={filtered}
        loading={requests === undefined}
        onMove={(r) => setMoveTarget(r)}
        extras={{
          customers: customers ?? [],
          representatives: representatives ?? [],
          lists: lists ?? [],
          tags: tags ?? [],
          hideListColumn: true,
        }}
        empty={
          <EmptyState
            icon={ListChecks}
            title="این لیست خالی است"
            description="درخواست‌های جدید را هنگام ثبت به این لیست اضافه کنید یا از جدول همه درخواست‌ها، درخواستی را منتقل کنید"
            action={
              <button
                className="btn btn-primary btn-sm"
                onClick={() => uiActions.openRequestModal({ listId: list.id })}
              >
                <FilePlus2 size={14} /> افزودن درخواست
              </button>
            }
          />
        }
      />

      <ListFormModal open={editOpen} onClose={() => setEditOpen(false)} list={list} />
      <ListFormModal open={subOpen} onClose={() => setSubOpen(false)} parentId={list.id} />

      {/* Move-to-list modal */}
      <Modal
        open={moveTarget != null}
        onClose={() => setMoveTarget(null)}
        title="انتقال درخواست"
        size="sm"
      >
        <SectionCard title="لیست مقصد" className="!p-0">
          <select className="field" value={moveListId} onChange={(e) => setMoveListId(e.target.value)}>
            <option value="">— انتخاب لیست —</option>
            {(lists ?? [])
              .filter((l) => l.id !== id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </SectionCard>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={() => setMoveTarget(null)}>
            انصراف
          </button>
          <button className="btn btn-primary" disabled={!moveListId} onClick={() => void doMove()}>
            <FolderInput size={15} /> انتقال
          </button>
        </div>
      </Modal>

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`لیست ${list.name}`}
        subtitle={list.category}
        rows={filtered.map((r) => {
          const c = (customers ?? []).find((x) => x.id === r.customerId);
          return {
            customerId: r.customerId,
            customer: c ? customerFullName(c) : "",
            passportNo: c?.passportNo ?? "",
            visaType: r.visaType ?? "",
            representative: (representatives ?? []).find((x) => x.id === r.representativeId)?.name ?? "",
            ...(employerFieldOn
              ? {
                  employer: c?.employerId
                    ? ((employers ?? []).find((e) => e.id === c.employerId)?.name ?? "بدون کارفرما")
                    : "بدون کارفرما",
                }
              : {}),
            amount: r.quotedAmount ?? "",
            currency: currencyLabel(r.currency),
            registrationDate: formatJalali(r.registrationDate),
            status: requestStatusFa(r),
            issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
            rejectedAt: r.rejectedAt ? formatJalali(r.rejectedAt) : "",
            notes: r.notes ?? "",
          };
        })}
        defaultFilename={`list-${list.name}`}
        summary={[
          { label: "لیست", value: list.name },
          { label: "درخواست‌ها", value: toPersianDigits(filtered.length) },
          { label: "صادر شده", value: toPersianDigits(issued) },
          ...(rejectedCount > 0 ? [{ label: "رد شده", value: toPersianDigits(rejectedCount) }] : []),
        ]}
        columns={[
          { key: "customer", header: "مشتری" },
          { key: "passportNo", header: "پاسپورت" },
          { key: "visaType", header: "نوع ویزا" },
          { key: "representative", header: "نماینده" },
          ...(employerFieldOn ? [{ key: "employer", header: "کارفرما" }] : []),
          { key: "amount", header: "مبلغ" },
          { key: "currency", header: "ارز" },
          { key: "registrationDate", header: "تاریخ ثبت" },
          { key: "status", header: "وضعیت" },
          { key: "issuedAt", header: "تاریخ صدور" },
          { key: "rejectedAt", header: "تاریخ رد" },
          { key: "notes", header: "توضیحات" },
        ]}
        grouping={{
          columnKey: "representative",
          label: "نماینده",
          photos: Object.fromEntries(
            (representatives ?? []).map((r) => [r.name, r.photo ?? undefined]),
          ),
        }}
        rowPhotos={{
          columnKey: "customer",
          idKey: "customerId",
          photos: Object.fromEntries(
            (customers ?? []).map((c) => [c.id, c.photo ?? undefined]),
          ),
        }}
      />
    </div>
  );
}
