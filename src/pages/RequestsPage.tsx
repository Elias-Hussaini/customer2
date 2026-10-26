import { useMemo, useState } from "react";
import { FilePlus2, Filter } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterSelect, SearchBox } from "../components/ui/inputs";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { RequestsTable } from "../components/domain/RequestsTable";
import { ExportDialog } from "../components/exports/ExportDialog";
import {
  useCustomers,
  useLists,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { uiActions } from "../components/layout/uiStore";
import { normalizeFa } from "../utils/normalize";
import { formatJalali } from "../utils/jalali";
import { formatMoney } from "../utils/num";
import { customerFullName } from "../db/customers";
import type { VisaRequest } from "../types";

export function RequestsPage() {
  const requests = useRequests();
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags();

  const [query, setQuery] = useState("");
  const [repId, setRepId] = useState("");
  const [listId, setListId] = useState("");
  const [status, setStatus] = useState("");
  const [visaType, setVisaType] = useState("");
  const [tagId, setTagId] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const visaTypes = useMemo(() => {
    const set = new Set((requests ?? []).map((r) => r.visaType).filter(Boolean) as string[]);
    return [...set].sort();
  }, [requests]);

  const customersById = useMemo(
    () => new Map((customers ?? []).map((c) => [c.id, c])),
    [customers],
  );

  const filtered = useMemo(() => {
    if (!requests) return [];
    const q = normalizeFa(query);
    return requests.filter((r) => {
      if (repId && r.representativeId !== repId) return false;
      if (listId && r.listId !== listId) return false;
      if (status === "issued" && !r.issued) return false;
      if (status === "pending" && r.issued) return false;
      if (visaType && r.visaType !== visaType) return false;
      if (tagId && !r.tags.includes(tagId)) return false;
      if (from && r.registrationDate < from) return false;
      if (to && r.registrationDate > to) return false;
      if (q) {
        const customer = customersById.get(r.customerId);
        const haystack = normalizeFa(
          `${customer ? customerFullName(customer) : ""} ${customer?.passportNo ?? ""} ${r.visaType ?? ""} ${r.notes ?? ""}`,
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [requests, query, repId, listId, status, visaType, tagId, from, to, customersById]);

  const exportRows = useMemo(
    () =>
      filtered.map((r) => {
        const c = customersById.get(r.customerId);
        return {
          customer: c ? customerFullName(c) : "",
          passportNo: c?.passportNo ?? "",
          visaType: r.visaType ?? "",
          representative:
            (representatives ?? []).find((x) => x.id === r.representativeId)?.name ?? "",
          list: (lists ?? []).find((l) => l.id === r.listId)?.name ?? "",
          tags:
            r.tags
              .map((t) => (tags ?? []).find((x) => x.id === t)?.name)
              .filter(Boolean)
              .join("، ") ?? "",
          amount: r.quotedAmount ?? "",
          currency: r.currency === "USD" ? "دلار" : r.currency === "IRT" ? "تومان" : "",
          registrationDate: formatJalali(r.registrationDate),
          issued: r.issued ? "صادر شده" : "در حال کار",
          issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
          notes: r.notes ?? "",
        };
      }),
    [filtered, customersById, representatives, lists, tags],
  );

  const repName = (id: string | null) => (representatives ?? []).find((r) => r.id === id)?.name ?? "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="درخواست‌های ویزا"
        subtitle={`${filtered.length} درخواست`}
        actions={
          <>
            <button className="btn btn-glass btn-sm" onClick={() => setExportOpen(true)}>
              <Filter size={14} className="rotate-180" /> خروجی
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => uiActions.openRequestModal()}>
              <FilePlus2 size={15} /> درخواست جدید
            </button>
          </>
        }
      />

      {/* Filter bar */}
      <div className="glass flex flex-col gap-3 rounded-3xl p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder="نام مشتری، پاسپورت…" className="min-w-[180px] flex-1" />
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
            ariaLabel="وضعیت"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "همه وضعیت‌ها" },
              { value: "issued", label: "صادر شده" },
              { value: "pending", label: "در حال کار" },
            ]}
          />
          <button
            className={`btn btn-sm ${showFilters ? "btn-glass" : "btn-ghost"}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            <Filter size={14} /> فیلترها
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2.5 border-t border-ink-900/5 pt-3 dark:border-white/5 sm:grid-cols-3 lg:grid-cols-5">
            <FilterSelect
              ariaLabel="لیست"
              value={listId}
              onChange={setListId}
              options={[
                { value: "", label: "همه لیست‌ها" },
                ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
            <FilterSelect
              ariaLabel="نوع ویزا"
              value={visaType}
              onChange={setVisaType}
              options={[
                { value: "", label: "همه انواع" },
                ...visaTypes.map((v) => ({ value: v, label: v })),
              ]}
            />
            <FilterSelect
              ariaLabel="تگ"
              value={tagId}
              onChange={setTagId}
              options={[
                { value: "", label: "همه تگ‌ها" },
                ...(tags ?? []).map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <div>
              <JalaliDatePicker value={from} onChange={setFrom} placeholder="از تاریخ" />
            </div>
            <div>
              <JalaliDatePicker value={to} onChange={setTo} placeholder="تا تاریخ" />
            </div>
          </div>
        )}
      </div>

      <RequestsTable
        requests={filtered}
        loading={requests === undefined}
        extras={{
          customers: customers ?? [],
          representatives: representatives ?? [],
          lists: lists ?? [],
          tags: tags ?? [],
        }}
        empty={
          <EmptyState
            icon={FilePlus2}
            title="درخواستی یافت نشد"
            description="فیلترها را تغییر دهید یا اولین درخواست ویزا را ثبت کنید"
            action={
              <button className="btn btn-primary btn-sm" onClick={() => uiActions.openRequestModal()}>
                <FilePlus2 size={15} /> درخواست جدید
              </button>
            }
          />
        }
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="گزارش درخواست‌های ویزا"
        subtitle={repName(repId || null) || "همه نمایندگان"}
        rows={exportRows}
        defaultFilename="requests-report"
        columns={[
          { key: "customer", header: "مشتری" },
          { key: "passportNo", header: "شماره پاسپورت" },
          { key: "visaType", header: "نوع ویزا" },
          { key: "representative", header: "نماینده" },
          { key: "list", header: "لیست" },
          { key: "tags", header: "تگ‌ها" },
          { key: "amount", header: "مبلغ" },
          { key: "currency", header: "ارز" },
          { key: "registrationDate", header: "تاریخ ثبت" },
          { key: "issued", header: "وضعیت" },
          { key: "issuedAt", header: "تاریخ صدور" },
          { key: "notes", header: "توضیحات" },
        ]}
      />
    </div>
  );
}

export type { VisaRequest };
export { formatMoney };
