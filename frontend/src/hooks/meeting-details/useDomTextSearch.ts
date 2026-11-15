import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { findMatches } from '@/lib/text-search';

const ALL = 'meetily-find';
const CURRENT = 'meetily-find-current';

type HighlightRegistry = Map<string, unknown>;
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
}

function clearHighlights() {
  const api = highlightApi();
  api?.registry.delete(ALL);
  api?.registry.delete(CURRENT);
}

/** Text ranges matching `query` inside `root` (per text node; matches spanning formatting are not found). */
function collectRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    for (const [start, end] of findMatches(text, query)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
    }
  }
  return ranges;
}

/**
 * Find-in-page over a DOM subtree (e.g. the rich-text summary editor). Matches are
 * painted with the CSS Custom Highlight API, so the editor's DOM is never modified.
 */
export function useDomTextSearch(containerRef: RefObject<HTMLElement | null>, query: string, active: boolean) {
  const [ranges, setRanges] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const needle = active ? query.trim() : '';
  const lastNeedleRef = useRef('');

  // Recompute on query change and whenever the content changes (editing, regeneration).
  useEffect(() => {
    const root = containerRef.current;
    if (!needle || !root) {
      setRanges([]);
      clearHighlights();
      lastNeedleRef.current = needle;
      return;
    }
    const recompute = () => {
      setRanges(collectRanges(root, needle));
      if (lastNeedleRef.current !== needle) {
        lastNeedleRef.current = needle;
        setIndex(0);
      }
    };
    recompute();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(recompute, 150);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [containerRef, needle]);

  const current = ranges.length > 0 ? Math.min(index, ranges.length - 1) : -1;

  // Paint highlights.
  useEffect(() => {
    const api = highlightApi();
    if (!api) return;
    if (ranges.length === 0) {
      clearHighlights();
      return;
    }
    api.registry.set(ALL, new api.Highlight(...ranges));
    if (current >= 0) api.registry.set(CURRENT, new api.Highlight(ranges[current]));
  }, [ranges, current]);

  useEffect(() => clearHighlights, []);

  // Scroll the current match into view.
  useEffect(() => {
    if (current < 0) return;
    const range = ranges[current];
    const el = range.startContainer.parentElement;
    if (!el) return;
    const rect = range.getBoundingClientRect();
    const scroller = el.closest('[data-find-scroll]') as HTMLElement | null;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (rect.top < box.top + 40 || rect.bottom > box.bottom - 40) {
        scroller.scrollTop += rect.top - box.top - box.height / 2;
      }
    } else {
      el.scrollIntoView({ block: 'center' });
    }
  }, [ranges, current]);

  const step = useCallback((delta: number) => {
    setIndex(i => {
      if (ranges.length === 0) return 0;
      return (Math.min(i, ranges.length - 1) + delta + ranges.length) % ranges.length;
    });
  }, [ranges.length]);

  return { total: ranges.length, current, next: () => step(1), previous: () => step(-1) };
}
