import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Database,
  Radar,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  ANOMALY_MAX_CLICKS,
  ANOMALY_MIN_CLICKS,
  armAnomaly,
  disarmAnomaly,
  hasConsoleAccess,
  setCacheOff,
  useSecurityState,
} from "../security/securityStore";
import {
  applySecurityCacheState,
  inspectPwaState,
} from "../pwa/usePwaUpdate";
import { useToast } from "../hooks/useToast";

/**
 * صفحه امنیتی مخفی — «Security Console».
 *
 * Reachable ONLY through the secret combo (Ctrl+Alt+Shift + 09029327968,
 * in order) which plants a sessionStorage grant; a direct URL visit without
 * the grant bounces straight back to the app. Absent from every menu, the
 * sitemap and the global search.
 *
 *  - کش: kill-switch for the PWA cache (service worker + CacheStorage).
 *      ON  → offline works as before (current default).
 *      OFF → everything offline is purged; the app runs internet-only.
 *  - حالت ناهنجاری: arms the invisible trap — the console closes, the main
 *      page opens, everything looks normal, and on the 15th–20th click the
 *      screen locks and demands the owner password. Cache stays OFF for the
 *      whole trap and is restored automatically when it ends.
 */

function faDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export default function SecurityConsolePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const cacheOff = useSecurityState((s) => s.cacheOff);
  const anomaly = useSecurityState((s) => s.anomaly);
  const locked = useSecurityState((s) => s.locked);

  const [browserState, setBrowserState] = useState<{
    swCount: number;
    cacheNames: string[];
    controlled: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);

  const refreshBrowserState = useCallback(async () => {
    setBrowserState(await inspectPwaState());
  }, []);

  useEffect(() => {
    void refreshBrowserState();
    const t = window.setInterval(() => void refreshBrowserState(), 2_000);
    return () => window.clearInterval(t);
  }, [refreshBrowserState]);

  // No grant (direct URL, or grant died with the arming) → back to the app.
  if (!hasConsoleAccess()) return <Navigate to="/" replace />;

  const toggleCache = async () => {
    if (busy || anomaly) return;
    setBusy(true);
    try {
      const next = !cacheOff;
      setCacheOff(next);
      await applySecurityCacheState();
      if (next) {
        toast.info("کش غیرفعال شد — برنامه از این پس فقط با اینترنت کار می‌کند.");
      } else {
        setReloading(true);
        toast.info("کش فعال شد — صفحه برای بازگشت حالت آفلاین بازآوری می‌شود.");
        window.setTimeout(() => window.location.reload(), 900);
        return;
      }
      await refreshBrowserState();
    } finally {
      setBusy(false);
    }
  };

  const startAnomaly = async () => {
    if (busy || anomaly || locked) return;
    setBusy(true);
    try {
      armAnomaly(); // force-disables the cache + revokes this console's grant
      await applySecurityCacheState(); // purge SW + caches right now
      toast.info("حالت ناهنجاری فعال شد — همه‌چیز طبیعی به نظر می‌رسد.");
      // «صفحه امنیتی بسته بشه و صفحه اصلی باز بشه»
      navigate("/");
    } finally {
      setBusy(false);
    }
  };

  const stopAnomaly = async () => {
    if (busy || !anomaly) return;
    setBusy(true);
    try {
      disarmAnomaly(); // restores the pre-trap cache state
      await applySecurityCacheState();
      toast.success("حالت ناهنجاری پایان یافت — وضعیت قبلی بازگردانده شد.");
      await refreshBrowserState();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-sec-console
      dir="rtl"
      className="relative min-h-dvh overflow-hidden bg-[#0d0f1a] px-4 py-8 text-ink-100"
    >
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.08]">
        <div className="absolute -top-32 right-0 h-96 w-96 rounded-full bg-brand-500 blur-[130px]" />
        <div className="absolute -bottom-32 left-0 h-96 w-96 rounded-full bg-[#8b5cf6] blur-[130px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300">
              <ShieldCheck size={24} />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white">کنسول امنیتی</h1>
              <p className="text-xs text-ink-400">صفحه مخفی — فقط با ترکیب کلید مخفی</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-glass btn-sm"
            onClick={() => navigate("/")}
          >
            <ArrowRight size={16} />
            بازگشت به برنامه
          </button>
        </div>

        {/* card 1 — cache */}
        <section className="rounded-3xl border border-white/10 bg-[#151a2e]/95 p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                  cacheOff
                    ? "bg-[#ef4444]/12 text-[#f87171]"
                    : "bg-emerald-500/12 text-emerald-400"
                }`}
              >
                {cacheOff ? <WifiOff size={22} /> : <Wifi size={22} />}
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-white">کش برنامه (حالت آفلاین)</h2>
                <p className="mt-0.5 text-xs leading-5 text-ink-400">
                  {cacheOff
                    ? "غیرفعال — برنامه فقط با اینترنت کار می‌کند."
                    : "فعال — برنامه بدون اینترنت هم کار می‌کند."}
                </p>
              </div>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${cacheOff ? "btn-primary" : "btn-danger"}`}
              disabled={busy || reloading || !!anomaly}
              onClick={() => void toggleCache()}
            >
              {cacheOff ? "فعال‌سازی کش" : "غیرفعال‌سازی کش"}
            </button>
          </div>

          <div className="mt-4 rounded-2xl bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-300">
                <Database size={14} />
                وضعیت زنده مرورگر
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="بازآوری وضعیت"
                onClick={() => void refreshBrowserState()}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
              <div className="rounded-xl bg-white/[0.03] px-2 py-2.5">
                <div className="text-lg font-extrabold text-white">
                  {browserState ? faDigits(browserState.swCount) : "…"}
                </div>
                <div className="text-[11px] text-ink-400">سرویس‌ورکر فعال</div>
              </div>
              <div className="rounded-xl bg-white/[0.03] px-2 py-2.5">
                <div className="text-lg font-extrabold text-white">
                  {browserState ? faDigits(browserState.cacheNames.length) : "…"}
                </div>
                <div className="text-[11px] text-ink-400">حافظه‌های کش</div>
              </div>
              <div className="col-span-2 rounded-xl bg-white/[0.03] px-2 py-2.5 sm:col-span-1">
                <div
                  className={`text-lg font-extrabold ${
                    browserState?.controlled ? "text-emerald-400" : "text-ink-300"
                  }`}
                >
                  {browserState ? (browserState.controlled ? "بله" : "خیر") : "…"}
                </div>
                <div className="text-[11px] text-ink-400">تحت کنترل کش</div>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-ink-500">
              غیرفعال‌سازی کش، سرویس‌ورکر و حافظه‌های آفلاین مرورگر را کامل پاک
              می‌کند؛ داده‌های شما (مشتریان، مدارک، پرداخت‌ها) دست‌نخورده می‌مانند.
              فعال‌سازی مجدد، حالت آفلاین را برمی‌گرداند و صفحه یک‌بار بازآوری می‌شود.
            </p>
          </div>
        </section>

        {/* card 2 — anomaly */}
        <section className="rounded-3xl border border-white/10 bg-[#151a2e]/95 p-6 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                  anomaly
                    ? "bg-amber-500/12 text-amber-400"
                    : "bg-brand-500/12 text-brand-300"
                }`}
              >
                <Radar size={22} />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-white">حالت ناهنجاری</h2>
                <p className="mt-0.5 text-xs leading-5 text-ink-400">
                  {anomaly
                    ? "فعال — تله در حال شمارش کلیک‌ها است."
                    : "غیرفعال — همه‌چیز عادی است."}
                </p>
              </div>
            </div>
            {anomaly ? (
              <button
                type="button"
                className="btn btn-glass btn-sm"
                disabled={busy}
                onClick={() => void stopAnomaly()}
              >
                پایان حالت
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy || locked}
                onClick={() => void startAnomaly()}
              >
                فعال‌سازی
              </button>
            )}
          </div>

          {anomaly ? (
            <div className="mt-4 rounded-2xl bg-amber-500/[0.06] p-4">
              <div className="flex items-center justify-between text-xs text-ink-300">
                <span>کلیک‌های شمارش‌شده</span>
                <span className="text-base font-extrabold text-amber-300">
                  {faDigits(anomaly.clicks)}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-ink-500">
                قفل صفحه بین کلیک {faDigits(ANOMALY_MIN_CLICKS)} تا{" "}
                {faDigits(ANOMALY_MAX_CLICKS)} (به‌صورت تصادفی) فعال می‌شود؛ کش
                برنامه تا پایان این حالت غیرفعال است و با پایان آن، وضعیت قبلی
                کش خودکار برمی‌گردد. این صفحه هنگام فعال‌سازی بسته می‌شود و بعد
                از آن فقط با ترکیب کلید مخفی دوباره باز می‌شود.
              </p>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl bg-white/[0.04] p-4 text-[11px] leading-6 text-ink-400">
              با فعال‌سازی، این صفحه بسته و صفحه اصلی باز می‌شود؛ همه‌چیز کاملاً
              طبیعی به نظر می‌رسد، اما پس از {faDigits(ANOMALY_MIN_CLICKS)} تا{" "}
              {faDigits(ANOMALY_MAX_CLICKS)} کلیک، صفحه به‌دلیل «تشخیص الگوریتمِ
              به‌خطرافتادن مدارک» قفل شده و رمز عبور می‌خواهد. کش برنامه نیز تا
              پایان حالت، خودکار غیرفعال می‌شود.
            </p>
          )}
        </section>

        <p className="pb-4 text-center text-[11px] text-ink-600">
          دسترسی به این صفحه فقط با نگه‌داشتن Ctrl+Alt+Shift و تایپ شماره مخفی
          به‌ترتیب ممکن است.
        </p>
      </div>
    </div>
  );
}
