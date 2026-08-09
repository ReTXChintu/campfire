import type { StreamTrack } from "@/lib/drive";

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

export function trackLabel(track: StreamTrack): string {
  const language = track.language ? (languageName(track.language) ?? track.language) : null;
  const base = language ?? `Track ${track.index}`;
  return `${base} (${track.codecName.toUpperCase()})`;
}
