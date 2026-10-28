import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Filter, X } from "lucide-react";
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
import { requestStatusFa } from "../types";
import { loadPageFilter, savePageFilter } from "../utils/pageFilters";
import {
  REQUEST_DATE_BASIS_OPTIONS,
  basisRangePlaceholders,
  isRequestDateBasis,
  requestBasisLabel,
  requestWithinRange,
  type RequestDateBasis,
} from "../utils/requestDateFilter";
import type { VisaRequest } from "../types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function RequestsPage() {
  const requests = useRequests();
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags();

  // Last used filters are remembered across visits (free-text search is not).
  const [query, setQuery] = useState("");
  const [repId, setRepId] = useState<string>(() => loadPageFilter<string>("requests", "rep", "", () => true));
  const [listId, setListId] = useState<string>(() => loadPageFilter<string>("requests", "list", "", () => true));
  const [status, setStatus] = useState<string>(() =>
    loadPageFilter<string>("requests", "status", "", (v) => v === "issued" || v === "pending" || v === "rejected"),
  );
  const [visaType, setVisaType] = useState<string>(() => loadPageFilter<string>("requests", "visaType", "", () => true));
  const [tagId, setTagId] = useState<string>(() => loadPageFilter<string>("requests", "tag", "", () => true));
  const [from, setFrom] = useState<string | null>(
    () => loadPageFilter("requests", "from", "", (v) => ISO_DATE.test(v)) || null,
  );
  const [to, setTo] = useState<string | null>(
    () => loadPageFilter("requests", "to", "", (v) => ISO_DATE.test(v)) || null,
  );
  /** Which request date (registration / issuance / rejection) the range applies to. */
  const [dateBasis, setDateBasis] = useState<RequestDateBasis>(() =>
    loadPageFilter<RequestDateBasis>("requests", "dateBasis", "registration", isRequestDateBasis),
  );
  const [showFilters, setShowFilters] = useState(
    () => !!(listId || visaType || tagId || from || to),
  );
  const [exportOpen, setExportOpen] = useState(false);

  const visaTypes = useMemo(() => {
    const set = new Set((requests ?? []).map((r) => r.visaType).filter(Boolean) as string[]);
    return [...set].sort();
  }, [requests]);

  // Saved ids may reference rows that were deleted since — drop the stale
  // filter once the data has loaded instead of silently hiding everything.
  const keepIfKnown = (rows: { id: string }[] | undefined, id: string) =>
    rows === undefined ? id : rows.some((r) => r.id === id) ? id : "";
  const activeRepId = keepIfKnown(representatives, repId);
  const activeListId = keepIfKnown(lists, listId);
  const activeTagId = keepIfKnown(tags, tagId);
  const activeVisaType =
    requests === undefined ? visaType : visaTypes.includes(visaType) ? visaType : "";

  // Remember the last used filters (excluding the one-off free-text search).
  useEffect(() => {
    savePageFilter("requests", "rep", activeRepId);
    savePageFilter("requests", "list", activeListId);
    savePageFilter("requests", "status", status);
    savePageFilter("requests", "visaType", activeVisaType);
    savePageFilter("requests", "tag", activeTagId);
    savePageFilter("requests", "from", from);
    savePageFilter("requests", "to", to);
    savePageFilter("requests", "dateBasis", dateBasis);
  }, [activeRepId, activeListId, status, activeVisaType, activeTagId, from, to, dateBasis]);

  const anyFilter = !!(
    query.trim() || activeRepId || activeListId || status || activeVisaType || activeTagId || from || to
  );

  const clearFilters = () => {
    setQuery("");
    setRepId("");
    setListId("");
    setStatus("");
    setVisaType("");
    setTagId("");
    setFrom(null);
    setTo(null);
    setDateBasis("registration");
  };

  const customersById = useMemo(
    () => new Map((customers ?? []).map((c) => [c.id, c])),
    [customers],
  );

  const filtered = useMemo(() => {
    if (!requests) return [];
    const q = normalizeFa(query);
    return requests.filter((r) => {
      if (activeRepId && r.representativeId !== activeRepId) return false;
      if (activeListId && r.listId !== activeListId) return false;
      if (status === "issued" && !r.issued) return false;
      if (status === "pending" && (r.issued || r.rejected)) return false;
      if (status === "rejected" && !r.rejected) return false;
      if (activeVisaType && r.visaType !== activeVisaType) return false;
      if (activeTagId && !r.tags.includes(activeTagId)) return false;
      if (!requestWithinRange(r, dateBasis, from, to)) return false;
      if (q) {
        const customer = customersById.get(r.customerId);
        const haystack = normalizeFa(
          `${customer ? customerFullName(customer) : ""} ${customer?.passportNo ?? ""} ${r.visaType ?? ""} ${r.notes ?? ""}`,
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [requests, query, activeRepId, activeListId, status, activeVisaType, activeTagId, dateBasis, from, to, customersById]);

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
          issued: requestStatusFa(r),
          issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
          rejectedAt: r.rejectedAt ? formatJalali(r.rejectedAt) : "",
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
            value={activeRepId}
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
              { value: "rejected", label: "رد شده" },
            ]}
          />
          <button
            className={`btn btn-sm ${showFilters ? "btn-glass" : "btn-ghost"}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            <Filter size={14} /> فیلترها
          </button>
          {anyFilter && (
            <button className="btn btn-ghost btn-sm !text-rose-500 dark:!text-rose-400" onClick={clearFilters}>
              <X size={14} /> پاک‌کردن فیلترها
            </button>
          )}
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2.5 border-t border-ink-900/5 pt-3 dark:border-white/5 sm:grid-cols-3 lg:grid-cols-6">
            <FilterSelect
              ariaLabel="لیست"
              value={activeListId}
              onChange={setListId}
              options={[
                { value: "", label: "همه لیست‌ها" },
                ...(lists ?? []).map((l) => ({ value: l.id, label: l.name })),
              ]}
            />
            <FilterSelect
              ariaLabel="نوع ویزا"
              value={activeVisaType}
              onChange={setVisaType}
              options={[
                { value: "", label: "همه انواع" },
                ...visaTypes.map((v) => ({ value: v, label: v })),
              ]}
            />
            <FilterSelect
              ariaLabel="تگ"
              value={activeTagId}
              onChange={setTagId}
              options={[
                { value: "", label: "همه تگ‌ها" },
                ...(tags ?? []).map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <FilterSelect
              ariaLabel="مبنای بازه تاریخ"
              value={dateBasis}
              onChange={(v) => setDateBasis(isRequestDateBasis(v) ? v : "registration")}
              options={REQUEST_DATE_BASIS_OPTIONS.map((o) => ({ value: o.value, label: `مبنای بازه: ${o.label}` }))}
            />
            <div>
              <JalaliDatePicker
                value={from}
                onChange={setFrom}
                placeholder={basisRangePlaceholders(dateBasis).from}
              />
            </div>
            <div>
              <JalaliDatePicker
                value={to}
                onChange={setTo}
                placeholder={basisRangePlaceholders(dateBasis).to}
              />
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
        subtitle={[
          repName(repId || null) || "همه نمایندگان",
          from || to
            ? `${requestBasisLabel(dateBasis)}: ${from ? formatJalali(from) : "…"} تا ${to ? formatJalali(to) : "…"}`
            : null,
        ]
          .filter(Boolean)
          .join(" • ")}
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
          { key: "rejectedAt", header: "تاریخ رد" },
          { key: "notes", header: "توضیحات" },
        ]}
      />
    </div>
  );
}

export type { VisaRequest };
export { formatMoney };
