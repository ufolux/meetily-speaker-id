/** Helpers shared by the transcript and summary search. */

/** Case-insensitive match ranges [start, end) of `query` in `text`. */
export function findMatches(text: string, query: string): Array<[number, number]> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  // Lower-casing can change length for a few scripts; fall back to no match rather than misplace highlights.
  if (haystack.length !== text.length) return [];
  const ranges: Array<[number, number]> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    ranges.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return ranges;
}

/** Removes filler words; the transcript view shows (and search matches) this text. */
export function cleanStopWords(text: string): string {
  const stopWords = ['uh', 'um', 'er', 'ah', 'hmm', 'hm', 'eh', 'oh'];
  let cleanedText = text;
  stopWords.forEach((word) => {
    const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, 'gi');
    cleanedText = cleanedText.replace(pattern, ' ');
  });
  return cleanedText.replace(/\s+/g, ' ').trim();
}

/** Text shown for a transcript segment. */
export function transcriptDisplayText(text: string): string {
  return cleanStopWords(text) || (text.trim() === '' ? '[Silence]' : text);
}

/** Index of the last segment that started at or before `time` (segments sorted by start), or -1. */
export function activeSegmentIndex(starts: number[], time: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= time + 0.05) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** m:ss or h:mm:ss */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
