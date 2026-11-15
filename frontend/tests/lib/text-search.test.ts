import { describe, expect, test } from 'bun:test';
import { activeSegmentIndex, findMatches, formatClock, transcriptDisplayText } from '../../src/lib/text-search';

describe('findMatches', () => {
  test('finds every case-insensitive occurrence', () => {
    expect(findMatches('Budget, budget and BUDGET', 'budget')).toEqual([[0, 6], [8, 14], [19, 25]]);
  });
  test('ignores empty and whitespace queries', () => {
    expect(findMatches('anything', '  ')).toEqual([]);
  });
  test('matches CJK text', () => {
    expect(findMatches('我们讨论预算，预算很重要', '预算')).toEqual([[4, 6], [7, 9]]);
  });
  test('does not overlap matches', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]);
  });
});

describe('activeSegmentIndex', () => {
  const starts = [0, 4.5, 9, 20];
  test('picks the last segment that has started', () => {
    expect(activeSegmentIndex(starts, 0)).toBe(0);
    expect(activeSegmentIndex(starts, 5)).toBe(1);
    expect(activeSegmentIndex(starts, 19.9)).toBe(2);
    expect(activeSegmentIndex(starts, 100)).toBe(3);
  });
  test('returns -1 before the first segment', () => {
    expect(activeSegmentIndex([2, 3], 1)).toBe(-1);
    expect(activeSegmentIndex([], 1)).toBe(-1);
  });
});

describe('formatClock', () => {
  test('formats minutes and hours', () => {
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(NaN)).toBe('0:00');
  });
});

describe('transcriptDisplayText', () => {
  test('removes filler words and keeps silence marker', () => {
    expect(transcriptDisplayText('um so, uh, the plan')).toBe('so, the plan');
    expect(transcriptDisplayText('  ')).toBe('[Silence]');
  });
});
