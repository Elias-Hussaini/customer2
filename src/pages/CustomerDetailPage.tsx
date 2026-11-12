import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Briefcase, Archive, FileDown, FileImage, FilePenLine, FilePlus2, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { SectionCard } from "../components/ui/inputs";
import { Button } from "../components/ui/Button";
import { GlassCard } from "../components/ui/GlassCard";
import { ActivityFeed } from "../components/ui/ActivityFeed";
import { CustomFieldValue } from "../components/ui/CustomFields";
import { DocumentSlots } from "../components/ui/DocumentSlots";
import { CopyRow } from "../components/ui/CopyRow";
import { ProfileDocsManager } from "../components/domain/ProfileDocsManager";
import { CustomerFormModal } from "../components/domain/CustomerFormModal";
import { ProfilePhotoCard } from "../components/domain/ProfilePhotoCard";
import { RequestsTable } from "../components/domain/RequestsTable";
import { StageBadge, CodeTick } from "../components/ui/StageBadge";
import { beginCustomerHover, endCustomerHover } from "../components/domain/customerHotkeys";
import { ExportDialog } from "../components/exports/ExportDialog";
import { DroppedFilesModal } from "../components/domain/DroppedFilesModal";
import { FileDropOverlay, useDropTarget, useFilesDragging } from "../components/ui/DropZone";
import { EmptyState } from "../components/ui/EmptyState";
import { archiveCustomer, deleteCustomer, customerFullName } from "../db/customers";
import {
  useActivities,
  useCustomFields,
  useCustomer,
  useEmployers,
  useLists,
  usePrefs,
  useRepresentatives,
  useRequests,
  useStageMap,
  useTags,
} from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, formatDateByMode } from "../utils/jalali";
import { uiActions } from "../components/layout/uiStore";
import { toPersianDigits } from "../utils/jalali";
import { requestStatusFa, currencyLabel } from "../types";

interface BaseFieldDef {
  key: keyof import("../types").Customer;
  label: string;
  date?: boolean;
  /** "passport" → follow the birth/passport calendar setting. */
  calendar?: "passport";
  ref?: "rep" | "list" | "employer";
}

const BASE_FIELDS: BaseFieldDef[] = [
  { key: "representativeId", label: "نماینده", ref: "rep" },
  { key: "listId", label: "لیست", ref: "list" },
  { key: "employerId", label: "کارفرما", ref: "employer" },
  { key: "firstName", label: "نام" },
  { key: "lastName", label: "نام خانوادگی" },
  { key: "job", label: "شغل" },
  { key: "passportNo", label: "شماره پاسپورت" },
  { key: "birthDate", label: "تاریخ تولد", date: true, calendar: "passport" },
  { key: "passportIssueDate", label: "تاریخ صدور پاسپورت", date: true, calendar: "passport" },
  { key: "passportExpiryDate", label: "تاریخ انقضای پاسپورت", date: true, calendar: "passport" },
  { key: "referrer", label: "کد اختصاصی" },
  { key: "registrationDate", label: "تاریخ ثبت", date: true },
];

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const customer = useCustomer(id);
  const requests = useRequests();
  const stageMap = useStageMap();
  const representatives = useRepresentatives();
  const lists = useLists();
  const employers = useEmployers();
  const tags = useTags();
  const customFields = useCustomFields();
  const activities = useActivities(15, id);
  const prefs = usePrefs();
  const passportCal = prefs.passportDateCalendar ?? "gregorian";

  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  /** Files dropped anywhere on the profile — waiting for a destination. */
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  /** Full docs manager (ادیت مدارک). */
  const [docsOpen, setDocsOpen] = useState(false);

  // Full-profile drag & drop: overlay + window navigation guard + a
  // page-level fallback target that opens the destination picker.
  const filesDragging = useFilesDragging();
  const pageDrop = useDropTarget((files) =>
    setDroppedFiles((prev) => (prev ? [...prev, ...files] : files)),
  );

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
    currency: r.currency ? currencyLabel(r.currency) : "",
    registrationDate: formatJalali(r.registrationDate),
    status: requestStatusFa(r),
    issuedAt: r.issuedAt ? formatJalali(r.issuedAt) : "",
    rejectedAt: r.rejectedAt ? formatJalali(r.rejectedAt) : "",
    notes: r.notes ?? "",
  }));

  return (
    <div className="flex flex-col gap-5" data-profile-root {...pageDrop.dropHandlers}>
      <FileDropOverlay
        active={filesDragging}
        hint="روی هر بخش مشخص رها کنید، روی دکمه هوش مصنوعی — یا همین‌جا برای انتخاب مقصد"
      />
      <PageHeader
        back
        title={name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {customer.passportNo ? `پاسپورت ${customer.passportNo}` : "بدون شماره پاسپورت"}
          </span>
        }
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

      {/* Stage strip — the colored journey badge + code tick; hover + keys change it */}
      <div
        className="glass flex flex-wrap items-center gap-2.5 rounded-3xl px-4 py-3"
        onMouseEnter={(e) => beginCustomerHover(customer.id, e.currentTarget)}
        onMouseLeave={() => endCustomerHover(customer.id)}
        title="با نگه‌داشتن نشانگر اینجا: Ctrl مرحله بعد · Alt مرحله قبل · Shift صادر شده · Alt+Shift رد شده"
      >
        <StageBadge stage={stageMap?.get(customer.id)} />
        {customer.referrer?.trim() ? (
          <span className="chip-soft num inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]">
            <CodeTick has size={13} />
            کد اختصاصی: {customer.referrer}
          </span>
        ) : (
          <span className="text-[11px] text-ink-400">بدون کد اختصاصی</span>
        )}
        <span className="flex-1" />
        <span className="hidden text-[10px] text-ink-400 sm:block">
          هاور + Ctrl / Alt / Shift / Alt+Shift = تغییر مرحله
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Profile photo — big round, right side of the page; click to add/edit */}
          <ProfilePhotoCard
            kind="customer"
            id={customer.id}
            photo={customer.photo}
            name={name}
            subtitle={customer.passportNo ? `شماره پاسپورت: ${customer.passportNo}` : "بدون شماره پاسپورت"}
          />
          <SectionCard title="مشخصات" icon={<FilePenLine size={15} className="text-brand-500" />}>
            <div className="grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2">
              {BASE_FIELDS.map((f) => {
                if (f.ref === "employer" && prefs.employerFieldEnabled === false && !customer.employerId) {
                  return null;
                }
                const raw = customer[f.key] as string | undefined;
                let display: ReactNode;
                let copyText: string | null = null;
                if (f.ref === "rep") {
                  const rep = raw ? (representatives ?? []).find((r) => r.id === raw) : undefined;
                  display = rep ? (
                    <Link
                      to={`/representatives/${rep.id}`}
                      className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                    >
                      {rep.name}
                    </Link>
                  ) : (
                    <span className="text-ink-400">—</span>
                  );
                  copyText = rep?.name ?? null;
                } else if (f.ref === "employer") {
                  const emp = raw ? (employers ?? []).find((e) => e.id === raw) : undefined;
                  display = emp ? (
                    <Link
                      to={`/employers/${emp.id}`}
                      className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline dark:text-brand-300"
                    >
                      <Briefcase size={12} className="text-brand-500" />
                      {emp.name}
                    </Link>
                  ) : (
                    <span className="text-ink-400">بدون کارفرما</span>
                  );
                  copyText = emp?.name ?? null;
                } else if (f.ref === "list") {
                  const list = raw ? (lists ?? []).find((l) => l.id === raw) : undefined;
                  display = list ? (
                    <Link
                      to={`/lists/${list.id}`}
                      className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                    >
                      {list.name}
                    </Link>
                  ) : (
                    <span className="text-ink-400">—</span>
                  );
                  copyText = list?.name ?? null;
                } else if (f.date) {
                  const shown = raw
                    ? f.calendar === "passport"
                      ? formatDateByMode(raw, passportCal)
                      : formatJalali(raw)
                    : null;
                  display = <span className="num">{shown ?? "—"}</span>;
                  copyText = shown;
                } else {
                  display = <span className="min-w-0 truncate font-semibold">{raw || "—"}</span>;
                  copyText = raw ?? null;
                }
                return (
                  <CopyRow
                    key={String(f.key)}
                    label={f.label}
                    display={display}
                    copy={copyText}
                    copyLabel={f.label}
                  />
                );
              })}
              {detailCustomFields.map((field) => {
                const value = customer.customValues?.[field.key];
                const copyText =
                  value == null || value === "" || value === false
                    ? null
                    : Array.isArray(value)
                      ? (value as string[]).join("، ")
                      : String(value);
                return (
                  <CopyRow
                    key={field.key}
                    label={field.label}
                    display={
                      <span className="font-semibold">
                        <CustomFieldValue field={field} value={value} />
                      </span>
                    }
                    copy={copyText}
                    copyLabel={field.label}
                  />
                );
              })}
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
            <div className="mb-3 flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => setDocsOpen(true)}>
                <FileImage size={14} /> ادیت مدارک
              </button>
            </div>
            <DocumentSlots customerId={customer.id} customer={customer} />
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
          ...(customerRequests.some((r) => r.rejected && !r.issued)
            ? [
                {
                  label: "رد شده",
                  value: toPersianDigits(
                    customerRequests.filter((r) => r.rejected && !r.issued).length,
                  ),
                },
              ]
            : []),
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
          { key: "rejectedAt", header: "تاریخ رد" },
          { key: "notes", header: "توضیحات" },
        ]}
      />

      {/* Destination picker for files dropped on the profile (not a slot) */}
      {customer && (
        <DroppedFilesModal
          files={droppedFiles}
          customerId={customer.id}
          onClose={() => setDroppedFiles(null)}
        />
      )}

      {/* Full documents manager (ادیت مدارک) */}
      {customer && (
        <ProfileDocsManager
          open={docsOpen}
          onClose={() => setDocsOpen(false)}
          target={{ kind: "customer", id: customer.id, name }}
        />
      )}
    </div>
  );
}
