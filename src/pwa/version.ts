import { formatJalali, toPersianDigits } from "../utils/jalali";

/**
 * Build identity — injected at compile time by vite.config.ts `define`.
 * Lets the user SEE which version is actually running on their device,
 * instead of guessing whether a deploy reached them.
 */
export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";
export const BUILD_DATE: Date = new Date(
  typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "",
);
export const BUILD_IS_VALID = !Number.isNaN(BUILD_DATE.getTime());

const pad = (n: number) => String(n).padStart(2, "0");

/** Build time as local ISO date (yyyy-mm-dd) for formatJalali. */
function buildIsoDate(): string {
  return `${BUILD_DATE.getFullYear()}-${pad(BUILD_DATE.getMonth() + 1)}-${pad(BUILD_DATE.getDate())}`;
}

/** Jalali build date + clock, e.g. «۷ آبان ۱۴۰۵ · ۱۸:۰۲». */
export function buildLabel(): string {
  if (!BUILD_IS_VALID) return "dev";
  const time = toPersianDigits(`${pad(BUILD_DATE.getHours())}:${pad(BUILD_DATE.getMinutes())}`);
  return `${formatJalali(buildIsoDate(), "long")} · ${time}`;
}

/** Compact stamp for tight UI spots, e.g. «a506754». */
export function buildStamp(): string {
  return BUILD_SHA;
}

/** Full human-readable line for tooltips / the settings page. */
export function buildFullLabel(): string {
  if (!BUILD_IS_VALID) return `dev build (${BUILD_SHA})`;
  return `${buildLabel()} — نسخهٔ ${BUILD_SHA}`;
}
