"use client";

import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

interface FindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Zero-based index of the current match, or -1 */
  currentIndex: number;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  placeholder?: string;
  /** Shown instead of the count while results are still loading */
  busy?: boolean;
  /** Changes whenever the bar should grab focus again (e.g. Cmd+F pressed while open) */
  focusToken?: number;
}

/** Find-in-page style search bar: Enter = next, Shift+Enter = previous, Esc = close. */
export function FindBar({
  query,
  onQueryChange,
  currentIndex,
  total,
  onNext,
  onPrevious,
  onClose,
  placeholder = 'Search',
  busy = false,
  focusToken,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const hasQuery = query.trim().length > 0;
  const status = !hasQuery ? '' : busy ? '…' : total === 0 ? 'No results' : `${currentIndex + 1}/${total}`;

  return (
    <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 shadow-sm focus-within:ring-1 focus-within:ring-blue-500">
      <Search className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
      />
      <span className="flex-shrink-0 text-xs tabular-nums text-gray-500" aria-live="polite">
        {status}
      </span>
      <button
        type="button"
        onClick={onPrevious}
        disabled={total === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={total === 0}
        title="Next match (Enter)"
        aria-label="Next match"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close search (Esc)"
        aria-label="Close search"
        className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
