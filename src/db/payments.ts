import { db } from "./schema";
import { logActivity } from "./activities";
import type { Payment } from "../types";
import { uid } from "../utils/id";
import { normalizeAmount, formatMoney } from "../utils/num";
import { todayIso } from "../utils/jalali";

export interface PaymentInput {
  representativeId: string;
  requestId: string | null;
  amount: number;
  currency: Payment["currency"];
  date: string;
  description?: string;
}

export async function createPayment(input: PaymentInput): Promise<Payment> {
  const now = Date.now();
  const payment: Payment = {
    id: uid(),
    representativeId: input.representativeId,
    requestId: input.requestId,
    amount: normalizeAmount(input.amount, input.currency),
    currency: input.currency,
    date: input.date || todayIso(),
    description: input.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  const rep = await db.representatives.get(payment.representativeId);
  await db.payments.add(payment);
  await logActivity({
    type: "payment",
    entity: "payment",
    entityId: payment.id,
    title: `پرداخت ${formatMoney(payment.amount, payment.currency)} ثبت شد`,
    detail: `نماینده: ${rep?.name ?? "—"}`,
  });
  return payment;
}

export async function updatePayment(id: string, input: PaymentInput): Promise<void> {
  const rep = await db.representatives.get(input.representativeId);
  await db.payments.update(id, {
    representativeId: input.representativeId,
    requestId: input.requestId,
    amount: normalizeAmount(input.amount, input.currency),
    currency: input.currency,
    date: input.date,
    description: input.description?.trim() || undefined,
    updatedAt: Date.now(),
  });
  await logActivity({
    type: "update",
    entity: "payment",
    entityId: id,
    title: `پرداخت ${formatMoney(input.amount, input.currency)} ویرایش شد`,
    detail: `نماینده: ${rep?.name ?? "—"}`,
  });
}

export async function deletePayment(id: string): Promise<void> {
  const p = await db.payments.get(id);
  await db.transaction("rw", db.payments, db.attachments, async () => {
    // Remove the receipt photo together with the payment.
    const receipts = await db.attachments.where("paymentId").equals(id).toArray();
    await Promise.all(receipts.map((r) => db.attachments.delete(r.id)));
    await db.payments.delete(id);
  });
  if (p) {
    await logActivity({
      type: "delete",
      entity: "payment",
      entityId: id,
      title: `پرداخت ${formatMoney(p.amount, p.currency)} حذف شد`,
    });
  }
}
