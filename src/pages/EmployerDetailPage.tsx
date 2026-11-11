/**
 * پروفایل کارفرما — the full employer profile: photo, contact & ID &
 * credential fields (every one with a hover copy chip), custom fields,
 * the employer's own document archive with the ابزار عکس integration,
 * linked customers and the audit trail.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  Briefcase,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileImage,
  FilePenLine,
  Users,
} from "lucide-react";
import { PageHeader, StatCard } from "../components/ui/StatCard";
import { SectionCard } from "../components/ui/inputs";
import { GlassCard } from "../components/ui/GlassCard";
import { ActivityFeed } from "../components/ui/ActivityFeed";
import { Button } from "../components/ui/Button";
import { CopyRow, copyText } from "../components/ui/CopyRow";
import { EmptyState } from "../components/ui/EmptyState";
import { useCustomerFilters, CustomerCardGrid } from "../components/domain/CustomerFilterPanel";
import { ProfilePhotoCard } from "../components/domain/ProfilePhotoCard";
import { EmployerFormModal } from "../components/domain/EmployerFormModal";
import { ProfileDocsManager } from "../components/domain/ProfileDocsManager";
import { CustomFieldValue } from "../components/ui/CustomFields";
import { FileDropOverlay, useDropTarget, useFilesDragging } from "../components/ui/DropZone";
import {
  archiveEmployer,
  deleteEmployer,
} from "../db/employers";
import {
  useActivities,
  useCustomers,
  useCustomFields,
  useEmployerAttachments,
  useEmployer,
  useLists,
  useRepresentatives,
  useRequests,
  useTags,
} from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { customerFullName } from "../db/customers";
import { formatJalali, toPersianDigits } from "../utils/jalali";
import { formatNumber } from "../utils/num";
import type { Customer, ListFolder, Representative, Tag, VisaRequest } from "../types";

export function EmployerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();

  const employer = useEmployer(id);
  const customers = useCustomers();
  const requests = useRequests();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags();
  const docs = useEmployerAttachments(id);
  const customFields = useCustomFields();
  const activities = useActivities(15, id);

  const [editOpen, setEditOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const filesDragging = useFilesDragging();
  const pageDrop = useDropTarget((files) => {
    setDropped((prev) => (prev ? [...prev, ...files] : files));
    setDocsOpen(true);
  });

  const linked = useMemo(
    () => (customers ?? []).filter((c) => c.employerId === id),
    [customers, id],
  );

  const detailCustomFields = useMemo(
    () =>
      (customFields ?? [])
        .filter((f) => f.entity === "employer" && f.showInDetails && !f.disabled)
        .sort((a, b) => a.order - b.order),
    [customFields],
  );

  if (!employer) {
    return (
      <EmptyState
        icon={Briefcase}
        title="کارفرما یافت نشد"
        description="ممکن است حذف شده باشد"
        action={<Link to="/employers" className="btn btn-glass btn-sm">بازگشت به کارفرماها</Link>}
      />
    );
  }

  const docsBytes = (docs ?? []).reduce((s, d) => s + d.size, 0);

  return (
    <div className="flex flex-col gap-5" data-profile-root {...pageDrop.dropHandlers}>
      <FileDropOverlay
        active={filesDragging}
        hint="فایل یا PDF را همین‌جا رها کنید تا در پروندهٔ کارفرما ذخیره شود"
      />
      <PageHeader
        back
        title={employer.name}
        subtitle={employer.phone ? `تماس: ${employer.phone}` : "کارفرما"}
        actions={
          <>
            <Button size="sm" variant="glass" icon={FileImage} onClick={() => setDocsOpen(true)}>
              ادیت مدارک
            </Button>
            <Button size="sm" variant="primary" icon={FilePenLine} onClick={() => setEditOpen(true)}>
              ویرایش
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ProfilePhotoCard
            kind="employer"
            id={employer.id}
            photo={employer.photo}
            name={employer.name}
            subtitle={employer.email ?? employer.address ?? undefined}
          />

          <SectionCard title="مشخصات" icon={<Briefcase size={15} className="text-brand-500" />}>
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              <CopyRow label="نام" display={<span className="font-semibold">{employer.name}</span>} copy={employer.name} copyLabel="نام" />
              <CopyRow
                label="شماره تماس"
                display={
                  employer.phone ? (
                    <span className="num font-semibold" dir="ltr">{employer.phone}</span>
                  ) : undefined
                }
                copy={employer.phone}
                copyLabel="شماره تماس"
              />
              <CopyRow
                label="ایمیل"
                display={
                  employer.email ? (
                    <span dir="ltr" className="font-semibold">{employer.email}</span>
                  ) : undefined
                }
                copy={employer.email}
                copyLabel="ایمیل"
              />
              <CopyRow
                label="کد ملی"
                display={
                  employer.nationalId ? (
                    <span className="num font-semibold" dir="ltr">{employer.nationalId}</span>
                  ) : undefined
                }
                copy={employer.nationalId}
                copyLabel="کد ملی"
              />
              <CopyRow
                label="کد پستی"
                display={
                  employer.postalCode ? (
                    <span className="num font-semibold" dir="ltr">{employer.postalCode}</span>
                  ) : undefined
                }
                copy={employer.postalCode}
                copyLabel="کد پستی"
              />
              <CopyRow
                label="نام کاربری"
                display={
                  employer.username ? (
                    <span dir="ltr" className="font-semibold">{employer.username}</span>
                  ) : undefined
                }
                copy={employer.username}
                copyLabel="نام کاربری"
              />
              <div className="flex items-center justify-between gap-3 border-b border-ink-900/5 py-2.5 text-[13px] last:border-0 dark:border-white/5">
                <span className="text-ink-500 dark:text-ink-400">رمز عبور</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  {employer.password ? (
                    <>
                      <span className="num font-semibold" dir="ltr">
                        {showPassword ? employer.password : "•".repeat(Math.min(12, employer.password.length))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        title={showPassword ? "پنهان" : "نمایش"}
                        className="h-6 w-6 rounded-lg bg-brand-500/10 text-brand-600 transition-colors hover:bg-brand-500 hover:text-white dark:text-brand-300 dark:hover:text-white"
                      >
                        {showPassword ? <EyeOff size={13} className="mx-auto" /> : <Eye size={13} className="mx-auto" />}
                      </button>
                      <CopyChip value={employer.password} label="رمز عبور" />
                    </>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </span>
              </div>
              <CopyRow
                label="آدرس"
                display={employer.address ? <span className="font-semibold">{employer.address}</span> : undefined}
                copy={employer.address}
                copyLabel="آدرس"
                className="sm:col-span-2"
              />
              {detailCustomFields.map((field) => (
                <CopyRow
                  key={field.key}
                  label={field.label}
                  display={
                    <span className="font-semibold">
                      <CustomFieldValue field={field} value={employer.customValues?.[field.key]} />
                    </span>
                  }
                  copy={
                    employer.customValues?.[field.key] == null
                      ? null
                      : Array.isArray(employer.customValues[field.key])
                        ? (employer.customValues[field.key] as string[]).join("، ")
                        : String(employer.customValues[field.key])
                  }
                  copyLabel={field.label}
                />
              ))}
            </div>
            {employer.notes && (
              <div className="mt-3 rounded-2xl bg-brand-500/6 px-4 py-3 text-[12.5px] leading-6">
                {employer.notes}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-400">
              عضویت از {formatJalali(new Date(employer.createdAt).toISOString().slice(0, 10))}
            </p>
          </SectionCard>

          <SectionCard
            title={`مشتریان این کارفرما (${toPersianDigits(linked.length)})`}
            icon={<Users size={15} className="text-brand-500" />}
          >
            {linked.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-400">
                هنوز مشتری‌ای با این کارفرما ثبت نشده — از فرم ثبت مشتری می‌توانید انتخابش کنید.
              </p>
            ) : (
              <EmployerCustomersPanel
                linked={linked}
                requests={requests ?? []}
                tags={tags ?? []}
                lists={lists ?? []}
                representatives={representatives ?? []}
              />
            )}
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4">
          <StatCard
            icon={FileImage}
            tone="brand"
            label="مدارک کارفرما"
            value={toPersianDigits(docs?.length ?? 0)}
            hint={docsBytes > 0 ? `${formatNumber(docsBytes)} بایت` : undefined}
          />
          <StatCard icon={Users} tone="success" label="مشتریان مرتبط" value={toPersianDigits(linked.length)} />

          <SectionCard title="فعالیت‌ها">
            <ActivityFeed activities={activities} />
          </SectionCard>

          <GlassCard className="p-4">
            <p className="mb-3 text-[13px] font-bold text-[#ef4444]">عملیات پیشرفته</p>
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-glass btn-sm justify-start"
                onClick={async () => {
                  const ok = await confirm({ title: `بایگانی «${employer.name}»؟`, message: "از آرشیو قابل بازگشت است." });
                  if (ok) {
                    await archiveEmployer(employer.id, employer.name);
                    toast.info("کارفرما بایگانی شد");
                    navigate("/employers");
                  }
                }}
              >
                <Archive size={14} /> بایگانی کارفرما
              </button>
              <button
                className="btn btn-danger-soft btn-sm justify-start"
                onClick={async () => {
                  const ok = await confirm({
                    title: `حذف قطعی «${employer.name}»`,
                    message: `${toPersianDigits(linked.length)} مشتری حفظ می‌شوند و بدون کارفرما می‌مانند؛ مدارک خود کارفرما همراهش حذف می‌شود. این عمل بازگشت‌پذیر نیست!`,
                    danger: true,
                    confirmLabel: "حذف قطعی",
                  });
                  if (ok) {
                    await deleteEmployer(employer.id, employer.name);
                    toast.info("کارفرما حذف شد");
                    navigate("/employers");
                  }
                }}
              >
                حذف قطعی کارفرما
              </button>
            </div>
          </GlassCard>
        </div>
      </div>

      <EmployerFormModal open={editOpen} onClose={() => setEditOpen(false)} employer={employer} />

      <ProfileDocsManager
        open={docsOpen}
        onClose={() => {
          setDocsOpen(false);
          setDropped(null);
        }}
        target={{ kind: "employer", id: employer.id, name: employer.name }}
        initialFiles={dropped}
      />
    </div>
  );
}


/** Round 22 — «اونجا که مشتریان این کارفرما هست»: the employer panel's customer
 *  list gets the SAME personalization filter panel as the مشتریان page
 *  (search / نماینده / لیست / visa status / sort — remembered per device) and
 *  every customer's TAGS show next to their passport number. */
function EmployerCustomersPanel({
  linked,
  requests,
  tags,
  lists,
  representatives,
}: {
  linked: Customer[];
  requests: VisaRequest[];
  tags: Tag[];
  lists: ListFolder[];
  representatives: Representative[];
}) {
  const { panel, rows, anyActive } = useCustomerFilters({
    pageKey: "employerProfile",
    customers: linked,
    requests,
    tags,
    lists,
    representatives,
    show: { employer: false },
    searchPlaceholder: "نام یا شماره پاسپورت مشتری…",
  });

  return (
    <div className="flex flex-col gap-3" data-employer-customers>
      {panel}
      <p className="text-[11px] text-ink-400">
        {toPersianDigits(rows.length)} مشتری {anyActive ? "در این فیلتر" : ""}
      </p>
      <CustomerCardGrid
        customers={rows}
        requests={requests}
        tags={tags}
        lists={lists}
        representatives={representatives}
        showMeta="rep"
        emptyHint="با این فیلترها مشتری‌ای پیدا نشد — فیلترها را عوض کنید یا پاک کنید"
      />
    </div>
  );
}

/** Tiny always-visible copy chip (used inside custom rows like the masked password). */
function CopyChip({ value, label }: { value: string; label: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={`کپی ${label}`}
      onClick={async () => {
        const ok = await copyText(value);
        if (ok) {
          setDone(true);
          toast.success(`${label} کپی شد`);
          setTimeout(() => setDone(false), 1200);
        } else {
          toast.error("کپی در کلیپ‌بورد ممکن نشد");
        }
      }}
      className={`h-6 w-6 shrink-0 rounded-lg transition-all ${
        done
          ? "bg-[#10b981] text-white"
          : "bg-brand-500/10 text-brand-600 hover:bg-brand-500 hover:text-white dark:text-brand-300 dark:hover:text-white"
      }`}
    >
      {done ? <Check size={13} className="mx-auto" /> : <Copy size={12} className="mx-auto" />}
    </button>
  );
}
