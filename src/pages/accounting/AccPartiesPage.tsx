/** Parties (people & companies) directory with search, filters and quick actions. */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoreVertical, Plus, UserRound, Users } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { SearchBox, FilterSelect } from "../../components/ui/inputs";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { formatMoney } from "../../utils/num";
import { computePartyTotals } from "../../accounting/engine";
import { deleteOrDeactivateParty } from "../../accounting/repo";
import { PARTY_TYPE_LABELS, type AccParty } from "../../accounting/types";
import { useAccParties, useAccTransactions } from "../../accounting/hooks";
import { PartyAvatar } from "../../accounting/components/Bits";
import { PartyFormModal } from "../../accounting/components/PartyFormModal";
import { TransactionFormModal } from "../../accounting/components/TransactionFormModal";

export function AccPartiesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const parties = useAccParties();
  const transactions = useAccTransactions();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editParty, setEditParty] = useState<AccParty | null>(null);
  const [txFor, setTxFor] = useState<AccParty | null>(null);

  const rows = useMemo(() => {
    let list = parties ?? [];
    if (statusFilter === "active") list = list.filter((p) => p.active);
    else if (statusFilter === "inactive") list = list.filter((p) => !p.active);
    if (typeFilter !== "all") list = list.filter((p) => p.type === typeFilter);
    const q = query.trim();
    if (q) {
      list = list.filter((p) =>
        `${p.name} ${p.code} ${p.phone ?? ""} ${p.email ?? ""} ${p.idNumber ?? ""}`.includes(q),
      );
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }, [parties, query, typeFilter, statusFilter]);

  const totalsOf = (party: AccParty) => computePartyTotals(party.id, transactions ?? []);

  const removeParty = async (party: AccParty) => {
    const ok = await confirm({
      title: `حذف یا غیرفعال‌سازی «${party.name}»`,
      message:
        "اگر این حساب سابقه مالی داشته باشد فقط غیرفعال می‌شود (سابقه هرگز حذف نمی‌شود). اگر خالی باشد، کامل حذف خواهد شد.",
      confirmLabel: "ادامه",
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await deleteOrDeactivateParty(party.id);
      toast.success(
        result === "deleted"
          ? "حساب خالی بود و کامل حذف شد."
          : "حساب دارای سابقه مالی بود و فقط غیرفعال شد.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "عملیات ناموفق بود.");
    }
  };

  const columns: Column<AccParty>[] = [
    {
      key: "name",
      header: "طرف حساب",
      sortValue: (p) => p.name,
      render: (p) => (
        <span className="flex items-center gap-2.5">
          <PartyAvatar name={p.name} type={p.type} size={36} />
          <span className="flex flex-col">
            <span className="font-bold">{p.name}</span>
            <span className="num text-[11px] text-ink-400">{p.code}</span>
          </span>
        </span>
      ),
    },
    {
      key: "type",
      header: "نوع",
      sortValue: (p) => p.type,
      render: (p) => (
        <span className="text-xs font-semibold text-ink-500 dark:text-ink-400">
          {PARTY_TYPE_LABELS[p.type]}
        </span>
      ),
    },
    {
      key: "phone",
      header: "تلفن",
      render: (p) => <span className="num text-xs" dir="ltr">{p.phone ?? "—"}</span>,
    },
    {
      key: "netIRT",
      header: "خالص (تومان)",
      align: "center",
      sortValue: (p) => totalsOf(p).net.IRT,
      render: (p) => {
        const net = totalsOf(p).net.IRT;
        return (
          <span
            className={`num text-xs font-bold ${
              net > 0
                ? "text-[#0b9e6e] dark:text-[#3ddc9a]"
                : net < 0
                  ? "text-[#dc3535] dark:text-[#f87b7b]"
                  : "text-ink-400"
            }`}
          >
            {net === 0 ? "۰" : formatMoney(net, "IRT")}
          </span>
        );
      },
    },
    {
      key: "netUSD",
      header: "خالص (دلار)",
      align: "center",
      sortValue: (p) => totalsOf(p).net.USD,
      render: (p) => {
        const net = totalsOf(p).net.USD;
        return (
          <span
            className={`num text-xs font-bold ${
              net > 0
                ? "text-[#0b9e6e] dark:text-[#3ddc9a]"
                : net < 0
                  ? "text-[#dc3535] dark:text-[#f87b7b]"
                  : "text-ink-400"
            }`}
          >
            {net === 0 ? "۰" : formatMoney(net, "USD")}
          </span>
        );
      },
    },
    {
      key: "netAFN",
      header: "خالص (افغانی)",
      align: "center",
      sortValue: (p) => totalsOf(p).net.AFN,
      render: (p) => {
        const net = totalsOf(p).net.AFN;
        return (
          <span
            className={`num text-xs font-bold ${
              net > 0
                ? "text-[#0b9e6e] dark:text-[#3ddc9a]"
                : net < 0
                  ? "text-[#dc3535] dark:text-[#f87b7b]"
                  : "text-ink-400"
            }`}
          >
            {net === 0 ? "۰" : formatMoney(net, "AFN")}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "وضعیت",
      align: "center",
      render: (p) =>
        p.active ? (
          <span className="rounded-full bg-[#10b981]/12 px-2 py-0.5 text-[10.5px] font-bold text-[#0b9e6e] dark:text-[#3ddc9a]">
            فعال
          </span>
        ) : (
          <span className="rounded-full bg-ink-500/10 px-2 py-0.5 text-[10.5px] font-bold text-ink-500 dark:text-ink-400">
            غیرفعال
          </span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "center",
      render: (p) => (
        <Menu
          trigger={<IconButton icon={MoreVertical} label="عملیات" size={16} />}
          items={[
            { label: "مشاهده پروفایل", onClick: () => navigate(`/accounting/parties/${p.id}`) },
            { label: "تراکنش جدید", onClick: () => setTxFor(p) },
            { label: "ویرایش", onClick: () => { setEditParty(p); setFormOpen(true); } },
            { label: "حذف / غیرفعال‌سازی", danger: true, onClick: () => void removeParty(p) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="جستجوی نام، کد حساب، تلفن…" className="min-w-[220px] flex-1" />
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "all", label: "همه انواع" },
            { value: "individual", label: "شخص حقیقی" },
            { value: "company", label: "شرکت" },
          ]}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "active", label: "فعال" },
            { value: "inactive", label: "غیرفعال" },
            { value: "all", label: "همه" },
          ]}
        />
        <Button variant="primary" icon={Plus} onClick={() => { setEditParty(null); setFormOpen(true); }}>
          طرف حساب جدید
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/accounting/parties/${p.id}`)}
        loading={!parties}
        empty={
          <EmptyState
            icon={Users}
            title="طرف حسابی نیست"
            description="اشخاص و شرکت‌هایی که با آن‌ها دریافت و پرداخت دارید را اینجا ثبت کنید. هر حساب یک کد یکتا می‌گیرد."
            action={
              <Button variant="primary" icon={Plus} onClick={() => { setEditParty(null); setFormOpen(true); }}>
                اولین طرف حساب
              </Button>
            }
          />
        }
        mobileCard={(p) => {
          const t = totalsOf(p);
          return (
            <div className="glass flex flex-col gap-2 rounded-2xl p-3.5">
              <div className="flex items-center gap-2.5">
                <PartyAvatar name={p.name} type={p.type} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">{p.name}</p>
                  <p className="num text-[11px] text-ink-400">
                    {p.code} · {PARTY_TYPE_LABELS[p.type]}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-center">
                <Menu
                  trigger={<IconButton icon={MoreVertical} label="عملیات" size={16} />}
                  items={[
                    { label: "مشاهده پروفایل", onClick: () => navigate(`/accounting/parties/${p.id}`) },
                    { label: "تراکنش جدید", onClick: () => setTxFor(p) },
                    { label: "ویرایش", onClick: () => { setEditParty(p); setFormOpen(true); } },
                    { label: "حذف / غیرفعال‌سازی", danger: true, onClick: () => void removeParty(p) },
                  ]}
                />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-400">خالص تومان</span>
                <span className="num font-bold">{formatMoney(t.net.IRT, "IRT")}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-ink-400">خالص دلار</span>
                <span className="num font-bold">{formatMoney(t.net.USD, "USD")}</span>
              </div>
              {t.net.AFN !== 0 && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-400">خالص افغانی</span>
                  <span className="num font-bold">{formatMoney(t.net.AFN, "AFN")}</span>
                </div>
              )}
            </div>
          );
        }}
        footer={
          parties
            ? `${rows.length.toLocaleString("fa-IR")} حساب — ${rows.filter((p) => p.type === "company").length.toLocaleString("fa-IR")} شرکت`
            : undefined
        }
      />

      <PartyFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editParty={editParty}
      />
      <TransactionFormModal
        open={txFor != null}
        onClose={() => setTxFor(null)}
        initial={{ partyId: txFor?.id ?? null, type: "receipt" }}
      />
      <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
        <UserRound size={13} />
        حساب‌های دارای سابقه مالی حذف نمی‌شوند — فقط غیرفعال می‌شوند تا صورت‌حساب آن‌ها همیشه قابل ردگیری بماند.
      </div>
    </div>
  );
}
