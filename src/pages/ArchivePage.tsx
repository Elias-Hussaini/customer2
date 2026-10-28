import { useState } from "react";
import { ArchiveRestore, Inbox, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Tabs } from "../components/ui/Tabs";
import { GlassCard } from "../components/ui/GlassCard";
import {
  restoreCustomer,
  customerFullName,
  deleteCustomer,
} from "../db/customers";
import { restoreRepresentative } from "../db/reps";
import { restoreList } from "../db/lists";
import { restoreRequest as restoreReq, deleteRequest } from "../db/requests";
import { restoreTag } from "../db/taxonomy";
import {
  useArchivedCustomers,
  useArchivedLists,
  useArchivedRequests,
  useArchivedRepresentatives,
  useArchivedTags,
} from "../hooks/useData";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { formatJalali, isoFromDate, toPersianDigits } from "../utils/jalali";
import type { Customer, ListFolder, Representative, Tag, VisaRequest } from "../types";
import { requestStatusFa } from "../types";

function ArchiveRow({
  title,
  subtitle,
  archivedAt,
  onRestore,
  onDelete,
}: {
  title: string;
  subtitle?: string;
  archivedAt: number | null | undefined;
  onRestore: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl p-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold">{title}</p>
        <p className="text-[11px] text-ink-400">
          {subtitle ? `${subtitle} • ` : ""}بایگانی:{" "}
          {formatJalali(archivedAt ? isoFromDate(new Date(archivedAt)) : undefined)}
        </p>
      </div>
      <button className="btn btn-glass btn-sm" onClick={onRestore}>
        <ArchiveRestore size={14} /> بازگردانی
      </button>
      {onDelete && (
        <button className="btn btn-danger-soft btn-sm" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export function ArchivePage() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const customers = useArchivedCustomers();
  const representatives = useArchivedRepresentatives();
  const lists = useArchivedLists();
  const requests = useArchivedRequests();
  const tags = useArchivedTags();

  const [tab, setTab] = useState("customers");
  void setTab;

  const total =
    (customers?.length ?? 0) +
    (representatives?.length ?? 0) +
    (lists?.length ?? 0) +
    (requests?.length ?? 0) +
    (tags?.length ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="آرشیو"
        subtitle={`${toPersianDigits(total)} رکورد بایگانی‌شده — ترجیحاً به‌جای حذف، بایگانی کنید`}
      />

      <Tabs
        tabs={[
          {
            key: "customers",
            label: "مشتریان",
            badge: customers?.length ?? 0,
            content:
              customers && customers.length === 0 ? (
                <EmptyState icon={Inbox} title="آیتمی بایگانی نشده" compact />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(customers ?? []).map((c: Customer) => (
                    <ArchiveRow
                      key={c.id}
                      title={customerFullName(c)}
                      subtitle={c.passportNo}
                      archivedAt={c.archivedAt}
                      onRestore={async () => {
                        await restoreCustomer(c.id, customerFullName(c));
                        toast.success("بازگردانی شد");
                      }}
                      onDelete={async () => {
                        const ok = await confirm({
                          title: `حذف قطعی «${customerFullName(c)}»`,
                          message: "همه درخواست‌ها و مدارک این مشتری هم حذف می‌شوند!",
                          danger: true,
                          confirmLabel: "حذف قطعی",
                        });
                        if (ok) {
                          await deleteCustomer(c.id, customerFullName(c));
                          toast.info("حذف شد");
                        }
                      }}
                    />
                  ))}
                </div>
              ),
          },
          {
            key: "representatives",
            label: "نمایندگان",
            badge: representatives?.length ?? 0,
            content:
              representatives && representatives.length === 0 ? (
                <EmptyState icon={Inbox} title="آیتمی بایگانی نشده" compact />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(representatives ?? []).map((r: Representative) => (
                    <ArchiveRow
                      key={r.id}
                      title={r.name}
                      subtitle={r.phone}
                      archivedAt={r.archivedAt}
                      onRestore={async () => {
                        await restoreRepresentative(r.id, r.name);
                        toast.success("بازگردانی شد");
                      }}
                    />
                  ))}
                </div>
              ),
          },
          {
            key: "lists",
            label: "لیست‌ها",
            badge: lists?.length ?? 0,
            content:
              lists && lists.length === 0 ? (
                <EmptyState icon={Inbox} title="آیتمی بایگانی نشده" compact />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(lists ?? []).map((l: ListFolder) => (
                    <ArchiveRow
                      key={l.id}
                      title={l.name}
                      subtitle={l.category}
                      archivedAt={l.archivedAt}
                      onRestore={async () => {
                        await restoreList(l.id, l.name);
                        toast.success("بازگردانی شد");
                      }}
                    />
                  ))}
                </div>
              ),
          },
          {
            key: "requests",
            label: "درخواست‌ها",
            badge: requests?.length ?? 0,
            content:
              requests && requests.length === 0 ? (
                <EmptyState icon={Inbox} title="آیتمی بایگانی نشده" compact />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(requests ?? []).map((r: VisaRequest) => (
                    <ArchiveRow
                      key={r.id}
                      title={r.visaType ?? "درخواست ویزا"}
                      subtitle={requestStatusFa(r)}
                      archivedAt={r.archivedAt}
                      onRestore={async () => {
                        await restoreReq(r.id, r.visaType);
                        toast.success("بازگردانی شد");
                      }}
                      onDelete={async () => {
                        const ok = await confirm({
                          title: "حذف قطعی درخواست",
                          danger: true,
                          confirmLabel: "حذف قطعی",
                        });
                        if (ok) {
                          await deleteRequest(r.id, r.visaType);
                          toast.info("حذف شد");
                        }
                      }}
                    />
                  ))}
                </div>
              ),
          },
          {
            key: "tags",
            label: "تگ‌ها",
            badge: tags?.length ?? 0,
            content:
              tags && tags.length === 0 ? (
                <EmptyState icon={Inbox} title="آیتمی بایگانی نشده" compact />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(tags ?? []).map((t: Tag) => (
                    <ArchiveRow
                      key={t.id}
                      title={t.name}
                      archivedAt={t.archivedAt}
                      onRestore={async () => {
                        await restoreTag(t.id, t.name);
                        toast.success("بازگردانی شد");
                      }}
                    />
                  ))}
                </div>
              ),
          },
        ]}
      />

      <GlassCard className="p-4">
        <p className="text-[12px] leading-6 text-ink-500 dark:text-ink-400">
          بایگانی یعنی رکورد از فهرست‌های روزمره حذف می‌شود اما داده‌هایش محفوظ است و هر
          زمان می‌توانید آن را برگردانید. برای سوابق مالی، بایگانی به‌جای حذف توصیه می‌شود.
        </p>
      </GlassCard>
    </div>
  );
}
