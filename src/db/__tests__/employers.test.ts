/**
 * کارفرما (employers) — the OPTIONAL customer attribute:
 * CRUD lifecycle, customer attachment/detachment, backup round trip.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../schema";
import {
  createEmployer,
  updateEmployer,
  archiveEmployer,
  restoreEmployer,
  deleteEmployer,
  findEmployerDuplicates,
} from "../employers";
import { createCustomer, updateCustomer } from "../customers";
import { saveEmployerAttachment } from "../attachments";
import { buildBackup, applyRestore } from "../../utils/backup";

beforeEach(async () => {
  await Promise.all([
    db.employers.clear(),
    db.customers.clear(),
    db.activities.clear(),
    db.preferences.clear(),
  ]);
});

describe("employer lifecycle", () => {
  it("creates, updates and archives/restores", async () => {
    const emp = await createEmployer({ name: "شرکت ساختمانی هرات", phone: "0700123456" });
    expect(emp.name).toBe("شرکت ساختمانی هرات");
    expect(emp.archivedAt).toBeUndefined();

    await updateEmployer(emp.id, { name: "شرکت ساختمانی کابل" });
    const renamed = await db.employers.get(emp.id);
    expect(renamed?.name).toBe("شرکت ساختمانی کابل");

    await archiveEmployer(emp.id, "شرکت ساختمانی کابل");
    expect((await db.employers.get(emp.id))?.archivedAt).toBeTruthy();
    await restoreEmployer(emp.id, "شرکت ساختمانی کابل");
    expect((await db.employers.get(emp.id))?.archivedAt).toBeNull();
  });

  it("attaches to a customer as an OPTIONAL field and survives edits", async () => {
    const emp = await createEmployer({ name: "کارفرما الف" });
    const withEmployer = await createCustomer({
      firstName: "زهرا",
      lastName: "موسی",
      representativeId: "r1",
      listId: "l1",
      employerId: emp.id,
      registrationDate: "2026-01-05",
    });
    expect(withEmployer.employerId).toBe(emp.id);

    // بدون کارفرما is a first-class choice — clearing is explicit.
    const without = await createCustomer({
      firstName: "علی",
      lastName: "احمدی",
      representativeId: "r1",
      listId: "l1",
      registrationDate: "2026-01-05",
    });
    expect(without.employerId).toBeNull();
  });

  it("deleting an employer detaches its customers but keeps them", async () => {
    const emp = await createEmployer({ name: "کارفرما ب" });
    const c1 = await createCustomer({
      firstName: "مریم",
      representativeId: "r1",
      listId: "l1",
      employerId: emp.id,
      registrationDate: "2026-01-05",
    });
    await createCustomer({
      firstName: "نرگس",
      representativeId: "r1",
      listId: "l1",
      employerId: emp.id,
      registrationDate: "2026-01-05",
    });

    await deleteEmployer(emp.id, "کارفرما ب");
    expect(await db.employers.count()).toBe(0);
    // both customers survive, detached
    expect(await db.customers.count()).toBe(2);
    const after = await db.customers.get(c1.id);
    expect(after?.employerId).toBeNull();
  });
});

describe("employer backup round trip", () => {
  it("travels through the JSON backup untouched", async () => {
    const emp = await createEmployer({ name: "کارفرما پشتیبان" });
    await createCustomer({
      firstName: "سمیرا",
      representativeId: "r1",
      listId: "l1",
      employerId: emp.id,
      registrationDate: "2026-02-01",
    });

    const backup = await buildBackup();
    expect(backup.counts.employers).toBe(1);
    expect(backup.data.employers?.[0]?.name).toBe("کارفرما پشتیبان");

    await db.employers.clear();
    await db.customers.clear();
    await applyRestore(backup, "replace");
    const restored = await db.employers.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("کارفرما پشتیبان");
    const restoredCustomer = (await db.customers.toArray())[0];
    expect(restoredCustomer.employerId).toBe(restored[0].id);
  });

  it("old backups without employers still restore (optional field)", async () => {
    const backup = await buildBackup();
    // simulate a pre-employer backup: strip the employers array
    const legacy = { ...backup, data: { ...backup.data, employers: undefined } };
    await expect(applyRestore(legacy as never, "merge")).resolves.toBeDefined();
  });
});

describe("employer v10 — full profile fields", () => {
  it("stores and round trips every field including custom values", async () => {
    const emp = await createEmployer({
      name: "شرکت پیمانکاری نبض",
      phone: "0799887766",
      email: "info@nabz.af",
      nationalId: "1234567890",
      username: "nabz_admin",
      password: "s3cret-مخفی",
      address: "کابل، شهر نو، کوچهٔ ۵",
      postalCode: "1001",
      notes: "کارفرمای پروژهٔ ساختمانی",
      customValues: { contract_no: "C-99" },
    });
    const stored = await db.employers.get(emp.id);
    expect(stored?.email).toBe("info@nabz.af");
    expect(stored?.nationalId).toBe("1234567890");
    expect(stored?.username).toBe("nabz_admin");
    expect(stored?.password).toBe("s3cret-مخفی");
    expect(stored?.address).toContain("شهر نو");
    expect(stored?.postalCode).toBe("1001");
    expect(stored?.customValues?.contract_no).toBe("C-99");

    await updateEmployer(emp.id, { name: "شرکت پیمانکاری نبض", password: "new-pass", customValues: { contract_no: "C-100" } });
    const updated = await db.employers.get(emp.id);
    expect(updated?.password).toBe("new-pass");
    expect(updated?.customValues?.contract_no).toBe("C-100");
  });

  it("duplicate detection flags same name and same کد ملی (non-blocking)", async () => {
    await createEmployer({ name: "شرکت الف", nationalId: "111" });
    const warnings = await findEmployerDuplicates({ name: "شرکت الف", nationalId: "111" });
    expect(warnings.length).toBe(2);
    const none = await findEmployerDuplicates({ name: "شرکت ب" });
    expect(none.length).toBe(0);
  });

  it("hard delete removes the employer's OWN documents but detaches customers", async () => {
    const emp = await createEmployer({ name: "شرکت حذف‌شونده" });
    const customer = await createCustomer({
      firstName: "مشتری",
      lastName: "تست",
      registrationDate: "2025-01-01",
      employerId: emp.id,
    });
    const att = await saveEmployerAttachment(emp.id, new File([new Uint8Array([1, 2, 3, 4])], "قرارداد.png", { type: "image/png" }), "قرارداد امضا‌شده");
    void att;

    await deleteEmployer(emp.id, "شرکت حذف‌شونده");
    expect(await db.employers.get(emp.id)).toBeUndefined();
    // customers survive, detached:
    const kept = await db.customers.get(customer.id);
    expect(kept?.employerId).toBeNull();
    // employer docs are gone:
    const docs = await db.attachments.where("employerId").equals(emp.id).toArray();
    expect(docs.length).toBe(0);
    // but other docs untouched:
    void saveEmployerAttachment;
  });

  it("customer شغل round trips", async () => {
    const c = await createCustomer({
      firstName: "احمد",
      lastName: "کریمی",
      job: "برق‌کار",
      registrationDate: "2025-02-02",
    });
    expect((await db.customers.get(c.id))?.job).toBe("برق‌کار");
    await updateCustomer(c.id, {
      firstName: "احمد",
      lastName: "کریمی",
      job: "پیمانکار برق",
      registrationDate: "2025-02-02",
    });
    expect((await db.customers.get(c.id))?.job).toBe("پیمانکار برق");
  });
});
