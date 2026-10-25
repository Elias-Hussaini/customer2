import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Archive, FileDown, FilePenLine, FilePlus2, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { SectionCard } from "../components/ui/inputs";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { ActivityFeed } from "../components/ui/ActivityFeed";
import { CustomFieldValue } from "../components/ui/CustomFields";
import { DocumentSlots } from "../components/ui/DocumentSlots";
import { CustomerFormModal } from "../components/domain/CustomerFormModal";
import { RequestsTable } from "../components/domain/RequestsTable";
import { ExportDialog } from "../components/exports/ExportDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { archiveCustomer, deleteCustomer, customerFullName } from "../db/customers";
import {
  useActivities,
  useCustomFields,
  useCustomer,
  useLists,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali } from "../utils/jalali";
import { uiActions } from "../components/layout/uiStore";
import { toPersianDigits } from "../utils/jalali";

const BASE_FIELDS: { key: keyof import("../types").Customer; label: string; date?: boolean }[] = [
  { key: "firstName", label: "نام" },
  { key: "lastName", label: "نام خانوادگی" },
  { key: "passportNo", label: "شماره پاسپورت" },
  { key: "birthDate", label: "تاریخ تولد", date: true },
  { key: "passportIssueDate", label: "تاریخ صدور پاسپورت", date: true },
  { key: "passportExpiryDate", label: "تاریخ انقضای پاسپورت", date: true },
  { key: "referrer", label: "معرف" },
  { key: "registrationDate", label: "تاریخ ثبت", date: true },
];

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const customer = useCustomer(id);
  const requests = useRequests();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags();
  const customFields = useCustomFields();
  const activities = useActivities(15, id);

  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const customerRequests = useMemo(
    () => (requests ?? []).filter((r) => r.customerId === id),
    [requests, id],
  );

  const detailCustomFields = useMemo(
    () =>
      (customFields ?? [])
        .filter((f) => f.entity === "customer" && f.showInDetails && !f.disabled)
        .sort((a, b) => a.order - b.order),
    [customFields],
  );

  if (!customer) {
    return (
      <EmptyState
        icon={FilePenLine}
        title="مشتری یافت نشد"
        description="ممکن است حذف شده باشد"
        action={<Link to="/customers" className="btn btn-glass btn-sm">بازگشت به مشتریان</Link>}
      />
    );
  }

  const name = customerFullName(customer);

  const exportRows = customerRequests.map((r) => ({
    visaType: r.visaType ?? "",
    representative: (representatives ?? []).find((x) => x.id === r.representativeId)?.name ?? "",
    list: (lists ?? []).find((l) => l.id === r.listId)?.name ?? "",
    amount: r.quotedAmount ?? "",
    currency: r.currency === "USD" ? "دلار" : r.currency === "IRT" ? "تومان" : "",
    registrationDate: formatJalali(r.registrationDate),
    status: r.issued ? "صادر شده" : "در حال کار",
    issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
    notes: r.notes ?? "",
  }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back
        title={name}
        subtitle={customer.passportNo ? `پاسپورت ${customer.passportNo}` : "بدون شماره پاسپورت"}
        actions={
          <>
            <button className="btn btn-glass btn-sm" onClick={() => setExportOpen(true)}>
              <FileDown size={14} /> خروجی
            </button>
            <button
              className="btn btn-glass btn-sm"
              onClick={() => uiActions.openRequestModal({ customerId: customer.id })}
            >
              <FilePlus2 size={14} /> درخواست جدید
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setEditOpen(true)}>
              <FilePenLine size={14} /> ویرایش
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SectionCard title="مشخصات" icon={<FilePenLine size={15} className="text-brand-500" />}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2">
              {BASE_FIELDS.map((f) => {
                const raw = customer[f.key] as string | undefined;
                return (
                  <div
                    key={String(f.key)}
                    className="flex items-center justify-between gap-3 border-b border-ink-900/5 py-2.5 text-[13px] last:border-0 dark:border-white/5"
                  >
                    <span className="text-ink-500 dark:text-ink-400">{f.label}</span>
                    <span className="num min-w-0 truncate font-semibold">
                      {raw ? (f.date ? formatJalali(raw) : raw) : "—"}
                    </span>
                  </div>
                );
              })}
              {detailCustomFields.map((field) => (
                <div
                  key={field.key}
                  className="flex items-center justify-between gap-3 border-b border-ink-900/5 py-2.5 text-[13px] last:border-0 dark:border-white/5"
                >
                  <span className="text-ink-500 dark:text-ink-400">{field.label}</span>
                  <span className="min-w-0 truncate font-semibold">
                    <CustomFieldValue field={field} value={customer.customValues?.[field.key]} />
                  </span>
                </div>
              ))}
            </div>
            {customer.notes && (
              <div className="mt-3 rounded-2xl bg-brand-500/6 px-4 py-3 text-[12.5px] leading-6">
                {customer.notes}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`درخواست‌های ویزا (${toPersianDigits(customerRequests.length)})`}
            icon={<FilePlus2 size={15} className="text-brand-500" />}
          >
            <RequestsTable
              requests={customerRequests}
              extras={{
                customers: customer ? [customer] : [],
                representatives: representatives ?? [],
                lists: lists ?? [],
                tags: tags ?? [],
                hideListColumn: false,
              }}
              empty={
                <EmptyState
                  icon={FilePlus2}
                  title="درخواستی ثبت نشده"
                  compact
                  action={
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => uiActions.openRequestModal({ customerId: customer.id })}
                    >
                      <FilePlus2 size={14} /> اولین درخواست
                    </button>
                  }
                />
              }
            />
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <SectionCard title="مدارک و تصاویر" icon={<Archive size={15} className="text-brand-500" />}>
            <DocumentSlots customerId={customer.id} />
          </SectionCard>

          <SectionCard title="فعالیت‌ها">
            <ActivityFeed activities={activities} />
          </SectionCard>

          <GlassCard className="p-4">
            <p className="mb-3 text-[13px] font-bold text-[#ef4444]">عملیات پیشرفته</p>
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-glass btn-sm justify-start"
                onClick={async () => {
                  const ok = await confirm({ title: `بایگانی «${name}»؟`, message: "از آرشیو قابل بازگشت است." });
                  if (ok) {
                    await archiveCustomer(customer.id, name);
                    toast.info("مشتری بایگانی شد");
                    navigate("/customers");
                  }
                }}
              >
                <Archive size={14} /> بایگانی مشتری
              </button>
              <button
                className="btn btn-danger-soft btn-sm justify-start"
                onClick={async () => {
                  const ok = await confirm({
                    title: `حذف قطعی «${name}»`,
                    message: `${customerRequests.length} درخواست و همه مدارک حذف می‌شوند. این عمل بازگشت‌پذیر نیست!`,
                    danger: true,
                    confirmLabel: "حذف قطعی",
                  });
                  if (ok) {
                    await deleteCustomer(customer.id, name);
                    toast.info("مشتری حذف شد");
                    navigate("/customers");
                  }
                }}
              >
                <Trash2 size={14} /> حذف قطعی مشتری
              </button>
            </div>
          </GlassCard>
        </div>
      </div>

      <CustomerFormModal open={editOpen} onClose={() => setEditOpen(false)} customer={customer} />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={`پرونده ${name}`}
        subtitle={customer.passportNo ? `شماره پاسپورت: ${customer.passportNo}` : undefined}
        rows={exportRows}
        defaultFilename={`customer-${customer.id.slice(0, 8)}`}
        summary={[
          { label: "مشتری", value: name },
          { label: "درخواست‌ها", value: toPersianDigits(customerRequests.length) },
          {
            label: "صادر شده",
            value: toPersianDigits(customerRequests.filter((r) => r.issued).length),
          },
        ]}
        columns={[
          { key: "visaType", header: "نوع ویزا" },
          { key: "representative", header: "نماینده" },
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
