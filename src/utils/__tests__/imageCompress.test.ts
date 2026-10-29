/**
 * At-rest image compression engine — pure-logic tests. The full encode path
 * needs a real canvas (browser QA covers it); here we verify the decision
 * logic and the safe passthroughs.
 */

import { describe, expect, it } from "vitest";
import {
  compressImage,
  isCompressibleImage,
  retargetName,
  shouldReplace,
} from "../imageCompress";

describe("isCompressibleImage", () => {
  it("accepts raster images", () => {
    expect(isCompressibleImage("image/jpeg")).toBe(true);
    expect(isCompressibleImage("image/png")).toBe(true);
    expect(isCompressibleImage("image/webp")).toBe(true);
    expect(isCompressibleImage("image/bmp")).toBe(true);
  });

  it("rejects non-images and destructive formats", () => {
    expect(isCompressibleImage("application/pdf")).toBe(false);
    expect(isCompressibleImage("image/svg+xml")).toBe(false); // SVG is code
    expect(isCompressibleImage("image/gif")).toBe(false); // animations die
    expect(isCompressibleImage("")).toBe(false);
  });
});

describe("retargetName", () => {
  it("swaps the extension to the new format", () => {
    expect(retargetName("passport-scan.png", "image/webp")).toBe("passport-scan.webp");
    expect(retargetName("photo.jpeg", "image/webp")).toBe("photo.webp");
    expect(retargetName("tazkira.png", "image/jpeg")).toBe("tazkira.jpg");
  });

  it("handles names without or with double extensions", () => {
    expect(retargetName("scan", "image/jpeg")).toBe("scan.jpg");
    expect(retargetName("scan.v2.png", "image/jpeg")).toBe("scan.v2.jpg");
    expect(retargetName("scan.", "image/webp")).toBe("scan.webp");
  });

  it("keeps the name for unknown mimes and provides a fallback", () => {
    expect(retargetName("doc.pdf", "application/pdf")).toBe("doc.pdf");
    expect(retargetName(undefined, "image/jpeg")).toBe("عکس.jpg");
    expect(retargetName(undefined, "application/pdf")).toBe("عکس");
  });
});

describe("shouldReplace", () => {
  it("replaces only with a meaningful gain when dimensions are unchanged", () => {
    expect(shouldReplace(1_000_000, 900_000, false)).toBe(true); // −10٪
    expect(shouldReplace(1_000_000, 950_000, false)).toBe(false); // −5٪ not worth it
    expect(shouldReplace(1_000_000, 1_100_000, false)).toBe(false); // bigger
    expect(shouldReplace(1_000_000, 1_000_000, false)).toBe(false); // same
  });

  it("accepts ANY size win when the image was downscaled", () => {
    expect(shouldReplace(1_000_000, 990_000, true)).toBe(true);
    expect(shouldReplace(1_000_000, 999_999, true)).toBe(true);
    expect(shouldReplace(1_000_000, 1_000_000, true)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(shouldReplace(NaN, 100, false)).toBe(false);
    expect(shouldReplace(100, NaN, false)).toBe(false);
    expect(shouldReplace(100, 0, false)).toBe(false);
  });
});

describe("compressImage (safe passthroughs)", () => {
  it("returns PDFs and other non-images untouched", async () => {
    const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
    const res = await compressImage({ blob, name: "doc.pdf" });
    expect(res.replaced).toBe(false);
    expect(res.attempted).toBe(false);
    expect(res.blob).toBe(blob);
    expect(res.savedBytes).toBe(0);
  });

  it("skips small images below the threshold", async () => {
    const blob = new Blob([new Uint8Array(1024)], { type: "image/jpeg" }); // 1KB
    const res = await compressImage({ blob, name: "tiny.jpg", mime: "image/jpeg" });
    expect(res.attempted).toBe(false);
    expect(res.blob).toBe(blob);
  });

  it("keeps the original when decoding is impossible (no canvas env)", async () => {
    // Node test env has no createImageBitmap → engine must never throw.
    const blob = new Blob([new Uint8Array(500 * 1024)], { type: "image/jpeg" });
    const res = await compressImage({ blob, name: "big.jpg" });
    expect(res.replaced).toBe(false);
    expect(res.blob).toBe(blob);
    expect(res.finalBytes).toBe(blob.size);
  });
});
