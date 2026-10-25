import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileDown, FilePenLine, FilePlus2, FolderInput, ListChecks, Users } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, SearchBox, SectionCard } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { Modal } from "../components/ui/Modal";
import { RequestsTable } from "../components/domain/RequestsTable";
import { ListFormModal } from "../components/domain/ListFormModal";
import { ExportDialog } from "../components/exports/ExportDialog";
import { moveRequestsToList } from "../db/requests";
import { uiActions } from "../components/layout/uiStore";
import {
  useCustomers,
  useLists,
  useList,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { useToast } from "../hooks/useToast";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { normalizeFa } from "../utils/normalize";
import { customerFullName } from "../db/customers";
import type { VisaRequest } from "../types";

export function ListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const list = useList(id);
  const lists = useLists();
  const requests = useRequests();
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const tags = useTags();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<VisaRequest | null>(null);
  const [moveListId, setMoveListId] = useState("");

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
      if (status === "pending" && r.issued) return false;
      if (from && r.registrationDate < from) return false;
      if (to && r.registrationDate > to) return false;
      if (q) {
        const c = (customers ?? []).find((x) => x.id === r.customerId);
        const hay = normalizeFa(`${c ? customerFullName(c) : ""} ${c?.passportNo ?? ""} ${r.visaType ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [inList, query, status, from, to, customers]);

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
        back
        title={list.name}
        subtitle={
          <>
            {list.category ? `${list.category} • ` : ""}
            {toPersianDigits(listCustomers.length)} مشتری • {toPersianDigits(inList.length)} درخواست • {toPersianDigits(issued)} صادر شده
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
              <FilePenLine size={14} /> ویرایش لیست
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
          ]}
        />
        <JalaliDatePicker value={from} onChange={setFrom} placeholder="از تاریخ" className="w-40" />
        <JalaliDatePicker value={to} onChange={setTo} placeholder="تا تاریخ" className="w-40" />
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
                >
                  <p className="truncate text-[13px] font-bold">{customerFullName(c)}</p>
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
            customer: c ? customerFullName(c) : "",
            passportNo: c?.passportNo ?? "",
            visaType: r.visaType ?? "",
            representative: (representatives ?? []).find((x) => x.id === r.representativeId)?.name ?? "",
            amount: r.quotedAmount ?? "",
            currency: r.currency === "USD" ? "دلار" : r.currency === "IRT" ? "تومان" : "",
            registrationDate: formatJalali(r.registrationDate),
            status: r.issued ? "صادر شده" : "در حال کار",
            issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
            notes: r.notes ?? "",
          };
        })}
        defaultFilename={`list-${list.name}`}
        summary={[
          { label: "لیست", value: list.name },
          { label: "درخواست‌ها", value: toPersianDigits(filtered.length) },
          { label: "صادر شده", value: toPersianDigits(issued) },
        ]}
        columns={[
          { key: "customer", header: "مشتری" },
          { key: "passportNo", header: "پاسپورت" },
          { key: "visaType", header: "نوع ویزا" },
          { key: "representative", header: "نماینده" },
          { key: "amount", header: "مبلغ" },
          { key: "currency", header: "ارز" },
          { key: "registrationDate", header: "تاریخ ثبت" },
          { key: "status", header: "وضعیت" },
          { key: "issuedAt", header: "تاریخ صدور" },
          { key: "notes", header: "توضیحات" },
        ]}
      />
    </div>
  );
}
