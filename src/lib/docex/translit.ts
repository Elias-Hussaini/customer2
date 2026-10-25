/**
 * Latin ↔ Persian transliteration for names — deterministic, dictionary-first.
 *
 * MRZ names are Latin (ICAO transliteration). Customer records are Persian.
 * A pure letter-by-letter map produces wrong results ("AHMADI" → "اهمادی"),
 * so common Afghan/Persian name tokens are handled by a curated dictionary
 * first; unknown tokens fall back to letter mapping. Result is always shown
 * for human review — never saved blindly.
 */

/** Common name tokens (Latin → Persian), longest first for greedy matching. */
const NAME_TOKENS: Record<string, string> = {
  // Male given names
  MOHAMMAD: "محمد", MOHAMMED: "محمد", MUHAMMAD: "محمد", MAHMOOD: "محمود",
  MAHMOUD: "محمود", AHMAD: "احمد", AHMED: "احمد", ABDUL: "عبدال",
  ABDULLAH: "عبدالله", ABDULAH: "عبدالله", GHULAM: "غلام", GULAM: "غلام",
  NOOR: "نور", NUR: "نور", NOORMOHAMMAD: "نورمحمد", ALI: "علی",
  HUSAIN: "حسین", HUSSAIN: "حسین", HOSSEIN: "حسین", HUSSEIN: "حسین",
  HUSSEINI: "حسینی", HUSAINI: "حسینی", HUSSEINY: "حسینی", HUSAINY: "حسینی", HOSSEINY: "حسینی",
  HASAN: "حسن", HASANALI: "حسن‌علی", RASUL: "رسول", RASOOL: "رسول",
  ESMATULLAH: "عزت‌الله", AZIM: "عظیم", NASRULLAH: "نصرالله",
  ZABIHULLAH: "ذبیح‌الله", SULTAN: "سلطان", JANALI: "جان‌علی",
  SHAH: "شاه", WALI: "ولی", MIR: "میر", KHAN: "خان",
  JAWAD: "جواد", JAVAD: "جواد", YOUSUF: "یوسف", YUSUF: "یوسف",
  IBRAHIM: "ابراهیم", EBRAM: "ابراهیم", ISMAIL: "اسماعیل", ESMAIL: "اسماعیل",
  REZA: "رضا", HADI: "هادی", MAJID: "مجید", HAMID: "حمید",
  JAMAL: "جمال", KAMAL: "کمال", NASIR: "نصیر", SAMIM: "سمیم",
  ABDULQAYUM: "عبدالقیوم", ABDULHAQ: "عبدالحق", ABDULRAHMAN: "عبدالرحمن",
  ABDULGHAFAR: "عبدالغفار", ABDULJALIL: "عبدالجلیل", ABDULMAJEED: "عبدالمجید",
  SADEQ: "صادق", SADIQ: "صادق", NAJIBULLAH: "نجیب‌الله", HABIBULLAH: "حبیب‌الله",
  FARHAD: "فرهاد", NAZIR: "نذیر", MAHFUZ: "محفوظ", SHAFIQ: "شفیق",
  ABDULSAMAD: "عبدالصمد", MOHIBULLAH: "محب‌الله", AMRULLAH: "امرالله",
  MAQSOOD: "مقصود", MAQSUD: "مقصود", FAZL: "فضل", FAZAL: "فضل",
  GHAFAR: "غفار", GHAFOOR: "غفور", JALAL: "جلال", TOFAN: "طوفان",
  ZIA: "ضیا", ZIALLAH: "ضیاالله", DAWOOD: "داوود", DAWUD: "داوود",
  QUDRATULLAH: "قدرت‌الله", SIBGHATULLAH: "صبغت‌الله", ANWAR: "انور",
  AKBAR: "اکبر", ASADULLAH: "اسدالله", MOHSEN: "محسن", MOSHEN: "محسن",
  ROHULLAH: "روح‌الله", SEYED: "سید", SAYED: "سید", SYED: "سید",
  // Female given names
  MARIAM: "مریم", MARYAM: "مریم", ZAHRA: "زهرا", FATIMA: "فاطمه",
  FATIMAHAJERA: "فاطمه حاجره", NARGIS: "نرگس", LAILA: "لیلا", LEILA: "لیلا",
  SARA: "سارا", ZAINAB: "زینب", BIBI: "بی‌بی", GULALAI: "گل‌الایی",
  SHAHNAWAZ: "شه‌نواز", NASREEN: "نسرین", NAZREEN: "نسرین", HALEEMA: "حلیمه",
  HALIMA: "حلیمه", RAIHANA: "ریحانه", ROQIA: "رقیه", RUQIA: "رقیه",
  ZARGHONA: "زرغونه", SHAHNAZ: "شه‌ناز", MAHJABIN: "محجبین",
  FARZANA: "فرزانه", SHUKRIA: "شکریه", JAMILA: "جمیله", NASIMA: "نسیمه",
  // Surnames
  AHMADI: "احمدی", HUSSAINI: "حسینی", HUSSAINY: "حسینی", HOSSEINI: "حسینی",
  MOHAMMADI: "محمدی", MOHAMMADIHZADA: "محمدی‌زاده", SADIQI: "صادقی",
  SADIQY: "صادقی", RASSOULI: "رسولی", RASOULI: "رسولی", KARIMI: "کریمی",
  RAHIMI: "رحیمی", RAHIMY: "رحیمی", JANATI: "جنتی", NADERI: "نادری",
  AMIRI: "امیری", HAKIMI: "حکیمی", HAKIMY: "حکیمی", QADERI: "قادری",
  SULTANI: "سلطانی", HASHIMI: "هاشمی", HASHIMY: "هاشمی", AZIZI: "عزیزی",
  NOORI: "نوری", NORY: "نوری", FAIZI: "فایزی", BARAKZAI: "بارکزی",
  POPAL: "پوپل", POPALZAI: "پوپلزی", ALOKOZAI: "الکوزی", STANIKZAI: "ستانکزی",
  YOUSOFI: "یوسفی", YUSUFI: "یوسفی", SULTANZADA: "سلطان‌زاده",
  HABIBI: "حبیبی", GHAFORI: "غفوری", ZAZAI: "زازی", MOMAND: "مومند",
  RAHMANZADA: "رحمان‌زاده", SALEHI: "صالحی", SALEHY: "صالحی", SOHEL: "سهیل",
  QURAISHI: "قریشی", NABI: "نبی", WAHIDI: "وحیدی", OMARI: "عمری",
  LATIFI: "لطیفی", SHERZAD: "شیرزاد", SHERZADA: "شیرزاده", GHAFFARI: "غفاری",
  MUSTAFA: "مصطفی", MUSTAFAVI: "مصطفوی", TAHIRI: "طاهری", ZADRAN: "زدران",
  KHOSTI: "خستی", WARDAK: "وردک", HOTAK: "هوتک", ACHAKZAI: "اچکزی",
  // Generic suffixes
  ZADA: "زاده", ZADEH: "زاده", KHAIL: "خیل", BAKHSH: "بخش",
  // — extended coverage: very common given names (IR / AF) —
  MEHDI: "مهدی", MAHDI: "مهدی", HASSAN: "حسن", GHASEM: "قاسم", QASIM: "قاسم",
  SULEMAN: "سلیمان", SOLEMAN: "سلیمان", YAQUB: "یعقوب", ELIAS: "الیاس",
  EMANULLAH: "امان‌الله", IMAN: "ایمان", BASHIR: "بشیر", LATIF: "لطیف",
  AREF: "عارف", OSMAN: "عثمان", USMAN: "عثمان", JUMA: "جمعه",
  GHULAMHOSSEIN: "غلامحسین", MOSA: "موسی", EESA: "عیسی", AYUB: "ایوب",
  SHAHBAZ: "شهباز", TAHIR: "طاهر", RAUF: "رؤوف", MANUCHER: "منوچهر",
  MORTAZA: "مرتضی", MURTAZA: "مرتضی", GHOLAMREZA: "غلامرضا",
  KHODADAD: "خداداد", NAZMUDDIN: "نظم‌الدین", SEYEDALI: "سیدعلی",
  FATEMEH: "فاطمه", KHADIJA: "خدیجه", ROYA: "رویا", PARISA: "پریسا",
  MAHSA: "مهسا", SHIRIN: "شیرین", MASUMEH: "معصومه",
  GULSUM: "گلسم", SAKINA: "سکینه", ZOLEIKHA: "زلیخا",
  // — extended coverage: common surnames (IR / AF) —
  MUSAVI: "موسوی", MOUSAVI: "موسوی", MUSAWI: "موسوی", JAFARI: "جعفری",
  JAFFARI: "جعفری", KAZEMI: "کاظمی", GHOLAMI: "غلامی", ABBASI: "عباسی",
  NAJAFI: "نجافی", MAHMOUDI: "محمودی", ESMAILI: "اسماعیلی", MASHHADI: "مشهدی",
  KHOSRAVI: "خسروی", TABATABAEI: "طباطبایی", TABATABAI: "طباطبایی",
  KARIMZADA: "کریم‌زاده", AFGHAN: "افغان", YAQUBI: "یعقوبی",
  SOBOUTI: "صبوتی", RAOUFI: "رئوفی", HAMDARD: "همدرد", MOHAQQEQ: "مححق",
  JAN: "جان", AGHA: "آقا", MIRZA: "میرزا",
};

/** Letter-by-letter fallback (only for tokens not in the dictionary). */
const LETTERS: Record<string, string> = {
  A: "ا", B: "ب", C: "چ", D: "د", E: "ی", F: "ف", G: "گ", H: "ه", I: "ی",
  J: "ج", K: "ک", L: "ل", M: "م", N: "ن", O: "و", P: "پ", Q: "ق", R: "ر",
  S: "س", T: "ت", U: "و", V: "و", W: "و", X: "کس", Y: "ی", Z: "ز",
  SH: "ش", CH: "چ", KH: "خ", GH: "غ", TH: "ت", ZH: "ژ", PH: "ف",
};

/** Transliterate one Latin token to Persian. */
export function latinTokenToFa(token: string): string {
  const t = token.toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return "";
  if (NAME_TOKENS[t]) return NAME_TOKENS[t];
  // Greedy digraphs first (SH, CH, KH, GH, ZH), then single letters.
  let out = "";
  let i = 0;
  while (i < t.length) {
    const two = t.slice(i, i + 2);
    if (LETTERS[two]) {
      out += LETTERS[two];
      i += 2;
      continue;
    }
    out += LETTERS[t[i]] ?? "";
    i += 1;
  }
  return out;
}

/** Transliterate a full Latin name ("NOOR MOHAMMAD" → "نور محمد"). */
export function latinNameToFa(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(latinTokenToFa)
    .filter(Boolean)
    .join(" ");
}

/** Persian → canonical Latin form for cross-matching (lossy but deterministic). */
const FA_TO_LATIN: Record<string, string> = {
  "آ": "A", "ا": "A", "ب": "B", "پ": "P", "ت": "T", "ث": "S", "ج": "J", "چ": "CH",
  "ح": "H", "خ": "KH", "د": "D", "ذ": "Z", "ر": "R", "ز": "Z", "ژ": "J",
  "س": "S", "ش": "SH", "ص": "S", "ض": "Z", "ط": "T", "ظ": "Z", "ع": "A",
  "غ": "GH", "ف": "F", "ق": "Q", "ک": "K", "گ": "G", "ل": "L", "م": "M",
  "ن": "N", "و": "V", "ه": "H", "ی": "Y",
};

export function faNameToLatinKey(name: string): string {
  const norm = (name ?? "")
    .replace(/[\u064A\u0649]/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/[\u0622\u0623\u0625]/g, "\u0627")
    .replace(/\u200C|\s+/g, "")
    .trim();
  let out = "";
  for (const c of norm) out += FA_TO_LATIN[c] ?? "";
  return out.toUpperCase();
}

export function latinNameToKey(name: string): string {
  return (name ?? "").toUpperCase().replace(/[^A-Z]/g, "");
}

/** Reverse map Persian token → Latin (dictionary tokens only). */
const FA_TO_LATIN_TOKEN: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [latin, fa] of Object.entries(NAME_TOKENS)) {
    if (!m.has(fa)) m.set(fa, latin);
  }
  return m;
})();

/** Consonant skeleton — vowels/semivowels stripped for loose comparison. */
function skeleton(latinKey: string): string {
  return latinKey.replace(/[AEIOUWHY]/g, "");
}

/**
 * Compare a Persian name against a Latin (MRZ) name.
 * Token-wise: dictionary-exact first (نور ↔ NOOR), then consonant skeletons
 * with Levenshtein ≤ 1 to absorb transliteration variants (و↔O/W/V).
 */
export function namesMatch(faName: string, latinName: string): boolean {
  const faTokens = faName.split(/[\s\u200C]+/).filter(Boolean);
  const laTokens = latinName.toUpperCase().split(/\s+/).filter(Boolean);
  if (!faTokens.length || !laTokens.length) return false;

  // Same number of tokens: require every token to match pairwise.
  if (faTokens.length === laTokens.length) {
    return faTokens.every((ft, i) => tokenMatch(ft, laTokens[i]));
  }
  // Different counts: each Persian token must match some Latin token and
  // vice versa must cover at least the shorter side minus one (compound names).
  const faOk = faTokens.every((ft) => laTokens.some((lt) => tokenMatch(ft, lt)));
  const laOk = laTokens.filter((lt) => faTokens.some((ft) => tokenMatch(ft, lt))).length >=
    Math.min(laTokens.length, faTokens.length) - 1;
  return faOk && laOk;
}

function tokenMatch(faToken: string, latinToken: string): boolean {
  const la = latinToken.toUpperCase().replace(/[^A-Z]/g, "");
  if (!la.length) return false;
  const dict = FA_TO_LATIN_TOKEN.get(faToken);
  if (dict === la) return true;
  const a = skeleton(faNameToLatinKey(faToken));
  const b = skeleton(la);
  if (!a.length || !b.length) return false;
  if (a === b) return true;
  return Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) <= 1;
}

/** Persian → Latin name transliteration (reverse dictionary + letter map). */
export function faNameToLatin(name: string): string {
  return (name ?? "")
    .split(/[\s\u200C]+/)
    .filter(Boolean)
    .map((tok) => FA_TO_LATIN_TOKEN.get(tok) ?? faNameToLatinKey(tok))
    .join(" ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}
