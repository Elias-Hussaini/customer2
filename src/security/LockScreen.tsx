import { useEffect, useRef, useState } from "react";
import { Lock, ShieldAlert } from "lucide-react";
import {
  useSecurityState,
  tryUnlock,
  type UnlockResult,
} from "./securityStore";

/**
 * «صفحه قفل» — the anomaly trap's lock screen.
 *
 * A full-screen, opaque, non-dismissable overlay (no Escape, no backdrop
 * click, no route escape) that demands the owner password after the anomaly
 * algorithm trips. The input is the ONLY focusable element on the page; Tab,
 * background clicks and window refocus all land back on it.
 */

const COOLDOWN_POLL_MS = 500; // tick the cooldown clock twice a second

export function LockScreen() {
  const locked = useSecurityState((s) => s.locked);
  const cooldownUntil = useSecurityState((s) => s.cooldownUntil);
  const failedAttempts = useSecurityState((s) => s.failedAttempts);

  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "wrong" | "ok" | "cooldown">("idle");
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [now, setNow] = useState(Date.now());

  const cooldownLeft = Math.max(0, cooldownUntil - now);
  const inCooldown = cooldownLeft > 0;

  // Keep the cooldown clock ticking while locked.
  useEffect(() => {
    if (!locked) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), COOLDOWN_POLL_MS);
    return () => window.clearInterval(t);
  }, [locked]);

  // Lock-in: steal focus, blur the page behind, and trap ALL focus + keys so
  // the locked page can't be operated behind the overlay.
  useEffect(() => {
    if (!locked) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    inputRef.current?.focus();

    const trap = (e: KeyboardEvent) => {
      // Escape must not close anything behind the lock.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Tab / Shift+Tab stay on the password field.
      if (e.key === "Tab") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      // Block app hotkey combos (Ctrl+S / Ctrl+R / Ctrl+P…) behind the lock.
      if ((e.ctrlKey || e.metaKey) && ["s", "r", "p"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // Capture phase beats every app listener.
    window.addEventListener("keydown", trap, true);
    const refocus = () => {
      // Anything outside the input (background button focused programmatically)
      // immediately hands focus back to the lock.
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    };
    document.addEventListener("focusin", refocus, true);
    window.addEventListener("focus", refocus);
    return () => {
      window.removeEventListener("keydown", trap, true);
      document.removeEventListener("focusin", refocus, true);
      window.removeEventListener("focus", refocus);
    };
  }, [locked]);

  // Stay mounted while the success confirmation plays: the store unlocks
  // (locked=false) the moment the password is accepted, but the overlay must
  // keep covering the app until the clean reload — never flash the unlocked
  // app for the 650 ms between accept and reload.
  if (!locked && status !== "ok") return null;

  const submit = async () => {
    if (!password.trim() || status === "checking" || status === "ok" || inCooldown) return;
    setStatus("checking");
    setAttemptsLeft(null);
    const result: UnlockResult = await tryUnlock(password);
    if (result === "ok") {
      // NOTE: tryUnlock already disarmed the store (locked=false above), but
      // this overlay stays (status === "ok") for the confirmation + reload.
      setStatus("ok");
      setPassword("");
      // Brief confirmation, then a clean reload re-registers the service
      // worker when the cache was restored by the unlock.
      window.setTimeout(() => window.location.reload(), 650);
      return;
    }
    if (result === "cooldown") {
      setStatus("cooldown");
      setNow(Date.now());
      setShakeKey((k) => k + 1);
      return;
    }
    setStatus("wrong");
    setAttemptsLeft(Math.max(0, 4 - (failedAttempts % 5)));
    setShakeKey((k) => k + 1);
    setPassword("");
    inputRef.current?.focus();
  };

  return (
    <div
      className="no-print anim-fade fixed inset-0 z-[95] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="صفحه قفل شده است"
      dir="rtl"
      onPointerDown={(e) => {
        // Any click anywhere brings focus back to the password field.
        if (e.target === e.currentTarget) inputRef.current?.focus();
      }}
    >
      {/* OPAQUE background — nothing of the app may be visible or readable. */}
      <div className="absolute inset-0 bg-[#0d0f1a]" />
      <div className="absolute inset-0 opacity-[0.06]">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand-500 blur-[120px]" />
        <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-[#8b5cf6] blur-[120px]" />
      </div>

      <div key={shakeKey} className="anim-shake relative w-full max-w-sm">
        <div className="rounded-3xl border border-white/10 bg-[#151a2e]/95 p-7 text-right shadow-2xl">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ef4444]/15 text-[#f87171]">
            <ShieldAlert size={28} />
          </div>

          <h2 className="text-lg font-extrabold text-white">دسترسی قفل شد</h2>
          <p className="mt-2.5 text-[13px] leading-6 text-ink-300">
            الگوریتم امنیتی، فعالیت غیرعادی تشخیص داد و برای جلوگیری از به‌خطر
            افتادن مدارک، صفحه قفل شد.
          </p>
          <p className="mt-1 text-[13px] leading-6 text-ink-300">
            لطفاً رمز عبور را وارد کنید.
          </p>

          <div className="mt-5 flex flex-col gap-2">
            <input
              ref={inputRef}
              type="password"
              dir="ltr"
              className="field w-full text-center tracking-widest placeholder:tracking-normal placeholder:text-ink-500"
              style={{
                background: "#0d0f1a",
                borderColor: status === "wrong" ? "#ef4444" : undefined,
                color: "#fff",
              }}
              placeholder="رمز عبور"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              disabled={inCooldown || status === "ok"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (status === "wrong" || status === "cooldown") setStatus("idle");
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />

            {status === "wrong" && (
              <p className="text-xs text-[#f87171]">
                رمز عبور نادرست است
                {attemptsLeft !== null && attemptsLeft > 0
                  ? ` — ${faDigits(attemptsLeft)} تلاش دیگر تا قفل موقت`
                  : ""}
              </p>
            )}
            {inCooldown && (
              <p className="text-xs text-[#fbbf24]">
                به‌دلیل تلاش‌های ناموفق، {faDigits(Math.ceil(cooldownLeft / 1000))} ثانیه صبر کنید.
              </p>
            )}
            {status === "ok" && (
              <p className="text-xs text-[#34d399]">رمز صحیح — بازگردانی دسترسی…</p>
            )}

            <button
              type="button"
              className="btn btn-primary mt-1 w-full"
              disabled={!password.trim() || status === "checking" || status === "ok" || inCooldown}
              onClick={() => void submit()}
            >
              {status === "checking" ? "در حال بررسی…" : status === "ok" ? "باز شد" : "بازکردن قفل"}
            </button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-ink-500">
            <Lock size={12} />
            <span>حالت محافظت مدارک فعال است</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Persian digits helper. */
function faDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}
