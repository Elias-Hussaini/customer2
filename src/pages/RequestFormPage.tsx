import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Banknote, CalendarDays, CircleCheck, CircleX, FilePlus2, Layers, Save, Tags, UserRound, X } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { SectionCard, SearchSelect } from "../components/ui/inputs";
import { Button } from "../components/ui/Button";
import { FormField, Input, Textarea, Toggle } from "../components/ui/fields";
import { JalaliDatePicker } from "../components/ui/JalaliDatePicker";
import { MoneyInput } from "../components/ui/MoneyInput";
import { TagPicker } from "../components/ui/TagPicker";
import { CustomFieldsGroup } from "../components/ui/CustomFields";
import { ActivityFeed } from "../components/ui/ActivityFeed";
import { createRequest, updateRequest } from "../db/requests";
import { createCustomer, customerFullName } from "../db/customers";
import { createVisaType } from "../db/taxonomy";
import { updatePrefs } from "../db/prefs";
import {
  useActivities,
  useCustomFields,
  useCustomers,
  useLists,
  usePrefs,
  useRepresentatives,
  useRequest,
  useTags,
  useVisaTypes,
} from "../hooks/useData";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { todayIso } from "../utils/jalali";
import type { Currency } from "../types";

interface FormState {
  customerId: string | null;
  representativeId: string | null;
  listId: string | null;
  visaType: string | null;
  tags: string[];
  quotedAmount: number | null;
  currency: Currency;
  registrationDate: string | null;
  issued: boolean;
  issuedAt: string | null;
  rejected: boolean;
  rejectedAt: string | null;
  notes: string;
  customValues: Record<string, unknown>;
}

/** Full-page visa-request form (create + edit) with fast data entry. */
export function RequestFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { confirm } = useConfirm();
  const prefs = usePrefs();

  const isEdit = Boolean(id);
  const existing = useRequest(id);
  const customers = useCustomers();
  const representatives = useRepresentatives();
  const lists = useLists();
  const tags = useTags() ?? [];
  const visaTypes = useVisaTypes();
  const customFields = useCustomFields();
  const activities = useActivities(12, id);

  const [form, setForm] = useState<FormState>({
    customerId: null,
    representativeId: null,
    listId: null,
    visaType: null,
    tags: [],
    quotedAmount: null,
    currency: "IRT",
    registrationDate: todayIso(),
    issued: false,
    issuedAt: null,
    rejected: false,
    rejectedAt: null,
    notes: "",
    customValues: {},
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({ open: false, firstName: "", lastName: "", passportNo: "" });
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);

  const fields = useMemo(
    () =>
      (customFields ?? [])
        .filter((f) => f.entity === "request" && f.showInForm && !f.disabled)
        .sort((a, b) => a.order - b.order),
    [customFields],
  );

  // Initialize: edit mode from record; new mode from prefill + remembered defaults.
  useEffect(() => {
    if (isEdit) {
      if (existing && !initializedRef.current) {
        initializedRef.current = true;
        setForm({
          customerId: existing.customerId,
          representativeId: existing.representativeId,
          listId: existing.listId,
          visaType: existing.visaType ?? null,
          tags: [...existing.tags],
          quotedAmount: existing.quotedAmount ?? null,
          currency: existing.currency ?? "IRT",
          registrationDate: existing.registrationDate,
          issued: existing.issued,
          issuedAt: existing.issuedAt ?? null,
          rejected: existing.rejected ?? false,
          rejectedAt: existing.rejectedAt ?? null,
          notes: existing.notes ?? "",
          customValues: { ...(existing.customValues ?? {}) },
        });
      }
      return;
    }
    if (initializedRef.current) return;
    if (customers === undefined || representatives === undefined || lists === undefined) return;
    initializedRef.current = true;
    const prefillCustomer = searchParams.get("customer");
    const prefillRep = searchParams.get("rep");
    const prefillList = searchParams.get("list");
    const lastRep =
      prefillRep ??
      (prefs.rememberLastSelections && prefs.lastRepresentativeId &&
      representatives.some((r) => r.id === prefs.lastRepresentativeId)
        ? prefs.lastRepresentativeId
        : null);
    const lastList =
      prefillList ??
      (prefs.rememberLastSelections && prefs.lastListId && lists.some((l) => l.id === prefs.lastListId)
        ? prefs.lastListId
        : null);
    setForm((f) => ({
      ...f,
      customerId: prefillCustomer && customers.some((c) => c.id === prefillCustomer) ? prefillCustomer : null,
      representativeId: lastRep,
      listId: lastList,
      currency: prefs.defaultCurrency,
      visaType: prefs.defaultVisaType ?? null,
    }));
  }, [isEdit, existing, customers, representatives, lists, prefs, searchParams]);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const patch = (p: Partial<FormState>) => {
    markDirty();
    setForm((f) => ({ ...f, ...p }));
  };

  const customerItems = useMemo(
    () =>
      (customers ?? [])
        .map((c) => ({
          id: c.id,
          title: customerFullName(c),
          subtitle: c.passportNo,
        }))
        .sort((a, b) => a.title.localeCompare(b.title, "fa")),
    [customers],
  );

  const visaTypeItems = useMemo(
    () => (visaTypes ?? []).map((v) => ({ id: v.name, title: v.name })),
    [visaTypes],
  );

  const createQuickCustomer = async () => {
    if (!quickCustomer.firstName.trim() && !quickCustomer.lastName.trim() && !quickCustomer.passportNo.trim()) {
      toast.error("حداقل نام یا شماره پاسپورت را وارد کنید");
      return;
    }
    if (!form.representativeId || !form.listId) {
      toast.error("برای ثبت مشتری، ابتدا نماینده و لیست را در فرم انتخاب کنید");
      return;
    }
    const created = await createCustomer({
      firstName: quickCustomer.firstName,
      lastName: quickCustomer.lastName,
      passportNo: quickCustomer.passportNo,
      representativeId: form.representativeId,
      listId: form.listId,
      registrationDate: todayIso(),
    });
    toast.success(`مشتری «${customerFullName(created)}» ساخته شد`);
    patch({ customerId: created.id });
    setQuickCustomer({ open: false, firstName: "", lastName: "", passportNo: "" });
  };

  const save = async () => {
    const next: Record<string, string> = {};
    if (!form.customerId) next.customerId = "انتخاب مشتری الزامی است";
    if (!form.representativeId) next.representativeId = "انتخاب نماینده الزامی است";
    if (!form.listId) next.listId = "انتخاب لیست الزامی است";
    for (const field of fields) {
      const v = form.customValues[field.key];
      const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
      if (field.required && empty) next[field.key] = "این فیلد الزامی است";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error("لطفاً خطاهای فرم را برطرف کنید");
      return;
    }
    setSaving(true);
    try {
      const input = {
        customerId: form.customerId!,
        representativeId: form.representativeId,
        listId: form.listId,
        visaType: form.visaType ?? undefined,
        tags: form.tags,
        quotedAmount: form.quotedAmount ?? undefined,
        currency: form.currency,
        registrationDate: form.registrationDate || todayIso(),
        issued: form.issued,
        issuedAt: form.issued ? form.issuedAt || todayIso() : null,
        rejected: form.rejected && !form.issued,
        rejectedAt: form.rejected && !form.issued ? form.rejectedAt || todayIso() : null,
        notes: form.notes,
        customValues: form.customValues,
      };
      let savedId = id;
      if (isEdit && id) {
        await updateRequest(id, input);
        toast.success("درخواست به‌روزرسانی شد");
      } else {
        const created = await createRequest(input);
        savedId = created.id;
        toast.success("درخواست ویزا ثبت شد");
      }
      // Remember last selections for faster next entry.
      if (!isEdit && prefs.rememberLastSelections) {
        await updatePrefs({
          lastRepresentativeId: form.representativeId,
          lastListId: form.listId,
        });
      }
      dirtyRef.current = false;
      navigate(`/requests/${savedId}/edit`);
    } catch (e) {
      console.error(e);
      toast.error("خطا در ذخیره درخواست");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (dirtyRef.current) {
      const ok = await confirm({
        title: "از خروج مطمئن هستید؟",
        message: "تغییرات ذخیره‌نشده از بین می‌رود.",
        confirmLabel: "خروج بدون ذخیره",
        danger: true,
      });
      if (!ok) return;
    }
    navigate(-1);
  };

  if (isEdit && existing === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-8 w-48 animate-pulse rounded-xl bg-ink-900/5 dark:bg-white/5" />
        <div className="h-64 animate-pulse rounded-3xl bg-ink-900/5 dark:bg-white/5" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-page-form>
      <PageHeader
        title={isEdit ? "ویرایش درخواست ویزا" : "درخواست ویزا جدید"}
        subtitle="مشتری، نماینده و لیست الزامی هستند — بقیه را بعداً تکمیل کنید"
        back
        actions={
          <>
            <button className="btn btn-glass btn-sm" onClick={() => void cancel()} disabled={saving}>
              <X size={15} /> انصراف
            </button>
            <Button variant="primary" size="sm" onClick={() => void save()} loading={saving}>
              <Save size={15} /> ذخیره
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SectionCard title="مشخصات اصلی" icon={<UserRound size={15} className="text-brand-500" />}>
            <div className="flex flex-col gap-4">
              <FormField label="مشتری" required error={errors.customerId}>
                <SearchSelect
                  items={customerItems}
                  value={form.customerId}
                  onSelect={(cid) => patch({ customerId: cid })}
                  placeholder="جستجوی نام یا شماره پاسپورت…"
                  clearable={false}
                />
              </FormField>
              {quickCustomer.open ? (
                <div className="glass-soft flex flex-col gap-3 rounded-2xl p-3.5">
                  <p className="text-xs font-bold">ایجاد سریع مشتری</p>
                  {form.representativeId && form.listId ? (
                    <p className="text-[11px] leading-5 text-ink-500 dark:text-ink-400">
                      مشتری جدید در لیست «{(lists ?? []).find((l) => l.id === form.listId)?.name ?? "—"}» و زیر
                      نماینده «{(representatives ?? []).find((r) => r.id === form.representativeId)?.name ?? "—"}»
                      ثبت می‌شود
                    </p>
                  ) : (
                    <p className="text-[11px] leading-5 text-[#c77d0a] dark:text-[#f5b84f]">
                      برای ثبت مشتری، ابتدا نماینده و لیست را انتخاب کنید (هر مشتری باید در یک لیست و زیر یک نماینده ثبت شود)
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      placeholder="نام"
                      value={quickCustomer.firstName}
                      onChange={(e) => setQuickCustomer((q) => ({ ...q, firstName: e.target.value }))}
                    />
                    <Input
                      placeholder="نام خانوادگی"
                      value={quickCustomer.lastName}
                      onChange={(e) => setQuickCustomer((q) => ({ ...q, lastName: e.target.value }))}
                    />
                    <Input
                      dir="ltr"
                      className="text-left"
                      placeholder="پاسپورت"
                      value={quickCustomer.passportNo}
                      onChange={(e) =>
                        setQuickCustomer((q) => ({ ...q, passportNo: e.target.value.toUpperCase() }))
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setQuickCustomer({ open: false, firstName: "", lastName: "", passportNo: "" })}
                    >
                      انصراف
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => void createQuickCustomer()}>
                      <FilePlus2 size={14} /> ساخت و انتخاب
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="self-start text-[12px] font-bold text-brand-600 hover:underline dark:text-brand-300"
                  onClick={() => setQuickCustomer((q) => ({ ...q, open: true }))}
                >
                  + مشتری در لیست نیست؟ سریع بسازید
                </button>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField label="نوع ویزا">
                  <SearchSelect
                    items={visaTypeItems}
                    value={form.visaType}
                    onSelect={(v) => patch({ visaType: v })}
                    onCreate={async (name) => {
                      await createVisaType(name);
                      patch({ visaType: name });
                    }}
                    createLabel={(q) => `ایجاد نوع ویزای «${q}»`}
                    placeholder="انتخاب یا ساخت…"
                  />
                </FormField>
                <FormField label="نماینده" required error={errors.representativeId} hint="آخرین انتخاب یاد می‌آید">
                  <SearchSelect
                    items={(representatives ?? []).map((r) => ({ id: r.id, title: r.name, subtitle: r.phone }))}
                    value={form.representativeId}
                    onSelect={(v) => patch({ representativeId: v })}
                    placeholder="انتخاب نماینده…"
                    clearable={false}
                  />
                </FormField>
                <FormField label="لیست" required error={errors.listId}>
                  <SearchSelect
                    items={(lists ?? []).map((l) => ({ id: l.id, title: l.name }))}
                    value={form.listId}
                    onSelect={(v) => patch({ listId: v })}
                    placeholder="انتخاب لیست…"
                    clearable={false}
                  />
                </FormField>
              </div>

              <FormField label="تگ‌ها" hint="تگ جدید هم می‌توانید بسازید">
                <TagPicker tags={tags} selectedIds={form.tags} onChange={(t) => patch({ tags: t })} />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard title="مالی" icon={<Banknote size={15} className="text-brand-500" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="مبلغ پیشنهادی" hint="اختیاری">
                <MoneyInput
                  amount={form.quotedAmount}
                  currency={form.currency}
                  onAmountChange={(a) => patch({ quotedAmount: a })}
                  onCurrencyChange={(c) => patch({ currency: c })}
                  currencies={["IRT", "USD"]}
                />
              </FormField>
              <FormField label="تاریخ ثبت" hint="به‌صورت پیش‌فرض امروز">
                <JalaliDatePicker
                  value={form.registrationDate}
                  onChange={(d) => patch({ registrationDate: d })}
                  clearable={false}
                />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard title="وضعیت درخواست" icon={<CircleCheck size={15} className="text-brand-500" />}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#10b981]/8 px-4 py-3">
                <div>
                  <p className="text-[13px] font-bold">ویزا صادر شده</p>
                  <p className="text-[11px] text-ink-500 dark:text-ink-400">
                    با فعال‌کردن، تاریخ صدور ثبت می‌شود و بعداً قابل لغو است
                  </p>
                </div>
                <Toggle
                  checked={form.issued}
                  onChange={(v) =>
                    patch({
                      issued: v,
                      issuedAt: v ? form.issuedAt || todayIso() : null,
                      ...(v ? { rejected: false, rejectedAt: null } : {}),
                    })
                  }
                />
              </div>
              {form.issued && (
                <FormField label="تاریخ صدور">
                  <JalaliDatePicker
                    value={form.issuedAt}
                    onChange={(d) => patch({ issuedAt: d })}
                    clearable={false}
                  />
                </FormField>
              )}
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#ef4444]/8 px-4 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-bold">
                    <CircleX size={14} className="text-[#dc3535] dark:text-[#f87b7b]" />
                    درخواست رد شده
                  </p>
                  <p className="text-[11px] text-ink-500 dark:text-ink-400">
                    اگر سفارت درخواست را رد کرده باشد فعال کنید — تاریخ رد ثبت می‌شود و در گزارش‌ها مشخص است
                  </p>
                </div>
                <Toggle
                  checked={form.rejected}
                  onChange={(v) =>
                    patch({
                      rejected: v,
                      rejectedAt: v ? form.rejectedAt || todayIso() : null,
                      ...(v ? { issued: false, issuedAt: null } : {}),
                    })
                  }
                />
              </div>
              {form.rejected && (
                <FormField label="تاریخ رد شدن">
                  <JalaliDatePicker
                    value={form.rejectedAt}
                    onChange={(d) => patch({ rejectedAt: d })}
                    clearable={false}
                  />
                </FormField>
              )}
            </div>
          </SectionCard>

          <SectionCard title="توضیحات" icon={<Tags size={15} className="text-brand-500" />}>
            <Textarea
              value={form.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="یادداشت درباره این درخواست…"
              className="!min-h-[90px]"
            />
          </SectionCard>

          {fields.length > 0 && (
            <SectionCard title="فیلدهای سفارشی" icon={<Layers size={15} className="text-brand-500" />}>
              <CustomFieldsGroup
                fields={fields}
                values={form.customValues}
                onChange={(key, value) => {
                  markDirty();
                  setForm((f) => ({
                    ...f,
                    customValues: { ...f.customValues, [key]: value },
                  }));
                }}
                errors={errors}
              />
            </SectionCard>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <SectionCard title="راهنمای سریع" icon={<CalendarDays size={15} className="text-brand-500" />}>
            <ul className="flex flex-col gap-2 text-[12px] leading-6 text-ink-600 dark:text-ink-300">
              <li>• مشتری، نماینده و لیست برای ثبت الزامی هستند.</li>
              <li>• نماینده و لیست آخرین بار انتخاب‌شده، خودکار می‌آید.</li>
              <li>• ساخت سریع مشتری، او را در لیست و زیر نماینده همین فرم ثبت می‌کند.</li>
              <li>• تگ «فوری» برای پیگیری سریع در داشبورد استفاده می‌شود.</li>
              <li>• مبالغ دلار و تومان جداگانه جمع می‌شوند.</li>
              <li>• «رد شده» و «صادر شده» همزمان نمی‌توانند فعال باشند — یکی را روشن کنید.</li>
            </ul>
          </SectionCard>
          {isEdit && (
            <SectionCard title="فعالیت‌های این درخواست">
              <ActivityFeed activities={activities} />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
