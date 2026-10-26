/** Layered ambient background: soft violet glows on a calm canvas. */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-ink-50 dark:bg-ink-950" />
      {/* ambient violet illumination */}
      <div className="absolute -top-48 -left-48 h-[560px] w-[560px] rounded-full bg-brand-400/25 blur-[130px] dark:bg-brand-500/12" />
      <div className="absolute top-1/4 -right-40 h-[460px] w-[460px] rounded-full bg-accent/18 blur-[120px] dark:bg-accent/10" />
      <div className="absolute bottom-[-160px] left-1/4 h-[420px] w-[420px] rounded-full bg-brand-300/16 blur-[110px] dark:bg-brand-400/8" />
      {/* hairline grid hint */}
      <div
        className="absolute inset-0 opacity-[0.5] dark:opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(99,91,255,0.07) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
    </div>
  );
}
