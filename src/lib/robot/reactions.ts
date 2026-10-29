/**
 * Robot Companion — the reaction engine (سرگرمی!).
 *
 * Decides WHICH short, fun Persian line (if any) the robot shows in its
 * bubble for a given app event. The animation state itself is owned by
 * `stateForEvent`; this module is purely the personality layer.
 *
 * Anti-repetition algorithm ("کارهاش تکراری باشه" was the complaint):
 *  - Every pool draws through a per-key shuffle bag: a line can only come
 *    back after the WHOLE pool has been used up.
 *  - On refill, the line that was just shown is excluded once, so the same
 *    sentence never appears twice in a row — even across bag refills.
 *  - Most events show a line only with a probability gate, so the robot is
 *    lively but never chatty: sometimes it just animates and says nothing.
 *  - Page-specific and query-aware variants keep the reactions tied to what
 *    the user is ACTUALLY doing right now.
 *
 * These lines are scripted UI feedback from the companion character — they
 * are never presented as AI answers (the robot no longer has a chat).
 */

import type { RobotAppEvent } from "./types";

export interface RobotReaction {
  /** Short fun line for the bubble (undefined = stay silent). */
  line?: string;
  /** How long the bubble stays on screen. */
  ms?: number;
}

export interface ReactionEngine {
  react(event: RobotAppEvent): RobotReaction;
  /** Direct tap on the robot — always answers. */
  tap(): RobotReaction;
}

/* --------------------------------- pools ---------------------------------- */

/**
 * The pre-defined phrase DICTIONARY (دیکشنری جمله‌ها).
 *
 * Doubles as: (1) the local fallback lines the robot reads when the main AI
 * is unavailable, and (2) the CHARACTER SHEET handed to the main AI — the
 * model learns the robot's tone from these pools but must produce fresh
 * lines (see aiLines.ts).
 */
export const ROBOT_DICTIONARY = {
  nav: [
    "یک بخش دیگه، یک ماجرای دیگه!",
    "بریم ببینیم این‌جا چی‌داریم!",
    "میشه گفت دنبال چیزی هستی…",
    "این‌جا هم قشنگه!",
    "بازم خودتی!",
  ],
  navDashboard: [
    "بریم ببینیم امروز چی‌پاشته!",
    "نمای کلی — من این صفحه را دوست دارم!",
  ],
  navAccounting: [
    "حسابداری! پول‌ها حواسشون جمع باشه…",
    "درآمد و خرج — من سبک‌تان می‌کنم!",
  ],
  navBackup: ["پشتیبان‌گیری — کارِ عاقلانه‌ای است!", "نسخهٔ پشتیبان؛ خوابِ راحت!"],
  navSettings: ["تنظیمات! منم یه‌دور می‌زنم ببینم چی‌شد.", "بچرخان هر جور دوست داری!"],
  navReports: ["گزارش‌ها! آماده‌ست؟ ببینیم!", "عدد و رقم — حالِ خوبِ من!"],
  navSmartArchive: ["بایگانی هوشمند — اسمش به‌تنهایی خفنه!", "آرشیوِ خودکار؛ دلم برات تنگ شده بود!"],
  saveDone: [
    "ایول! ثبت شد.",
    "برفت تو دیتابیس!",
    "یکی دیگه اضافه شد — دیتاها دارن زیاد میشن!",
    "ثبت شد؛ خدا رو شکر!",
    "تموم! بدون حتی یک خطا.",
  ],
  saveError: [
    "اوه! یک جای کار می‌لنگه…",
    "این‌بار نشد؛ عصبانی نباش!",
    "خطا! یه‌بار دیگه امتحان کن.",
    "منم تعجب کردم؛ ولی جبران میشه!",
  ],
  exportDone: [
    "فایل رفت پی Downloads — دلم می‌خواست خودم بردم!",
    "خروجی گرفتم؛ مثل آب از صافی!",
    "دانلود شد؛ مرتب و خوشگل!",
    "یک فایل دیگر آماده — آرشیوت داره قشنگ میشه!",
  ],
  importDone: [
    "همه‌چی برگشت سر جاش — نفس راحت!",
    "بازیابی شد؛ دیتاها خوشحالن!",
    "پشتیبان باز شد؛ مثل قدیمها شد!",
  ],
  reportDone: [
    "گزارش آماده شد — منم توش خوشگل شدم!",
    "آمار و عدد؛ حالِ خوبِ من!",
    "گزارش درست شد؛ بری ببینم؟",
  ],
  search: [
    "دنبال چیزی می‌گردی؟ چشم‌هام روشنه!",
    "جستجو؟ منم کنجکاوم ببینم چی پیدا میشه!",
    "بگرد ببین؛ من همین‌جا منتظرم!",
  ],
  searchQuery: [
    "«{q}»؟ بگردیم!",
    "به دنبال «{q}» هستیم — ان‌شاءالله پیداش میکنیم!",
    "«{q}»… اسم آشنا‌ای داره!",
  ],
  themeDark: ["چراغ‌ها خاموش — حال و هوای دیگه‌ای داره!", "تاریک شد؛ من این‌جا می‌خوابم… شوخی کردم!"],
  themeLight: ["روشن شد! انرژی برگشت.", "سلام آفتاب!"],
  layoutOut: [
    "ای‌ول، بیرون کشیدی! حالا گرد شد!",
    "بردی بیرون — مثل حسابداری شد!",
    "چیدمان دستِ خودته!",
    "هر جا دلت خواست؛ منم همین را می‌خواستم!",
  ],
  layoutIn: ["برگشت سر جاشش!", "دوباره تو خونه — چه نظمی!", "این‌جا هم خوبه!"],
  layoutMove: ["اینجا بهتره؛ حق با توئه!", "جابه‌جا شد — چیدمانِ خودتی!", "همین‌جوری نگه‌ش دار!"],
  tap: [
    "وای! غافلگیری کردی!",
    "هی! من این‌جام!",
    "بازم منو بیدار کردی!",
    "پریدم! دیدی؟",
    "شادی از ته دل!",
    "بازم بیا؛ خوشم میاد!",
  ],
  sleep: ["خخخ… چشم‌هام دارن بسته میشن…", "یه چرت کوتاه؛ جای من رو گرم کن!"],
  wake: ["هااا… بیدارم بیدارم!", "آخ! خواب خوبی بود!"],
} as const;

/** Persian labels for every pool — how the AI sees the dictionary. */
export const ROBOT_DICTIONARY_LABELS: Record<PoolKey, string> = {
  nav: "رفتن به صفحهٔ تازه",
  navDashboard: "رفتن به داشبورد",
  navAccounting: "رفتن به حسابداری",
  navBackup: "رفتن به پشتیبان‌گیری",
  navSettings: "رفتن به تنظیمات",
  navReports: "رفتن به گزارش‌ها",
  navSmartArchive: "رفتن به بایگانی هوشمند",
  saveDone: "ثبت موفق",
  saveError: "خطا در ثبت",
  exportDone: "خروجی موفق",
  importDone: "بازیابی موفق",
  reportDone: "گزارش ساخته شد",
  search: "جستجو",
  searchQuery: "جستجوی یک عبارت خاص",
  themeDark: "روشن‌کردن حالت تاریک",
  themeLight: "برگشتن به حالت روشن",
  layoutOut: "بیرون‌کشیدن دکمه",
  layoutIn: "جاگذاری دکمه",
  layoutMove: "جابه‌جایی دکمه",
  tap: "ضربه‌زدن کاربر به ربات",
  sleep: "خوابیدن ربات",
  wake: "بیدار شدن ربات",
};

type PoolKey = keyof typeof ROBOT_DICTIONARY;

/* ------------------------------ helpers ----------------------------------- */

/** Injectable RNG (tests pass a seeded one). */
type Rng = () => number;

/**
 * A shuffle bag: draws every item once (in random order) before refilling.
 * The last drawn item is held out of the NEXT cycle so a line never repeats
 * back-to-back.
 */
class ShuffleBag {
  private bag: string[] = [];
  private last: string | null = null;
  constructor(
    private readonly pool: readonly string[],
    private readonly rng: Rng,
  ) {}
  draw(): string {
    if (this.pool.length === 0) return "";
    if (this.bag.length === 0) {
      this.bag = [...this.pool];
      // never start a new cycle with the sentence we just showed
      if (this.last != null && this.bag.length > 1) {
        const i = this.bag.indexOf(this.last);
        if (i >= 0) this.bag.splice(i, 1);
      }
    }
    const i = Math.floor(this.rng() * this.bag.length);
    const item = this.bag.splice(i, 1)[0] ?? this.pool[0];
    this.last = item;
    return item;
  }
}

function fill(tpl: string, q: string): string {
  return tpl.replaceAll("{q}", q);
}

/* ------------------------------- the engine -------------------------------- */

export function createReactionEngine(rng: Rng = Math.random): ReactionEngine {
  const bags = new Map<PoolKey, ShuffleBag>();
  const draw = (key: PoolKey): string => {
    let bag = bags.get(key);
    if (!bag) {
      bag = new ShuffleBag(ROBOT_DICTIONARY[key], rng);
      bags.set(key, bag);
    }
    return bag.draw();
  };
  /** Gate: true = speak this time. */
  const maybe = (p: number): boolean => rng() < p;

  const react = (event: RobotAppEvent): RobotReaction => {
    switch (event.type) {
      case "nav:change": {
        if (!maybe(0.5)) return {};
        const to = event.to ?? "";
        if (to === "/") return { line: draw("navDashboard"), ms: 5200 };
        if (to.startsWith("/accounting")) return { line: draw("navAccounting"), ms: 5200 };
        if (to.startsWith("/backup")) return { line: draw("navBackup"), ms: 5200 };
        if (to.startsWith("/settings")) return { line: draw("navSettings"), ms: 5200 };
        if (to.startsWith("/reports")) return { line: draw("navReports"), ms: 5200 };
        if (to.startsWith("/smart-archive")) return { line: draw("navSmartArchive"), ms: 5200 };
        return { line: draw("nav"), ms: 5200 };
      }
      case "app:save_success":
      case "app:upload_done":
        return maybe(0.6) ? { line: draw("saveDone"), ms: 4800 } : {};
      case "app:export_done":
        return maybe(0.7) ? { line: draw("exportDone"), ms: 5000 } : {};
      case "app:import_done":
        return maybe(0.75) ? { line: draw("importDone"), ms: 5200 } : {};
      case "app:report_generated":
        return maybe(0.75) ? { line: draw("reportDone"), ms: 5200 } : {};
      case "app:save_error":
      case "app:upload_error":
      case "app:export_error":
      case "app:import_error":
        return maybe(0.8) ? { line: draw("saveError"), ms: 5200 } : {};
      case "app:search": {
        if (!maybe(0.6)) return {};
        const q = (event.query ?? "").trim();
        if (q.length > 0 && maybe(0.45)) {
          return { line: fill(draw("searchQuery"), q.slice(0, 24)), ms: 5600 };
        }
        return { line: draw("search"), ms: 5200 };
      }
      case "app:theme_toggle":
        return maybe(0.8) ? { line: draw(event.dark ? "themeDark" : "themeLight"), ms: 5200 } : {};
      case "app:layout_change": {
        const label = event.label ? ` (${event.label})` : "";
        if (event.what === "pin_out") {
          return maybe(0.85) ? { line: draw("layoutOut") + label, ms: 5600 } : {};
        }
        if (event.what === "pin_in") {
          return maybe(0.7) ? { line: draw("layoutIn") + label, ms: 5000 } : {};
        }
        return maybe(0.6) ? { line: draw("layoutMove") + label, ms: 5000 } : {};
      }
      case "user:idle":
        return maybe(0.22) ? { line: draw("sleep"), ms: 7000 } : {};
      case "user:active":
        return maybe(0.16) ? { line: draw("wake"), ms: 4200 } : {};
      default:
        return {};
    }
  };

  return {
    react,
    tap: () => ({ line: draw("tap"), ms: 4200 }),
  };
}

/** App-wide singleton (kept alive for the whole session so bags persist). */
export const robotReactions: ReactionEngine = createReactionEngine();
