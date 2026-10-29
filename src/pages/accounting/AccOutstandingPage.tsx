/** Outstanding receivables & payables with partial settlements, due-date
 *  alerts, and settlement history. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ban, FileDown, MoreVertical, Plus, Scale, CheckCircle2 } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { SearchBox, FilterSelect } from "../../components/ui/inputs";
import { ExportDialog } from "../../components/exports/ExportDialog";
import { currencyLabel } from "../../types";
import type { Currency } from "../../types";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatJalali, todayIso } from "../../utils/jalali";
import { formatMoney } from "../../utils/num";
import { outstandingEffectiveStatus, outstandingRemaining } from "../../accounting/engine";
import { cancelOutstanding, removeSettlement } from "../../accounting/repo";
import {
  OUTSTANDING_KIND_LABELS,
  OUTSTANDING_STATUS_LABELS,
  type OutstandingItem,
} from "../../accounting/types";
import { useAccOutstanding, useAccParties } from "../../accounting/hooks";
import { OutstandingStatusPill } from "../../accounting/components/Bits";
import {
  OutstandingFormModal,
  SettleModal,
  SettlementHistory,
} from "../../accounting/components/OutstandingModals";

export function AccOutstandingPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const outstanding = useAccOutstanding();
  const parties = useAccParties();

  const [kindFilter, setKindFilter] = useState<"all" | "receivable" | "payable">("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [settleFor, setSettleFor] = useState<OutstandingItem | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const today = todayIso();
  const partyName = (id: string) => (parties ?? []).find((p) => p.id === id)?.name ?? "—";

  const rows = useMemo(() => {
    let list = outstanding ?? [];
    if (kindFilter !== "all") list = list.filter((o) => o.kind === kindFilter);
    if (statusFilter !== "all") {
      list = list.filter((o) => {
        const eff = outstandingEffectiveStatus(o, today);
        if (statusFilter === "open") return o.status === "open" || o.status === "partial";
        return eff === statusFilter;
      });
    }
    const q = query.trim();
    if (q) list = list.filter((o) => `${partyName(o.partyId)} ${o.description ?? ""} ${o.reference ?? ""}`.includes(q));
    return [...list].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  }, [outstanding, kindFilter, statusFilter, query, parties, today]);

  const sumRemaining = (cur: Currency) =>
    (outstanding ?? [])
      .filter((o) => o.kind === kindFilter || kindFilter === "all")
      .filter((o) => o.status !== "cancelled" && o.status !== "settled")
      .filter((o) => o.currency === cur)
      .reduce((s, o) => s + outstandingRemaining(o), 0);

  /** Rows for the shared export dialog — exactly what the current filter shows. */
  const exportRows = useMemo(
    () =>
      rows.map((o) => {
        const remaining = outstandingRemaining(o);
        const settled = o.amount - remaining;
        const eff = outstandingEffectiveStatus(o, today);
        let delay = "—";
        if (o.dueDate) {
          const diff = Math.round((Date.parse(today) - Date.parse(o.dueDate)) / 86_400_000);
          delay =
            diff >= 0
              ? `${diff.toLocaleString("fa-IR")} روز تأخیر`
              : `${(-diff).toLocaleString("fa-IR")} روز مانده`;
        }
        return {
          party: partyName(o.partyId),
          kind: OUTSTANDING_KIND_LABELS[o.kind],
          amount: o.amount.toLocaleString("fa-IR"),
          settled: settled.toLocaleString("fa-IR"),
          remaining: remaining.toLocaleString("fa-IR"),
          progress: `${Math.round((settled / (o.amount || 1)) * 100).toLocaleString("fa-IR")}٪`,
          currency: currencyLabel(o.currency),
          due: o.dueDate ? formatJalali(o.dueDate) : "بدون سررسید",
          delay,
          status: OUTSTANDING_STATUS_LABELS[eff],
          reference: o.reference ?? "",
          description: o.description ?? "",
        };
      }),
    [rows, parties, today],
  );

  const doCancel = async (item: OutstandingItem) => {
    const reason = window.prompt("دلیل ابطال این مانده (الزامی):");
    if (reason == null) return;
    if (!reason.trim()) {
      toast.error("دلیل ابطال الزامی است.");
      return;
    }
    try {
      await cancelOutstanding(item.id, reason);
      toast.success("مانده ابطال شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ابطال ناموفق بود.");
    }
  };

  const doRemoveSettlement = async (item: OutstandingItem, settlementId: string) => {
    const ok = await confirm({
      title: "حذف تسویه",
      message: "مبلغ این تسویه به مانده برمی‌گردد. ادامه می‌دهید؟",
      danger: true,
      confirmLabel: "حذف تسویه",
    });
    if (!ok) return;
    try {
      await removeSettlement(item.id, settlementId);
      toast.success("تسویه حذف شد و مانده بازمحاسبه شد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف ناموفق بود.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="جستجوی طرف حساب یا شرح…" className="min-w-[200px] flex-1" />
        <FilterSelect
          value={kindFilter}
          onChange={(v) => setKindFilter(v as typeof kindFilter)}
          options={[
            { value: "all", label: "مطالبات و بدهی‌ها" },
            { value: "receivable", label: "فقط مطالبات" },
            { value: "payable", label: "فقط بدهی‌ها" },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "open", label: "باز / جزئی" },
            { value: "overdue", label: "سررسید گذشته" },
            { value: "settled", label: "تسویه شده" },
            { value: "cancelled", label: "ابطال شده" },
            { value: "all", label: "همه" },
          ]}
        />
        <Button variant="glass" icon={FileDown} onClick={() => setExportOpen(true)}>
          خروجی
        </Button>
        <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>
          ثبت مانده
        </Button>
      </div>

      <div className="glass flex flex-wrap items-center gap-4 rounded-3xl px-4 py-3 text-xs">
        <span className="font-bold">
          {kindFilter === "payable" ? "بدهی‌های باز:" : kindFilter === "receivable" ? "مطالبات باز:" : "مانده‌های باز:"}
        </span>
        <span className="num font-extrabold">{formatMoney(sumRemaining("IRT"), "IRT")}</span>
        <span className="num font-extrabold">{formatMoney(sumRemaining("USD"), "USD")}</span>
      </div>

      {!outstanding ? (
        <div className="glass h-24 animate-pulse rounded-3xl" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="مانده‌ای در این نمایش نیست"
          description="مطالبات (طلب ما از طرف حساب) و بدهی‌ها (طلب طرف حساب از ما) را ثبت کنید؛ تسویه‌های جزئی و سررسیدگذشته‌ها همین‌جا دنبال می‌شوند."
          action={
            <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)}>
              ثبت اولین مانده
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((o) => {
            const remaining = outstandingRemaining(o);
            const eff = outstandingEffectiveStatus(o, today);
            const overdue = eff === "overdue";
            return (
              <div
                key={o.id}
                className={`glass flex flex-col gap-2.5 rounded-3xl p-4 ${overdue ? "!border-[#ef4444]/30" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    className="min-w-0 flex-1 text-right"
                    onClick={() => navigate(`/accounting/parties/${o.partyId}`)}
                  >
                    <p className="truncate text-[13px] font-extrabold">{partyName(o.partyId)}</p>
                    <p className="text-[11px] text-ink-500 dark:text-ink-400">
                      {OUTSTANDING_KIND_LABELS[o.kind]}
                      {o.description ? ` — ${o.description}` : ""}
                    </p>
                  </button>
                  <span className="num text-sm font-extrabold">{formatMoney(o.amount, o.currency)}</span>
                  <span className="num rounded-lg bg-white/50 px-2 py-1 text-[11px] font-bold dark:bg-white/8">
                    مانده: {formatMoney(remaining, o.currency)}
                  </span>
                  <OutstandingStatusPill status={eff} />
                  {o.dueDate && (
                    <span className={`num text-[11px] ${overdue ? "font-bold text-[#dc3535] dark:text-[#f87b7b]" : "text-ink-400"}`}>
                      سررسید: {formatJalali(o.dueDate)}
                    </span>
                  )}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={<IconButton icon={MoreVertical} label="عملیات" size={16} />}
                      items={[
                        ...(o.status !== "settled" && o.status !== "cancelled"
                          ? [{ label: "ثبت تسویه", icon: CheckCircle2, onClick: () => setSettleFor(o) }]
                          : []),
                        {
                          label: expanded === o.id ? "بستن تسویه‌ها" : `تسویه‌ها (${o.settlements.length.toLocaleString("fa-IR")})`,
                          onClick: () => setExpanded(expanded === o.id ? null : o.id),
                        },
                        ...(o.status !== "cancelled" && o.status !== "settled"
                          ? [{ label: "ابطال مانده", icon: Ban, danger: true, onClick: () => void doCancel(o) }]
                          : []),
                      ]}
                    />
                  </span>
                </div>
                {expanded === o.id && (
                  <SettlementHistory
                    settlements={o.settlements}
                    currency={o.currency}
                    onRemove={o.status !== "cancelled" ? (sid) => void doRemoveSettlement(o, sid) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <OutstandingFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      <SettleModal open={settleFor != null} onClose={() => setSettleFor(null)} item={settleFor} />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={
          kindFilter === "payable"
            ? "گزارش بدهی‌ها"
            : kindFilter === "receivable"
              ? "گزارش مطالبات"
              : "گزارش مطالبات و بدهی‌ها"
        }
        subtitle={`${statusFilter === "all" ? "همه وضعیت‌ها" : statusFilter === "open" ? "باز / جزئی" : statusFilter === "overdue" ? "سررسید گذشته" : statusFilter === "settled" ? "تسویه شده" : "ابطال شده"}`}
        columns={[
          { key: "party", header: "طرف حساب" },
          { key: "kind", header: "نوع" },
          { key: "amount", header: "مبلغ کل" },
          { key: "settled", header: "تسویه شده" },
          { key: "remaining", header: "مانده" },
          { key: "progress", header: "درصد تسویه" },
          { key: "currency", header: "ارز" },
          { key: "due", header: "سررسید" },
          { key: "delay", header: "وضعیت سررسید" },
          { key: "status", header: "وضعیت" },
          { key: "reference", header: "مرجع" },
          { key: "description", header: "شرح" },
        ]}
        rows={exportRows}
        defaultFilename="acc-outstanding"
        summary={[
          { label: "تعداد", value: rows.length.toLocaleString("fa-IR") },
          { label: "جمع مانده (تومان)", value: formatMoney(sumRemaining("IRT"), "IRT") },
          { label: "جمع مانده (دلار)", value: formatMoney(sumRemaining("USD"), "USD") },
          ...(sumRemaining("AFN") !== 0
            ? [{ label: "جمع مانده (افغانی)", value: formatMoney(sumRemaining("AFN"), "AFN") }]
            : []),
        ]}
        theme="acc"
      />
    </div>
  );
}
