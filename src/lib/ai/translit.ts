/**
 * Latin → Persian (Dari) name transliteration — local fallback.
 *
 * The extraction prompt already instructs the model to return names in
 * Persian script. When a reply still comes back in Latin letters (weak
 * models reading the MRZ), the name is converted here: a dictionary of
 * frequent Afghan/Persian names first, then a phonetic longest-match
 * transliterator for everything else. Best-effort by design — the operator
 * can always fix the field afterwards.
 */

const PERSIAN_RE = /[\u0600-\u06FF]/;
const LATIN_RE = /[A-Za-z]/;

/** True when the string has Latin letters and no Persian letters. */
export function isLatinName(s: string): boolean {
  return LATIN_RE.test(s) && !PERSIAN_RE.test(s);
}

/** Whole-token dictionary — normalized uppercase Latin → Persian. */
const NAMES: Record<string, string> = {
  // ---- male given names -------------------------------------------------
  AHMAD: "احمد", AHMADULLAH: "احمدالله", MOHAMMAD: "محمد", MUHAMMAD: "محمد",
  MOHAMMADULLAH: "محمدالله", MAHMOOD: "محمود", MAHMOUD: "محمود", MEHDI: "مهدی",
  MAHDI: "مهدی", ALI: "علی", HAMID: "حمید", ABDULLAH: "عبدالله",
  ABDOLLAH: "عبدالله", ABDULRAHMAN: "عبدالرحمن", ABDURRAHMAN: "عبدالرحمن",
  ABDULRAHIM: "عبدالرحیم", ABDULKARIM: "عبدالکریم", ABDULSALAM: "عبدالسلام",
  ABDULGHANI: "عبدالغنی", ABDULHAQ: "عبدالحق", ABDULWAHID: "عبدالوحید",
  ABDULSAMAD: "عبدالصمد", ABDULMALEK: "عبدالمالک", ABDULQAYUM: "عبدالقیوم",
  ABDULSADIQ: "عبدالصادق", ABDULHAMID: "عبدالحمید", ABDULJABBAR: "عبدالجبار",
  EMRAN: "عمران", IMRAN: "عمران", ZABIHULLAH: "ذبیح‌الله",
  NASRULLAH: "نصرالله", EHSANULLAH: "احسان‌الله", EHSAN: "احسان",
  SAIFULLAH: "سیف‌الله", SAMIULLAH: "سمیع‌الله", MATIULLAH: "متی‌الله",
  NOORULLAH: "نورالله", RAHIMULLAH: "رحیم‌الله", KHAIRULLAH: "خیرالله",
  FAZLULHAQ: "فضل‌الحق", JALALUDDIN: "جلال‌الدین", SHAMSUDDIN: "شمس‌الدین",
  NAJMUDDIN: "نجم‌الدین", QIAMUDDIN: "قیام‌الدین", RASOUL: "رسول",
  MOBARAK: "مبارک", MORTAZA: "مرتضا", MURTAZA: "مرتضا", MUHSIN: "محسن",
  MOHSEN: "محسن", MUKHLIS: "مخلص", MUNIR: "منیر", MUSA: "موسی", NABI: "نبی",
  NADIR: "نادر", NIAMATULLAH: "نعمت‌الله", NEAMATULLAH: "نعمت‌الله",
  NOOR: "نور", OBAYDULLAH: "عبیدالله", OBAIDULLAH: "عبیدالله",
  RAHIM: "رحیم", KARIM: "کریم", RAHMAN: "رحمان", GHULAM: "غلام",
  HABIB: "حبیب", HAIDAR: "حیدر", HALIM: "حلیم", HARON: "هارون",
  HARUN: "هارون", HIKMAT: "حکمت", HIKMATYAR: "حکمتیار", HOSSEIN: "حسین",
  HUSSEIN: "حسین", HUSSAIN: "حسین", HUSAIN: "حسین", IDREES: "ادریس",
  IDRIS: "ادریس", ILHAM: "الهام", ISMAIL: "اسماعیل", ISMAEL: "اسماعیل",
  JAVED: "جوید", JAWAD: "جواد", JAMAL: "جمال", JAMALUDDIN: "جمال‌الدین",
  TARIQ: "طارق", TAHIR: "طاهر", TAHER: "طاهر", YOUSUF: "یوسف",
  YUSUF: "یوسف", IBRAHIM: "ابراهیم", EBRAHIM: "ابراهیم", MUSTAFA: "مصطفی",
  SULTAN: "سلطان", AMIR: "امیر", ARIF: "عارف", AREF: "عارف", ASIF: "آصف",
  AZIZ: "عزیز", BASHIR: "بشیر", DAWOOD: "داود", DAUD: "داود",
  FARHAD: "فرهاد", FARID: "فرید", GHAZI: "غازی", HAKIM: "حکیم",
  IQBAL: "اقبال", KAMAL: "کمال", LATIF: "لطیف", MANSOUR: "منصور",
  MANSUR: "منصور", MASOOD: "مسعود", MASUD: "مسعود", MIRWAIS: "میرویس",
  NAJIB: "نجیب", NASIR: "ناصر", NAZIR: "نظیر", QUDRATULLAH: "قدرت‌الله",
  NAJIBULLAH: "نجیب‌الله", MOHIBULLAH: "محب‌الله",
  RAFIQ: "رفیق", RASHID: "رشید", ROHULLAH: "روح‌الله", RUHULLAH: "روح‌الله",
  SADIQ: "صادق", SALEH: "صالح", SALIM: "سلیم", SAYED: "سید",
  SHAHID: "شهید", SHAFIQ: "شفیق", SHER: "شیر", SOHAIL: "سهیل",
  SULAIMAN: "سلیمان", WAHID: "وحید", WAKIL: "وکیل", WALI: "ولی",
  ZABIH: "ذبیح", ZAHIR: "ظاهر", ZALMAI: "زلمی", ZIA: "ضیا",
  ZUBAIR: "زبیر", KHAN: "خان", GUL: "گل", JAN: "جان", SHAH: "شاه",
  BISMILLAH: "بسم‌الله", HAMDULLAH: "حمدالله", RAUF: "رؤوف",
  RAHMATULLAH: "رحمت‌الله", MUHABBAT: "محبت", ALEM: "عالم", TOFAN: "طوفان",
  ASAD: "اسد", MURAD: "مراد", SAFI: "صافی", DILAWAR: "دلاور",
  OMAR: "عمر", SAMAD: "صمد", ESA: "عیسی", EISA: "عیسی", YAHYA: "یحیی",
  ESMAT: "عصمت", FAZL: "فضل", ROUF: "رؤوف", SULTANMUHAMMAD: "سلطان‌محمد",
  MOHIUDDIN: "محی‌الدین", RIZWAN: "رضوان",
  SAADAT: "سعادت", BASIR: "بصیر", JAWED: "جوید", KHAIR: "خیر",
  WAHIDULLAH: "وحیدالله", YAMA: "یما", ZAKARIA: "ذکریا",
  // ---- female given names -----------------------------------------------
  FATIMA: "فاطمه", FATEMEH: "فاطمه", ZAHRA: "زهرا", ZOHRA: "زهره",
  MARIAM: "مریم", MARYAM: "مریم", NASRIN: "نسرین", NASREEN: "نسرین",
  NARGIS: "نرگس", GULALAI: "گلالی", GULNAR: "گلنار", GULSUM: "گلسم",
  GULSTOM: "گلستوم", GULZAR: "گلزار", HALIMA: "حلیمه", HASINA: "حسینه",
  JAMILA: "جمیله", KADIJA: "خدیجه", KHADIJA: "خدیجه", KHADIJEH: "خدیجه",
  LATIFA: "لطیفه", LAILA: "لیلا", LEILA: "لیلا", MALALAI: "ملالی",
  MARWA: "مروه", MEHRI: "مهری", MINA: "مینا", NADIA: "ندیا",
  NAJIBA: "نجیبه", NASIMA: "نسیمه", RABIA: "رابعه", RAHILA: "رحیله",
  ROQIA: "رقیه", RUQIA: "رقیه", SADAF: "صدف", SAHAR: "سحر",
  SALIMA: "سلیمه", SAMIRA: "سمیرا", SHAIMA: "شیما", SHAKILA: "شکیله",
  SHIRIN: "شیرین", SIDDIQA: "صدیقه", SOHAILA: "سهیلا", SURAIA: "ثریا",
  SORAYA: "ثریا", THURAYA: "ثریا", TAMANA: "تمنا", WAHIDA: "وحیده",
  YASMIN: "یاسمین", ZAINAB: "زینب", ZARGHOONA: "زرغونه",
  ZARGHUNA: "زرغونه", ZOLIKHA: "زلیخا", ZULEIKHA: "زلیخا",
  PARISA: "پریسا", PARWANA: "پروانه", FARZANA: "فرزانه",
  SHUKRIA: "شکریه", AFIFA: "عفیفه", AZIZA: "عزیزه", HOMIRA: "حمیرا",
  HUMEIRA: "حمیرا", SITARA: "ستاره", MARJAN: "مرجان", SHAFIQA: "شفیقه",
  NASEEM: "نسیم", BIBIGUL: "بی‌بی‌گل", ROQAYA: "رقیه", FAWZIA: "فوزیه",
  // ---- surnames ----------------------------------------------------------
  AHMADI: "احمدی", AHMADY: "احمدی", KARIMI: "کریمی", HOSSEINI: "حسینی",
  HUSSEINI: "حسینی", HUSSAINI: "حسینی", RAHIMI: "رحیمی", RAHMANI: "رحمانی",
  NOORI: "نوری", NURI: "نوری", SADAT: "سادات", HASHEMI: "هاشمی",
  HASHIMI: "هاشمی", MOHAMMADI: "محمدی", MUHAMMADI: "محمدی",
  ALIZAI: "علیزایی", YOUSUFI: "یوسفی", YUSUFI: "یوسفی",
  BARAKZAI: "بارکزایی", POPAL: "پوپل", POPALZAI: "پوپلزایی",
  ACHAKZAI: "اچکزایی", AMIRI: "امیری", ANSARI: "انصاری",
  ASHRAFI: "اشرفی", AYUBI: "ایوبی", AZIZI: "عزیزی", DOST: "دوست",
  DURRANI: "درانی", FAIZI: "فیضی", FARAHMAND: "فراهمند",
  FARHADI: "فرهادی", GHAFFARI: "غفاری", GHAFARI: "غفاری", GHANI: "غنی",
  GHIASI: "غیاثی", HAQANI: "حقانی", HAKKANI: "حقانی", HAIDARI: "حیدری",
  HALIMI: "حلیمی", HAMIDI: "حمیدی", HAKIMI: "حکیمی", HEMMAT: "همت",
  HERATI: "هراتی", HINDI: "هندی", IMRANI: "عمرانی", JALALI: "جلالی",
  KAKAR: "کاکر", KANDAHARI: "قندهاری", KHANZADA: "خان‌زاده",
  KOHISTANI: "کوهستانی", LATIFI: "لطیفی", LUDIN: "لدین",
  MAHMOUDI: "محمودی", MAJIDI: "مجیدی", MALIKZAI: "ملکزایی",
  MATIN: "متین", MOMAND: "مومند", MOHMAND: "مومند", MOUSAVI: "موسوی",
  MUSAWI: "موسوی", MUSAVI: "موسوی", NADERI: "نادری", NAJAFI: "نجفی",
  NASIRI: "ناصری", NAZARI: "نظری", NIAZI: "نیازی", NURZAI: "نورزایی",
  OMARI: "عمری", PARWANI: "پروانی", QADERI: "قادری", QASIMI: "قاسمی",
  RAJABI: "رجبی", RASOULI: "رسولی", REZAWI: "رضوی", RAZAWI: "رضوی",
  SABERI: "صابری", SADIQI: "صادقی", SAHAK: "سهاک", SAIDI: "سعیدی",
  SAJADI: "سجادی", SALEHI: "صالحی", SAMADI: "صمدی",
  SAMANGANI: "سمنگانی", SARABI: "سرابی", SARDAR: "سردار",
  SHERZAD: "شیرزاد", SHINWARI: "شینواری", SIDIQI: "صدیقی",
  SULTANI: "سلطانی", SUFI: "صوفی", TAHIRI: "طاهری", TARZI: "طرزی",
  WAHIDI: "وحیدی", WARDAG: "وردک", WAZIRI: "وزیری",
  YOUSUFZAI: "یوسفزایی", ZADRAN: "زدران", ZAFAR: "ظفر",
  ZAMANI: "زمانی", ZARIFI: "ظریفی", AMINI: "امینی", BARMAL: "برمال",
  JAHANI: "جهانی", NABIZADA: "نبی‌زاده", PANJSHIRI: "پنجشیری",
  QURAISHI: "قریشی", TAJIK: "تاجیک", URFANI: "عرفانی",
  AHMADZAI: "احمدزایی", ANDARABI: "اندرابی", KHOGYANI: "خوگیانی",
  MAIWANDI: "میوندی", SAQIB: "صاقب", AMARKHAIL: "امرخیل",
  MUSAZAI: "موسازایی", JANAT: "جنت", QANI: "قانی",
  HASSANI: "حسنی", RASHIDI: "رشیدی", YOUSOFI: "یوسفی",
  SULTANZADA: "سلطان‌زاده", RAHIMZAI: "رحیمزایی", KARIMZADA: "کریم‌زاده",
  HAQ: "حق", AZIMI: "عظیمی", BASHIRI: "بشیری",
  GHAFOORI: "غفوری", IBRAHIMI: "ابراهیمی",
  ISHAN: "ایشان", KARIMKHAIL: "کریم‌خیل", LALZAD: "لال‌زاد",
  MOHABBAT: "محبت", NAJIBZADA: "نجیب‌زاده", PAIMAN: "پیمان",
  RAMAZANI: "رمضانی", SANA: "ثنا", TAWHIDI: "توحیدی",
  WISA: "ویسا", ZALMAY: "زلمی",
};

/** Prefix that glues to the following word: ABDUL RAHMAN → عبدالرحمن. */
const JOIN_PREFIXES: Record<string, string> = {
  ABDUL: "عبدال",
  ABDOL: "عبدال",
  ABD: "عبدال",
  GUL: "گل",
  BIBI: "بی‌بی",
};

/** Whole phrases whose joined spelling differs from simple concatenation. */
const PHRASES: Record<string, string> = {
  "ABDUL RAHMAN": "عبدالرحمن",
  "ABDUR RAHMAN": "عبدالرحمن",
  "ABDUL RAHMANI": "عبدالرحمانی",
  "BIBI GUL": "بی‌بی‌گل",
};

/** Multi-letter phonemes, longest match first. */
const DIGRAPHS: Array<[string, string]> = [
  ["AA", "آ"],
  ["EE", "ی"],
  ["OO", "و"],
  ["OU", "و"],
  ["OW", "و"],
  ["AU", "و"],
  ["AY", "ای"],
  ["AI", "ای"],
  ["EI", "ای"],
  ["OI", "وی"],
  ["OY", "وی"],
  ["KH", "خ"],
  ["GH", "غ"],
  ["SH", "ش"],
  ["CH", "چ"],
  ["ZH", "ژ"],
  ["TH", "ث"],
  ["PH", "ف"],
  ["CK", "ک"],
];

const CONSONANTS: Record<string, string> = {
  B: "ب", C: "ک", D: "د", F: "ف", G: "گ", H: "ه", J: "ج", K: "ک",
  L: "ل", M: "م", N: "ن", P: "پ", Q: "ق", R: "ر", S: "س", T: "ت",
  V: "و", W: "و", X: "خ", Y: "ی", Z: "ز",
};

const INITIAL_VOWELS: Record<string, string> = { A: "ا", E: "ا", I: "ا", O: "ع", U: "ا" };
const MEDIAL_VOWELS: Record<string, string> = { A: "", E: "", I: "ی", O: "", U: "" };
const FINAL_VOWELS: Record<string, string> = { A: "ا", E: "ه", I: "ی", O: "و", U: "و" };

const VOWELS = new Set(["A", "E", "I", "O", "U"]);

/** Best-effort phonetic transliteration of one uppercase Latin token. */
function phoneticWord(word: string): string {
  // Collapse doubled letters (MM → M) — MRZ style padding.
  let t = word.replace(/(.)\1+/g, "$1");
  let out = "";
  let i = 0;
  while (i < t.length) {
    const rest = t.slice(i);
    // 1) digraphs
    const dig = DIGRAPHS.find(([k]) => rest.startsWith(k));
    if (dig) {
      out += dig[1];
      i += dig[0].length;
      continue;
    }
    const ch = rest[0];
    const isVowel = VOWELS.has(ch);
    if (isVowel) {
      if (i === 0) {
        out += INITIAL_VOWELS[ch] ?? ch;
      } else if (i === t.length - 1) {
        out += FINAL_VOWELS[ch] ?? ch;
      } else if (
        ch === "A" &&
        i + 2 === t.length &&
        !VOWELS.has(t[i + 1])
      ) {
        // A + one consonant + end → long â (خان، جان، رحمان، سلطان)
        out += "ا";
      } else {
        out += MEDIAL_VOWELS[ch] ?? "";
      }
      i += 1;
      continue;
    }
    out += CONSONANTS[ch] ?? ch;
    i += 1;
  }
  return out || word;
}

function transliterateToken(token: string): string {
  const norm = token.toUpperCase().replace(/[’'`´]/g, "");
  if (!norm) return token;
  return NAMES[norm] ?? phoneticWord(norm);
}

/**
 * Convert a Latin-script person name to Persian. Multi-word names are
 * transliterated word by word; ABDUL-style prefixes glue to the next word.
 * Strings that already contain Persian letters are returned untouched.
 */
export function latinToPersianName(input: string): string {
  const cleaned = input
    .replace(/<+/g, " ") // MRZ fill characters
    .replace(/[’'`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return input.trim();
  if (!isLatinName(cleaned)) return cleaned;

  // Whole-phrase dictionary first (joined spellings).
  const phrase = PHRASES[cleaned.toUpperCase()];
  if (phrase) return phrase;

  const words = cleaned.split(/[\s-]+/).filter(Boolean);
  const parts: string[] = [];
  let i = 0;
  while (i < words.length) {
    const up = words[i].toUpperCase();
    const joiner = JOIN_PREFIXES[up];
    if (joiner && i + 1 < words.length && (up === "ABDUL" || up === "ABDOL" || up === "ABD")) {
      parts.push(joiner + transliterateToken(words[i + 1]));
      i += 2;
    } else if (joiner && i + 1 < words.length) {
      // GUL MOHAMMAD → گل‌محمد style, joined with ZWNJ
      parts.push(joiner + "‌" + transliterateToken(words[i + 1]));
      i += 2;
    } else {
      parts.push(transliterateToken(words[i]));
      i += 1;
    }
  }
  return parts.join(" ").trim();
}
