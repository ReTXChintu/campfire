import type { TitleLanguage, TitleLanguages } from "./types";

/** "Hindi, Tamil (some episodes)" — a language only part of a series has is marked as such, so a
 * viewer isn't promised Tamil on an episode that doesn't carry it. */
export function languageListLabel(list: TitleLanguage[], partialNote = "some episodes"): string {
  return list.map((l) => (l.partial ? `${l.name} (${partialNote})` : l.name)).join(", ");
}

/** False when there's nothing to say (not read yet, or no tracks at all), so callers can hide it. */
export function hasTitleLanguages(languages: TitleLanguages | null | undefined): languages is TitleLanguages {
  return !!languages && (languages.audio.length > 0 || languages.subtitles.length > 0);
}

/** The details-header facts for a title's languages, empty when there are none to list. */
export function languageFacts(
  languages: TitleLanguages | null | undefined,
  partialNote?: string,
): { label: string; value: string }[] {
  if (!hasTitleLanguages(languages)) return [];
  return [
    ...(languages.audio.length > 0 ? [{ label: "Audio", value: languageListLabel(languages.audio, partialNote) }] : []),
    ...(languages.subtitles.length > 0
      ? [{ label: "Subtitles", value: languageListLabel(languages.subtitles, partialNote) }]
      : []),
  ];
}
