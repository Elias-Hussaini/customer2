import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, CircleX, FilePenLine, FolderInput, Trash2 } from "lucide-react";
import type { Customer, ListFolder, Representative, Tag, VisaRequest } from "../../types";
import { requestStatusFa } from "../../types";
import { DataTable, type Column } from "../ui/DataTable";
import { Menu } from "../ui/Menu";
import { StatusPill, TagBadge, TagsRow } from "../ui/Badges";
import { Avatar } from "../ui/Avatar";
import { Modal } from "../ui/Modal";
import { formatMoney } from "../../utils/num";
import { formatJalali, todayIso } from "../../utils/jalali";
import { customerFullName } from "../../db/customers";
import { archiveRequest, deleteRequest, setRequestIssued, setRequestRejected } from "../../db/requests";
import { useConfirm } from "../../hooks/useConfirm";
import { useToast } from "../../hooks/useToast";
import { uiActions } from "../layout/uiStore";
import { toPersianDigits } from "../../utils/jalali";

export interface RequestRowExtras {
  customers: Customer[];
  representatives: Representative[];
  lists: ListFolder[];
  tags: Tag[];
  /** Hide the list column (inside a list page). */
  hideListColumn?: boolean;
}

/** Standard visa-request table with quick issue toggle and row actions. */
export function RequestsTable({
  requests,
  extras,
  loading,
  empty,
  onMove,
}: {
  requests: VisaRequest[];
  extras: RequestRowExtras;
  loading?: boolean;
  empty?: React.ReactNode;
  onMove?: (request: VisaRequest) => void;
}) {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const toast = useToast();
  /** Big profile photo opened from a row's avatar button. */
  const [photoView, setPhotoView] = useState<{ photo: string; name: string } | null>(null);

  const customersById = new Map(extras.customers.map((c) => [c.id, c]));
  const repsById = new Map(extras.representatives.map((r) => [r.id, r]));
  const listsById = new Map(extras.lists.map((l) => [l.id, l]));
  const tagsById = new Map(extras.tags.map((t) => [t.id, t]));

  const openRow = (r: VisaRequest) => navigate(`/requests/${r.id}/edit`);

  const toggleIssue = async (r: VisaRequest) => {
    await setRequestIssued(r.id, !r.issued, todayIso());
    toast.success(r.issued ? "وضعیت به «در حال کار» برگشت" : "ویزا صادرشده علامت خورد");
  };

  const toggleReject = async (r: VisaRequest) => {
    await setRequestRejected(r.id, !r.rejected, todayIso());
    toast.info(r.rejected ? "وضعیت رد شدن لغو شد" : "درخواست «رد شده» علامت خورد");
  };

  const columns: Column<VisaRequest>[] = [
    {
      key: "customer",
      header: "مشتری",
      sortValue: (r) =>
        customersById.get(r.customerId)
          ? customerFullName(customersById.get(r.customerId)!)
          : "zz",
      render: (r) => {
        const c = customersById.get(r.customerId);
        const fullName = c ? customerFullName(c) : "—";
        return (
          <div className="flex items-center gap-2.5">
            {c?.photo ? (
              <button
                type="button"
                className="shrink-0 rounded-full outline-none ring-brand-400/60 transition-shadow focus-visible:ring-2"
                title={`دیدن عکس پروفایل ${fullName}`}
                aria-label={`دیدن عکس پروفایل ${fullName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setPhotoView({ photo: c.photo!, name: fullName });
                }}
              >
                <Avatar photo={c.photo} name={fullName} />
              </button>
            ) : (
              <Avatar photo={undefined} name={fullName} />
            )}
            <div className="min-w-0">
              <span className="block truncate font-semibold" title={fullName}>
                {fullName}
              </span>
              {c?.passportNo && (
                <span className="ltr block text-[11px] text-ink-400">{c.passportNo}</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "visaType",
      header: "نوع ویزا",
      sortValue: (r) => r.visaType ?? "",
      render: (r) => (
        <span className="block max-w-[200px] truncate font-medium" title={r.visaType ?? undefined}>
          {r.visaType ?? "—"}
        </span>
      ),
    },
    {
      key: "tags",
      header: "تگ‌ها",
      render: (r) => <TagsRow tags={r.tags.map((t) => tagsById.get(t)).filter((t): t is Tag => Boolean(t))} />,
    },
    {
      key: "representative",
      header: "نماینده",
      sortValue: (r) => repsById.get(r.representativeId ?? "")?.name ?? "—",
      render: (r) => {
        const repName = r.representativeId ? (repsById.get(r.representativeId)?.name ?? "—") : "—";
        return (
          <span
            className="block max-w-[170px] truncate text-ink-600 dark:text-ink-300"
            title={repName === "—" ? undefined : repName}
          >
            {repName}
          </span>
        );
      },
    },
    ...(extras.hideListColumn
      ? []
      : ([
          {
            key: "list",
            header: "لیست",
            sortValue: (r: VisaRequest) => listsById.get(r.listId ?? "")?.name ?? "—",
            render: (r: VisaRequest) => {
              const listName = r.listId ? (listsById.get(r.listId)?.name ?? "—") : "—";
              return (
                <span
                  className="block max-w-[170px] truncate text-ink-600 dark:text-ink-300"
                  title={listName === "—" ? undefined : listName}
                >
                  {listName}
                </span>
              );
            },
          },
        ] as Column<VisaRequest>[])),
    {
      key: "amount",
      header: "مبلغ",
      sortValue: (r) => r.quotedAmount ?? -1,
      render: (r) =>
        r.quotedAmount != null && r.currency ? (
          <span className="num">{formatMoney(r.quotedAmount, r.currency)}</span>
        ) : (
          <span className="text-ink-400">—</span>
        ),
    },
    {
      key: "registrationDate",
      header: "تاریخ ثبت",
      sortValue: (r) => r.registrationDate,
      render: (r) => <span className="num text-ink-600 dark:text-ink-300">{formatJalali(r.registrationDate)}</span>,
    },
    {
      key: "issued",
      header: "وضعیت",
      align: "center",
      sortValue: (r) => (r.rejected && !r.issued ? 2 : r.issued ? 1 : 0),
      render: (r) => (
        <div className="flex items-center justify-center gap-2">
          <button
            role="switch"
            aria-checked={r.issued}
            aria-label={requestStatusFa(r)}
            title={r.issued ? "لغو وضعیت صادر شده" : "علامت‌زدن صادر شده"}
            onClick={(e) => {
              e.stopPropagation();
              void toggleIssue(r);
            }}
            className={`relative h-5.5 w-10 shrink-0 rounded-full transition-colors ${
              r.issued ? "bg-[#10b981]" : "bg-ink-300 dark:bg-ink-700"
            }`}
          >
            <span
              className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${
                r.issued ? "right-0.5" : "right-[calc(100%-1.25rem)]"
              }`}
            />
          </button>
          <button
            type="button"
            aria-pressed={Boolean(r.rejected)}
            aria-label={r.rejected ? "لغو وضعیت رد شده" : "علامت‌زدن رد شده"}
            title={r.rejected ? "لغو وضعیت رد شده" : "علامت‌زدن رد شده"}
            onClick={(e) => {
              e.stopPropagation();
              void toggleReject(r);
            }}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all active:scale-90 ${
              r.rejected
                ? "bg-[#ef4444] text-white shadow-sm shadow-[#ef4444]/40"
                : "text-ink-400 hover:bg-[#ef4444]/10 hover:text-[#dc3535] dark:text-ink-500"
            }`}
          >
            <CircleX size={14} />
          </button>
          <StatusPill issued={r.issued} rejected={r.rejected} />
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (r) => (
        <Menu
          items={[
            { icon: FilePenLine, label: "مشاهده و ویرایش", onClick: () => openRow(r) },
            {
              icon: r.issued ? FilePenLine : undefined,
              label: r.issued ? "لغو وضعیت صادر شده" : "علامت‌زدن صادر شده",
              onClick: () => void toggleIssue(r),
            },
            {
              icon: CircleX,
              label: r.rejected ? "لغو وضعیت رد شده" : "علامت‌زدن رد شده",
              ...(r.rejected ? {} : { danger: true }),
              onClick: () => void toggleReject(r),
            },
            ...(onMove
              ? [{ icon: FolderInput, label: "انتقال به لیست دیگر", onClick: () => onMove(r) }]
              : []),
            { icon: Archive, label: "بایگانی", onClick: () => void archiveRequest(r.id, r.visaType) },
            {
              icon: Trash2,
              label: "حذف",
              danger: true,
              onClick: async () => {
                const ok = await confirm({
                  title: "حذف درخواست ویزا",
                  message: "پرداخت‌های مرتبط حذف نمی‌شوند و بدون درخواست باقی می‌مانند.",
                  danger: true,
                  confirmLabel: "حذف قطعی",
                });
                if (ok) {
                  await deleteRequest(r.id, r.visaType);
                  toast.info("درخواست حذف شد");
                }
              },
            },
          ]}
          trigger={
            <span className="icon-btn !h-8 !w-8" aria-label="عملیات">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </span>
          }
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
      columns={columns}
      rows={requests}
      rowKey={(r) => r.id}
      onRowClick={openRow}
      loading={loading}
      empty={empty}
      initialSort={{ key: "registrationDate", dir: "desc" }}
      footer={`${toPersianDigits(requests.length)} درخواست`}
      mobileCard={(r) => {
        const c = customersById.get(r.customerId);
        const fullName = c ? customerFullName(c) : "—";
        return (
          <div className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                {c?.photo ? (
                  <button
                    type="button"
                    className="shrink-0 self-start rounded-full outline-none ring-brand-400/60 transition-shadow focus-visible:ring-2"
                    aria-label={`دیدن عکس پروفایل ${fullName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPhotoView({ photo: c.photo!, name: fullName });
                    }}
                  >
                    <Avatar photo={c.photo} name={fullName} />
                  </button>
                ) : (
                  <Avatar photo={undefined} name={fullName} className="self-start" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold">{fullName}</p>
                  <p
                    className="truncate text-[11px] text-ink-500 dark:text-ink-400"
                    title={
                      `${r.visaType ?? "بدون نوع"}${
                        r.representativeId ? ` • ${repsById.get(r.representativeId)?.name ?? ""}` : ""
                      }`
                    }
                  >
                    {r.visaType ?? "بدون نوع"}
                    {r.representativeId ? ` • ${repsById.get(r.representativeId)?.name ?? ""}` : ""}
                  </p>
                </div>
              </div>
              <StatusPill issued={r.issued} rejected={r.rejected} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {r.tags
                  .map((t) => tagsById.get(t))
                  .filter((t): t is Tag => Boolean(t))
                  .map((t) => (
                    <TagBadge key={t.id} tag={t} />
                  ))}
              </div>
              <span className="num text-[12px] font-bold">
                {r.quotedAmount != null && r.currency ? formatMoney(r.quotedAmount, r.currency) : ""}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-ink-900/5 pt-2 text-[11px] text-ink-500 dark:border-white/5 dark:text-ink-400">
              <span className="num">ثبت: {formatJalali(r.registrationDate)}</span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                {r.issued && r.issuedAt && (
                  <span className="num">صدور: {formatJalali(r.issuedAt)}</span>
                )}
                {r.rejected && r.rejectedAt && (
                  <span className="num text-[#dc3535] dark:text-[#f87b7b]">
                    رد: {formatJalali(r.rejectedAt)}
                  </span>
                )}
                <button
                  className="btn btn-glass btn-sm !py-1 !px-2.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleIssue(r);
                  }}
                >
                  {r.issued ? "لغو صدور" : "صادر شد"}
                </button>
                <button
                  className={`btn btn-glass btn-sm !py-1 !px-2.5 ${
                    r.rejected ? "!text-[#dc3535] dark:!text-[#f87b7b]" : "hover:!text-[#dc3535]"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleReject(r);
                  }}
                >
                  <CircleX size={13} />
                  {r.rejected ? "لغو رد" : "رد شد"}
                </button>
              </span>
            </div>
          </div>
        );
      }}
    />

    {/* Big profile photo (opened from a row's avatar) */}
    <Modal
      open={photoView != null}
      onClose={() => setPhotoView(null)}
      size="md"
      title={photoView?.name}
    >
      {photoView && (
        <div className="flex justify-center py-2">
          <img
            src={photoView.photo}
            alt={`عکس پروفایل ${photoView.name}`}
            className="max-h-[64vh] rounded-3xl object-contain"
          />
        </div>
      )}
    </Modal>
    </>
  );
}

export { uiActions };
