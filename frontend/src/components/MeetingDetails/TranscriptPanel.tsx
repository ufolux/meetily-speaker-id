"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { SpeakersBar } from './SpeakersBar';
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { SpeakerNames, fetchSpeakerNames, speakersInOrder } from '@/lib/speakers';
import { activeSegmentIndex, findMatches, transcriptDisplayText } from '@/lib/text-search';
import { useMeetingAudio } from '@/hooks/meeting-details/useMeetingAudio';
import { AudioPlayerBar } from './AudioPlayerBar';
import { FindBar } from './FindBar';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  /** Loads all remaining pages (search and playback follow need every segment) */
  onLoadAll?: () => Promise<void>;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  onLoadAll,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      speaker: t.speaker ?? null,
    }));
  }, [transcripts, usePagination, segments]);

  // Speaker identification: per-meeting custom names and the edit dialog
  const [speakerNames, setSpeakerNames] = useState<SpeakerNames>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const speakers = useMemo(() => speakersInOrder(convertedSegments), [convertedSegments]);
  const hasSpeakers = speakers.length > 0;
  // Segment ids change when a meeting is re-transcribed, which also resets custom names.
  const firstSegmentId = convertedSegments[0]?.id;

  useEffect(() => {
    if (!meetingId || !hasSpeakers) {
      setSpeakerNames({});
      return;
    }
    let cancelled = false;
    fetchSpeakerNames(meetingId).then((names) => {
      if (!cancelled) setSpeakerNames(names);
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId, hasSpeakers, firstSegmentId]);

  // Recording playback; the transcript follows the playing segment.
  const audio = useMeetingAudio(meetingId, !isRecording);
  const segmentStarts = useMemo(() => convertedSegments.map(seg => seg.timestamp), [convertedSegments]);
  const activeIndex = audio.hasStarted ? activeSegmentIndex(segmentStarts, audio.currentTime) : -1;
  const activeSegmentId = activeIndex >= 0 ? convertedSegments[activeIndex].id : null;
  // Clicking a line only moves the playhead; playback state is unchanged.
  const handleSeek = useCallback((seconds: number) => audio.seek(seconds), [audio.seek]);

  useEffect(() => {
    if (audio.hasStarted && hasMore) void onLoadAll?.();
  }, [audio.hasStarted, hasMore, onLoadAll]);

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [matchIndex, setMatchIndex] = useState(0);
  const activeQuery = searchOpen ? deferredQuery.trim() : '';

  const matches = useMemo(() => {
    if (!activeQuery) return [];
    const found: { segmentId: string; occurrence: number }[] = [];
    for (const seg of convertedSegments) {
      const count = findMatches(transcriptDisplayText(seg.text), activeQuery).length;
      for (let occurrence = 0; occurrence < count; occurrence++) {
        found.push({ segmentId: seg.id, occurrence });
      }
    }
    return found;
  }, [convertedSegments, activeQuery]);

  useEffect(() => setMatchIndex(0), [activeQuery]);
  useEffect(() => {
    if (activeQuery && hasMore) void onLoadAll?.();
  }, [activeQuery, hasMore, onLoadAll]);

  const currentMatch = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : null;
  const stepMatch = (delta: number) => {
    if (matches.length === 0) return;
    setMatchIndex(i => (Math.min(i, matches.length - 1) + delta + matches.length) % matches.length);
  };
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocusToken(t => t + 1);
  }, []);
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };

  // Cmd/Ctrl+F opens transcript search unless focus is in the summary.
  useEffect(() => {
    if (isRecording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f' || e.altKey || e.shiftKey) return;
      const active = document.activeElement;
      if (active instanceof Element && active.closest('[data-find-scope="summary"]')) return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRecording, openSearch]);

  const canSearch = !isRecording && convertedSegments.length > 0;

  return (
    <div className="flex h-full min-w-0 w-full bg-white flex-col relative @container" data-find-scope="transcript">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200 relative">
        {canSearch && !searchOpen && (
          <button
            type="button"
            onClick={openSearch}
            title="Search transcript (⌘F)"
            aria-label="Search transcript"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <Search className="h-4 w-4" />
          </button>
        )}
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />
      </div>

      {canSearch && searchOpen && (
        <div className="border-b border-gray-200 px-3 py-2">
          <FindBar
            query={query}
            onQueryChange={setQuery}
            currentIndex={currentMatch ? Math.min(matchIndex, matches.length - 1) : -1}
            total={matches.length}
            onNext={() => stepMatch(1)}
            onPrevious={() => stepMatch(-1)}
            onClose={closeSearch}
            placeholder="Search transcript"
            busy={!!activeQuery && !!(hasMore || isLoadingMore)}
            focusToken={searchFocusToken}
          />
        </div>
      )}

      {!isRecording && <AudioPlayerBar audio={audio} />}

      {meetingId && !isRecording && (
        <SpeakersBar
          meetingId={meetingId}
          speakers={speakers}
          speakerNames={speakerNames}
          onSpeakerNamesChange={setSpeakerNames}
          editingSpeaker={editingSpeaker}
          onEditingSpeakerChange={setEditingSpeaker}
          onTranscriptsChanged={onRefetchTranscripts}
        />
      )}

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          speakerNames={speakerNames}
          onSpeakerClick={meetingId && !isRecording ? setEditingSpeaker : undefined}
          activeSegmentId={activeSegmentId}
          followActiveSegment={audio.isPlaying}
          onSeek={audio.available ? handleSeek : undefined}
          searchQuery={activeQuery}
          currentMatch={currentMatch}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
