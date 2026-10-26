import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Banknote,
  CheckCircle2,
  Clock3,
  FileDown,
  FilePenLine,
  FilePlus2,
  Phone,
  Receipt,
  Trash2,
  Users,
} from "lucide-react";
import { PageHeader, StatCard } from "../components/ui/StatCard";
import { SectionCard } from "../components/ui/inputs";
import { DataTable, type Column } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { Tabs } from "../components/ui/Tabs";
import { ActivityFeed } from "../components/ui/ActivityFeed";
import { RequestsTable } from "../components/domain/RequestsTable";
import { RepresentativeFormModal } from "../components/domain/RepresentativeFormModal";
import { ProfilePhotoCard } from "../components/domain/ProfilePhotoCard";
import { Avatar } from "../components/ui/Avatar";
import { PaymentFormModal } from "../components/domain/PaymentFormModal";
import { AttachmentPreview } from "../components/ui/AttachmentPreview";
import { ExportDialog } from "../components/exports/ExportDialog";
import { uiActions } from "../components/layout/uiStore";
import {
  useActivities,
  useCustomers,
  useLists,
  usePayments,
  useReceipts,
  useRepresentativeOrDefault,
  useRequests,
  useTags,
} from "../hooks/useData";
import { computeBalances, computeRepStats } from "../services/stats";
import { formatMoney } from "../utils/num";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { customerFullName } from "../db/customers";
import { deleteRepresentative } from "../db/reps";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import type { Attachment, Payment } from "../types";

export function RepresentativeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const rep = useRepresentativeOrDefault(id);
  const requests = useRequests();
  const payments = usePayments();
  const customers = useCustomers();
  const lists = useLists();
  const tags = useTags();
  const receipts = useReceipts();
  const activities = useActivities(20, id);

  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<Attachment | null>(null);

  /** Permanent delete — guarded by confirm; payments block it, requests/customers detach. */
  const removeRep = async () => {
    if (!rep) return;
    const ok = await confirm({
      title: `حذف «${rep.name}»`,
      message:
        stats.total > 0 || repCustomers.length > 0
          ? `${toPersianDigits(stats.total)} درخواست و ${toPersianDigits(repCustomers.length)} مشتری این نماینده حفظ می‌شوند اما بدون نماینده می‌مانند. این عمل بازگشت‌پذیر نیست!`
          : "این نماینده درخواست یا مشتری ثبت‌شده ندارد. این عمل بازگشت‌پذیر نیست!",
      danger: true,
      confirmLabel: "حذف قطعی",
    });
    if (!ok) return;
    const res = await deleteRepresentative(rep.id, rep.name);
    if (res.ok) {
      toast.info("نماینده حذف شد");
      navigate("/representatives");
    } else {
      toast.error(res.reason ?? "حذف ناموفق بود");
    }
  };

  const receiptByPayment = useMemo(
    () => new Map((receipts ?? []).map((r) => [r.paymentId ?? "", r] as const)),
    [receipts],
  );

  const urgentTagIds = useMemo(
    () => new Set((tags ?? []).filter((t) => t.isUrgent).map((t) => t.id)),
    [tags],
  );

  const repRequests = useMemo(
    () => (requests ?? []).filter((r) => r.representativeId === id),
    [requests, id],
  );
  const repPayments = useMemo(
    () => (payments ?? []).filter((p) => p.representativeId === id).sort((a, b) => b.date.localeCompare(a.date)),
    [payments, id],
  );
  const repCustomers = useMemo(() => {
    // Customers assigned directly to this representative, plus any that reached
    // them through a visa request (covers records created before the rule).
    const ids = new Set(repRequests.map((r) => r.customerId));
    return (customers ?? []).filter((c) => c.representativeId === id || ids.has(c.id));
  }, [customers, repRequests, id]);

  if (!rep) {
    return (
      <EmptyState
        icon={Users}
        title="نماینده یافت نشد"
        action={<Link to="/representatives" className="btn btn-glass btn-sm">بازگشت به نمایندگان</Link>}
      />
    );
  }

  const stats = computeRepStats(rep.id, requests ?? [], urgentTagIds);
  const balances = computeBalances(repRequests, repPayments);

  const paymentColumns: Column<Payment>[] = [
    {
      key: "date",
      header: "تاریخ",
      sortValue: (p) => p.date,
      render: (p) => <span className="num">{formatJalali(p.date)}</span>,
    },
    {
      key: "amount",
      header: "مبلغ",
      sortValue: (p) => p.amount,
      render: (p) => <span className="num font-bold">{formatMoney(p.amount, p.currency)}</span>,
    },
    {
      key: "request",
      header: "درخواست مرتبط",
      render: (p) => {
        const r = (requests ?? []).find((x) => x.id === p.requestId);
        if (!r) return <span className="text-ink-400">—</span>;
        const c = (customers ?? []).find((x) => x.id === r.customerId);
        return <span className="text-[12px]">{c ? customerFullName(c) : "درخواست"}</span>;
      },
    },
    { key: "description", header: "توضیحات", render: (p) => p.description ?? "—" },
    {
      key: "receipt",
      header: "رسید",
      align: "center",
      sortValue: (p) => (receiptByPayment.has(p.id) ? 1 : 0),
      render: (p) => {
        const r = receiptByPayment.get(p.id);
        return r ? (
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#10b981]/12 text-[#0b9e6e] transition-colors hover:bg-[#10b981]/20 dark:text-[#3ddc9a]"
            title="مشاهده رسید"
            aria-label="مشاهده رسید"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewReceipt(r);
            }}
          >
            <Receipt size={15} />
          </button>
        ) : (
          <span className="text-[11px] text-ink-400">—</span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back
        title={rep.name}
        subtitle={rep.phone ? `تماس: ${rep.phone}` : "بدون شماره تماس"}
        actions={
          <>
            <button className="btn btn-glass btn-sm" onClick={() => setExportOpen(true)}>
              <FileDown size={14} /> خروجی گزارش
            </button>
            <button className="btn btn-glass btn-sm" onClick={() => setPayOpen(true)}>
              <Banknote size={14} /> ثبت پرداخت
            </button>
            <button
              className="btn btn-glass btn-sm"
              onClick={() => uiActions.openRequestModal({ representativeId: rep.id })}
            >
              <FilePlus2 size={14} /> درخواست جدید
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
              <FilePenLine size={14} /> ویرایش
            </button>
            <button
              className="btn btn-sm !border-rose-500/30 !bg-rose-500/10 !text-rose-600 hover:!bg-rose-500/20 dark:!text-rose-400"
              onClick={() => void removeRep()}
              title="حذف قطعی این نماینده"
            >
              <Trash2 size={14} /> حذف
            </button>
          </>
        }
      />

      {/* Profile photo — big round, top of the page; click to add/edit */}
      <ProfilePhotoCard
        kind="rep"
        id={rep.id}
        photo={rep.photo}
        name={rep.name}
        subtitle={rep.phone ? `تماس: ${rep.phone}` : "بدون شماره تماس"}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={FilePlus2} label="کل درخواست‌ها" value={toPersianDigits(stats.total)} tone="brand" />
        <StatCard icon={CheckCircle2} label="صادر شده" value={toPersianDigits(stats.issued)} tone="success" />
        <StatCard icon={Clock3} label="در حال کار" value={toPersianDigits(stats.inProgress)} tone="warning" />
        <StatCard icon={Users} label="مشتریان" value={toPersianDigits(repCustomers.length)} tone="info" />
      </div>

      {/* Financial summary */}
      <SectionCard title="وضعیت مالی" icon={<Banknote size={15} className="text-brand-500" />}>
        {balances.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-400">هنوز مبلغ یا پرداختی ثبت نشده است</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {balances.map((b) => (
              <div key={b.currency} className="glass-soft grid grid-cols-3 gap-2 rounded-2xl p-3.5 text-center">
                <div>
                  <p className="num text-[13px] font-bold">{formatMoney(b.quoted, b.currency)}</p>
                  <p className="text-[10px] text-ink-500 dark:text-ink-400">مطالبات</p>
                </div>
                <div>
                  <p className="num text-[13px] font-bold text-[#0b9e6e] dark:text-[#3ddc9a]">
                    {formatMoney(b.paid, b.currency)}
                  </p>
                  <p className="text-[10px] text-ink-500 dark:text-ink-400">دریافتی</p>
                </div>
                <div>
                  <p
                    className={`num text-[13px] font-bold ${
                      b.balance > 0 ? "text-[#dc3535]" : "text-[#0b9e6e]"
                    }`}
                  >
                    {formatMoney(b.balance, b.currency)}
                  </p>
                  <p className="text-[10px] text-ink-500 dark:text-ink-400">مانده</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Tabs
        tabs={[
          {
            key: "requests",
            label: "درخواست‌ها",
            badge: repRequests.length,
            content: (
              <RequestsTable
                requests={repRequests}
                loading={requests === undefined}
                extras={{
                  customers: customers ?? [],
                  representatives: [rep],
                  lists: lists ?? [],
                  tags: tags ?? [],
                }}
                empty={
                  <EmptyState
                    icon={FilePlus2}
                    title="درخواستی ثبت نشده"
                    compact
                    action={
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => uiActions.openRequestModal({ representativeId: rep.id })}
                      >
                        <FilePlus2 size={14} /> درخواست جدید
                      </button>
                    }
                  />
                }
              />
            ),
          },
          {
            key: "customers",
            label: "مشتریان",
            badge: repCustomers.length,
            content: repCustomers.length === 0 ? (
              <EmptyState icon={Users} title="مشتری‌ای ندارد" compact />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {repCustomers.map((c) => {
                  const list = (lists ?? []).find((l) => l.id === c.listId);
                  return (
                    <button
                      key={c.id}
                      className="glass flex items-center gap-2.5 rounded-2xl p-3 text-right transition-transform active:scale-95"
                      onClick={() => navigate(`/customers/${c.id}`)}
                    >
                      <Avatar photo={c.photo} name={customerFullName(c)} />
                      <span className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold">{customerFullName(c)}</p>
                        {c.passportNo && (
                          <p dir="ltr" className="num mt-1 text-[11px] text-ink-400">
                            {c.passportNo}
                          </p>
                        )}
                        {list && (
                          <p className="mt-1 truncate text-[10.5px] text-ink-500 dark:text-ink-400">
                            لیست: {list.name}
                          </p>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ),
          },
          {
            key: "payments",
            label: "پرداخت‌ها",
            badge: repPayments.length,
            content: (
              <DataTable
                columns={paymentColumns}
                rows={repPayments}
                rowKey={(p) => p.id}
                initialSort={{ key: "date", dir: "desc" }}
                empty={<EmptyState icon={Banknote} title="پرداختی ثبت نشده" compact />}
                footer={`${toPersianDigits(repPayments.length)} پرداخت`}
              />
            ),
          },
          {
            key: "activity",
            label: "فعالیت",
            content: <ActivityFeed activities={activities} />,
          },
        ]}
      />

      {rep.notes && (
        <SectionCard title="یادداشت نماینده">
          <p className="text-[13px] leading-6">{rep.notes}</p>
        </SectionCard>
      )}
      {rep.contactInfo && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-500 dark:text-ink-400">
          <Phone size={13} /> {rep.contactInfo}
        </p>
      )}

      <RepresentativeFormModal open={editOpen} onClose={() => setEditOpen(false)} representative={rep} />
      <PaymentFormModal open={payOpen} onClose={() => setPayOpen(false)} defaultRepresentativeId={rep.id} />
      <AttachmentPreview attachment={previewReceipt} onClose={() => setPreviewReceipt(null)} />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`گزارش نماینده ${rep.name}`}
        subtitle="درخواست‌های این نماینده"
        rows={repRequests.map((r) => {
          const c = (customers ?? []).find((x) => x.id === r.customerId);
          return {
            customer: c ? customerFullName(c) : "",
            passportNo: c?.passportNo ?? "",
            visaType: r.visaType ?? "",
            list: (lists ?? []).find((l) => l.id === r.listId)?.name ?? "",
            amount: r.quotedAmount ?? "",
            currency: r.currency === "USD" ? "دلار" : r.currency === "IRT" ? "تومان" : "",
            registrationDate: formatJalali(r.registrationDate),
            status: r.issued ? "صادر شده" : "در حال کار",
            issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
            notes: r.notes ?? "",
          };
        })}
        defaultFilename={`rep-${rep.name}`}
        summary={[
          { label: "نماینده", value: rep.name },
          { label: "درخواست‌ها", value: toPersianDigits(stats.total) },
          { label: "صادر شده", value: toPersianDigits(stats.issued) },
          ...balances.map((b) => ({
            label: b.currency === "USD" ? "مانده دلار" : "مانده تومان",
            value: formatMoney(b.balance, b.currency),
          })),
        ]}
        columns={[
          { key: "customer", header: "مشتری" },
          { key: "passportNo", header: "پاسپورت" },
          { key: "visaType", header: "نوع ویزا" },
          { key: "list", header: "لیست" },
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
