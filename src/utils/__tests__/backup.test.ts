/**
 * Backup separation tests — the main (full) app backup must NEVER contain
 * accounting data (the حسابداری section has its own backup), while restore
 * still understands legacy full backups that carry an `acc` payload.
 */

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db/schema";
import { buildBackup, buildRestorePreview } from "../backup";
import type { AccBackupData } from "../../accounting/types";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe("buildBackup excludes the accounting section", () => {
  it("produces a backup with no acc payload even when accounting tables are full", async () => {
    await db.customers.add({
      id: "c1",
      firstName: "احمد",
      lastName: "کریمی",
      passportNo: "P1",
      representativeId: null,
      listId: null,
      registrationDate: "2026-01-01",
      customValues: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    // Fill a couple of accounting tables — they must stay out of the backup.
    await db.accParties.add({
      id: "p1",
      name: "شرکت تست",
      kind: "customer",
      note: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.accTransactions.add({
      id: "t1",
      number: "TR-1405-0001",
      type: "receipt",
      date: "2026-01-05",
      currency: "IRT",
      amount: 1000,
      fromAccountId: null,
      toAccountId: "cash",
      partyId: "p1",
      description: "",
      status: "final",
      informational: false,
      attachments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reversedOf: null,
      reversalOf: null,
    } as never);

    const backup = await buildBackup();

    expect(backup.data.customers).toHaveLength(1);
    expect((backup.data as Record<string, unknown>).acc).toBeUndefined();
    expect(JSON.stringify(backup)).not.toContain("TR-1405-0001");
    expect(JSON.stringify(backup)).not.toContain("شرکت تست");
  });
});

describe("restore preview warns about legacy acc payloads", () => {
  it("warns when an old full backup carries accounting data", async () => {
    const base = await buildBackup();
    const legacy = {
      ...base,
      data: {
        ...base.data,
        acc: {
          parties: [],
          accounts: [],
          transactions: [],
          outstanding: [],
          docsMeta: [],
          settings: null,
        } as AccBackupData,
      },
    };
    const preview = await buildRestorePreview(legacy);
    expect(preview.warnings.some((w) => w.includes("حسابداری"))).toBe(true);
  });

  it("does not warn for new (accounting-free) backups", async () => {
    const backup = await buildBackup();
    const preview = await buildRestorePreview(backup);
    expect(preview.warnings.some((w) => w.includes("حسابداری"))).toBe(false);
  });
});
