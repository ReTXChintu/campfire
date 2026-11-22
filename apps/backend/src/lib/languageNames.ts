import type { StreamTrack } from "./drive";

// MKV rips commonly tag every stream's "title" with the release/site name (e.g. the source
// filename fragment), which is useless for telling tracks apart — language is the actually
// meaningful signal, so it's preferred over title, converted to a real name rather than a raw
// ISO 639-2 code. This covers languages this user's library actually has; Intl.DisplayNames
// (which understands many 3-letter codes too) is the fallback for anything not in the map.
const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English", hin: "Hindi", tam: "Tamil", tel: "Telugu", mal: "Malayalam",
  kan: "Kannada", ben: "Bengali", mar: "Marathi", guj: "Gujarati", pan: "Punjabi",
  urd: "Urdu", spa: "Spanish", fre: "French", fra: "French", ger: "German", deu: "German",
  ita: "Italian", jpn: "Japanese", kor: "Korean", chi: "Chinese", zho: "Chinese",
  rus: "Russian", ara: "Arabic", por: "Portuguese", tur: "Turkish", tha: "Thai",
  vie: "Vietnamese", ind: "Indonesian", und: "Unknown",
};

let displayNames: Intl.DisplayNames | null = null;
try {
  displayNames = new Intl.DisplayNames(["en"], { type: "language" });
} catch {
  displayNames = null;
}

export function languageName(code: string): string | null {
  const lower = code.toLowerCase();
  if (LANGUAGE_NAMES[lower]) return LANGUAGE_NAMES[lower];
  try {
    const name = displayNames?.of(lower);
    // Intl.DisplayNames echoes back unrecognized codes unchanged — treat that as "no match".
    return name && name.toLowerCase() !== lower ? name : null;
  } catch {
    return null;
  }
}

// Files tag the same language several ways: ISO 639-1 ("hi"), 639-2/B ("fre", "ger", "chi") or
// 639-2/T ("fra", "deu", "zho"). Everything that compares languages — a viewer's preference
// against a file's tracks, one episode's tracks against the next — goes through one canonical
// 3-letter code, so "en" and "eng" are the same language.
const TO_CANONICAL: Record<string, string> = {
  en: "eng", hi: "hin", ta: "tam", te: "tel", ml: "mal", kn: "kan", bn: "ben", mr: "mar",
  gu: "guj", pa: "pan", ur: "urd", or: "ori", as: "asm", es: "spa", fr: "fra", fre: "fra",
  de: "deu", ger: "deu", it: "ita", ja: "jpn", ko: "kor", zh: "zho", chi: "zho", ru: "rus",
  ar: "ara", pt: "por", tr: "tur", th: "tha", vi: "vie", id: "ind", ms: "msa", may: "msa",
  nl: "nld", dut: "nld", pl: "pol", sv: "swe", da: "dan", no: "nor", fi: "fin", el: "ell",
  gre: "ell", he: "heb", fa: "fas", per: "fas", uk: "ukr", cs: "ces", cze: "ces", ro: "ron",
  rum: "ron", hu: "hun", fil: "fil", tl: "tgl", si: "sin", ne: "nep",
};
const NO_LANGUAGE = new Set(["und", "unk", "zxx", "mis", "mul", "qaa", ""]);

/** One code per language ("en", "eng" → "eng"); null for "undetermined" or nothing at all. */
export function canonicalLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  const lower = code.trim().toLowerCase().split(/[-_]/)[0];
  if (NO_LANGUAGE.has(lower)) return null;
  return TO_CANONICAL[lower] ?? lower;
}

// Rips of Indian releases often leave the language tag "und" and write it in the track title
// instead ("Hindi DD+ 5.1", "Tamil - Original", "[Eng]"). Whole words only, so "English" inside a
// release group's name doesn't count twice and "ta" in "Atmos" never reads as Tamil.
const TITLE_WORDS: [RegExp, string][] = [
  [/\b(english|eng)\b/i, "eng"], [/\b(hindi|hin)\b/i, "hin"], [/\b(tamil|tam)\b/i, "tam"],
  [/\b(telugu|tel)\b/i, "tel"], [/\b(malayalam|mal)\b/i, "mal"], [/\b(kannada|kan)\b/i, "kan"],
  [/\b(bengali|bangla|ben)\b/i, "ben"], [/\b(marathi|mar)\b/i, "mar"], [/\b(gujarati|guj)\b/i, "guj"],
  [/\b(punjabi|pan)\b/i, "pan"], [/\burdu\b/i, "urd"], [/\b(japanese|jpn|jap)\b/i, "jpn"],
  [/\b(korean|kor)\b/i, "kor"], [/\b(spanish|spa|español|espanol)\b/i, "spa"], [/\b(french|fre|fra)\b/i, "fra"],
  [/\b(german|ger|deu)\b/i, "deu"], [/\b(chinese|mandarin|cantonese|chi|zho)\b/i, "zho"],
  [/\b(russian|rus)\b/i, "rus"], [/\b(arabic|ara)\b/i, "ara"], [/\b(portuguese|por)\b/i, "por"],
  [/\b(italian|ita)\b/i, "ita"], [/\b(turkish|tur)\b/i, "tur"], [/\b(thai)\b/i, "tha"],
];

/** The language a file's own tags say: the language tag, else a language named in the title. */
export function fileLanguage(language: string | null, title: string | null): string | null {
  const tagged = canonicalLanguage(language);
  if (tagged) return tagged;
  if (!title) return null;
  for (const [pattern, code] of TITLE_WORDS) if (pattern.test(title)) return code;
  return null;
}

export function trackLabel(track: StreamTrack): string {
  const language = track.language ? (languageName(track.language) ?? track.language) : null;
  const base = language ?? `Track ${track.index}`;
  return `${base} (${track.codecName.toUpperCase()})`;
}
