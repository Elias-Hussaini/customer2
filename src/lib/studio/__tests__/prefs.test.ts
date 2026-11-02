/**
 * ابزار عکس — remembered output preferences (studio.prefs.v1).
 *
 * Covers the user's round-19 asks:
 *  - default format is JPEG (never WebP) on a fresh device,
 *  - every choice round-trips (format / quality / maxEdge / last folder),
 *  - corrupted or hostile stored values fall back safely field-by-field.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STUDIO_PREFS,
  __resetStudioPrefsForTests,
  loadStudioPrefs,
  saveStudioPrefs,
} from "../prefs";

beforeEach(() => {
  __resetStudioPrefsForTests();
});

describe("studio prefs — defaults", () => {
  it("fresh device → JPEG by default (پیشفرض jpg، نه webp)", () => {
    expect(loadStudioPrefs()).toEqual(DEFAULT_STUDIO_PREFS);
    expect(DEFAULT_STUDIO_PREFS.format).toBe("image/jpeg");
    expect(DEFAULT_STUDIO_PREFS.maxEdge).toBe(0);
  });
});

describe("studio prefs — persistence", () => {
  it("round-trips the last output settings", () => {
    saveStudioPrefs({ format: "image/webp", quality: 0.7, maxEdge: 1600 });
    const p = loadStudioPrefs();
    expect(p.format).toBe("image/webp");
    expect(p.quality).toBe(0.7);
    expect(p.maxEdge).toBe(1600);
  });

  it("merge-persists: a later patch keeps earlier fields", () => {
    saveStudioPrefs({ quality: 0.9 });
    saveStudioPrefs({ maxEdge: 800 });
    const p = loadStudioPrefs();
    expect(p.quality).toBe(0.9);
    expect(p.maxEdge).toBe(800);
    expect(p.format).toBe("image/jpeg"); // untouched
  });

  it("remembers the last library folder (including سایر = null)", () => {
    saveStudioPrefs({ lastFolderId: "folder-1" });
    expect(loadStudioPrefs().lastFolderId).toBe("folder-1");
    saveStudioPrefs({ lastFolderId: null });
    expect(loadStudioPrefs().lastFolderId).toBeNull();
  });
});

describe("studio prefs — sanitization", () => {
  it("clamps quality into 0.3..1", () => {
    saveStudioPrefs({ quality: 5 });
    expect(loadStudioPrefs().quality).toBe(1);
    saveStudioPrefs({ quality: 0.01 });
    expect(loadStudioPrefs().quality).toBe(0.3);
  });

  it("rejects unknown formats and edge values", () => {
    saveStudioPrefs({ format: "image/gif" as never, maxEdge: 1234 });
    const p = loadStudioPrefs();
    expect(p.format).toBe("image/jpeg");
    expect(p.maxEdge).toBe(0);
  });
});
