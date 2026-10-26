import { db } from "./schema";
import { createCustomer } from "./customers";
import { createRepresentative } from "./reps";
import { createRequest } from "./requests";
import { createList } from "./lists";
import { createPayment } from "./payments";
import { createTag } from "./taxonomy";
import { todayIso } from "../utils/jalali";

function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Explicit, user-triggered demo data loader (Settings → مدیریت داده).
 * Creates a realistic sample dataset through the normal repositories so the
 * activity trail is populated too.
 */
export async function seedDemoData(): Promise<void> {
  const existing = await db.customers.count();
  if (existing > 0) {
    throw new Error("برای بارگذاری داده نمونه، ابتدا داده‌های فعلی را پاک کنید.");
  }

  const repAli = await createRepresentative({
    name: "علی رضایی",
    phone: "09121234567",
    contactInfo: "تلگرام: @ali_rezaei",
    notes: "نماینده اصلی تهران",
  });
  const repMaryam = await createRepresentative({
    name: "مریم احمدی",
    phone: "09359876543",
    contactInfo: "واتساپ",
    notes: "متخصص ویزای عمره",
  });
  const repHossein = await createRepresentative({
    name: "حسین کریمی",
    phone: "09195557733",
    notes: "نماینده مشهد",
  });

  const tags = {
    urgent: await createTag({ name: "فوری", color: "#ef4444", isUrgent: true }),
    normal: await createTag({ name: "عادی", color: "#64748b", isUrgent: false }),
    missing: await createTag({ name: "مدارک ناقص", color: "#f59e0b", isUrgent: false }),
    review: await createTag({ name: "در حال بررسی", color: "#3b82f6", isUrgent: false }),
    follow: await createTag({ name: "نیاز به پیگیری", color: "#8b5cf6", isUrgent: false }),
  };

  const listDomestic = await createList({
    name: "ویزای داخله",
    description: "درخواست‌های ویزای داخلی این ماه",
    category: "داخلی",
    startDate: shiftDays(-45),
    endDate: shiftDays(45),
  });
  const listOctNov = await createList({
    name: "درخواست‌های آبان — آذر",
    description: "بازه دوم پاییز",
    startDate: shiftDays(-20),
    endDate: shiftDays(40),
  });
  const listUrgent = await createList({
    name: "درخواست‌های فوری",
    description: "پرونده‌هایی که باید سریع‌تر پیش بروند",
    category: "فوری",
  });

  const c1 = await createCustomer({
    firstName: "زهرا",
    lastName: "موسوی",
    birthDate: "1992-04-18",
    passportNo: "A12345678",
    passportIssueDate: "2021-06-10",
    passportExpiryDate: "2031-06-09",
    referrer: "آقای تهرانی",
    notes: "سفر توریستی",
    representativeId: repAli.id,
    listId: listDomestic.id,
    registrationDate: shiftDays(-30),
  });
  const c2 = await createCustomer({
    firstName: "محمد",
    lastName: "کریمی",
    birthDate: "1985-11-02",
    passportNo: "B87654321",
    passportIssueDate: "2020-01-15",
    passportExpiryDate: "2030-01-14",
    referrer: "مریم احمدی",
    representativeId: repMaryam.id,
    listId: listOctNov.id,
    registrationDate: shiftDays(-26),
  });
  const c3 = await createCustomer({
    firstName: "فاطمه",
    lastName: "نجفی",
    birthDate: "1998-09-25",
    passportNo: "C33445566",
    referrer: "خانم رضایی",
    representativeId: repAli.id,
    listId: listUrgent.id,
    registrationDate: shiftDays(-18),
  });
  const c4 = await createCustomer({
    firstName: "امیرحسین",
    lastName: "صادقی",
    birthDate: "1990-02-11",
    passportNo: "D99887766",
    representativeId: repHossein.id,
    listId: listDomestic.id,
    registrationDate: shiftDays(-12),
    notes: "پاسپورت قدیمی — تا ۸ ماه دیگر منقضی می‌شود",
  });
  const c5 = await createCustomer({
    firstName: "نگار",
    lastName: "رحیمی",
    birthDate: "1995-07-07",
    passportNo: "E11223344",
    representativeId: repMaryam.id,
    listId: listOctNov.id,
    registrationDate: shiftDays(-8),
  });
  const c6 = await createCustomer({
    firstName: "سعید",
    lastName: "قاسمی",
    birthDate: "1988-03-30",
    passportNo: "F55667788",
    representativeId: repAli.id,
    listId: listDomestic.id,
    registrationDate: shiftDays(-3),
  });

  const r1 = await createRequest({
    customerId: c1.id,
    representativeId: repAli.id,
    listId: listDomestic.id,
    visaType: "ویزای توریستی",
    tags: [tags.normal.id],
    quotedAmount: 250,
    currency: "USD",
    registrationDate: shiftDays(-29),
    issued: true,
    issuedAt: shiftDays(-10),
    notes: "تاریخ پرواز قطعی شده",
  });
  const r2 = await createRequest({
    customerId: c2.id,
    representativeId: repMaryam.id,
    listId: listOctNov.id,
    visaType: "ویزای عمره",
    tags: [tags.urgent.id],
    quotedAmount: 850,
    currency: "USD",
    registrationDate: shiftDays(-25),
    issued: false,
    notes: "ظرفیت پرواز در حال تکمیل است",
  });
  await createRequest({
    customerId: c3.id,
    representativeId: repAli.id,
    listId: listUrgent.id,
    visaType: "ویزای تحصیلی",
    tags: [tags.urgent.id, tags.missing.id],
    quotedAmount: 42_000_000,
    currency: "IRT",
    registrationDate: shiftDays(-17),
    issued: false,
    notes: "در انتظار ترجمه مدارک",
  });
  await createRequest({
    customerId: c4.id,
    representativeId: repHossein.id,
    listId: listDomestic.id,
    visaType: "ویزای توریستی",
    tags: [tags.review.id],
    quotedAmount: 230,
    currency: "USD",
    registrationDate: shiftDays(-11),
    issued: true,
    issuedAt: shiftDays(-2),
  });
  await createRequest({
    customerId: c5.id,
    representativeId: repMaryam.id,
    listId: listOctNov.id,
    visaType: "ویزای درمانی",
    tags: [tags.follow.id],
    quotedAmount: 68_000_000,
    currency: "IRT",
    registrationDate: shiftDays(-7),
    issued: false,
  });
  const r6 = await createRequest({
    customerId: c6.id,
    representativeId: repAli.id,
    listId: listDomestic.id,
    visaType: "ویزای توریستی",
    tags: [tags.normal.id],
    quotedAmount: 240,
    currency: "USD",
    registrationDate: shiftDays(-2),
    issued: false,
  });
  void r1;
  void r6;

  await createPayment({
    representativeId: repAli.id,
    requestId: r1.id,
    amount: 150,
    currency: "USD",
    date: shiftDays(-27),
    description: "پیش‌پرداخت",
  });
  await createPayment({
    representativeId: repMaryam.id,
    requestId: r2.id,
    amount: 400,
    currency: "USD",
    date: shiftDays(-24),
    description: "قسط اول",
  });
  await createPayment({
    representativeId: repAli.id,
    requestId: null,
    amount: 15_000_000,
    currency: "IRT",
    date: shiftDays(-9),
    description: "پرداخت هزینه ترجمه",
  });
}
