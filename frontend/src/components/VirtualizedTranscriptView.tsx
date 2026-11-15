'use client';

import { useCallback, useRef, useReducer, startTransition, useEffect, useState, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData } from "@/types";
import { SpeakerNames, speakerColorClasses, speakerDisplayName } from "@/lib/speakers";
import { findMatches, transcriptDisplayText } from "@/lib/text-search";

export interface VirtualizedTranscriptViewProps {
    /** Transcript segments to display */
    segments: TranscriptSegmentData[];
    /** Whether recording is in progress */
    isRecording?: boolean;
    /** Whether recording is paused */
    isPaused?: boolean;
    /** Whether processing/finalizing transcription */
    isProcessing?: boolean;
    /** Whether stopping */
    isStopping?: boolean;
    /** Enable streaming effect for latest segment */
    enableStreaming?: boolean;
    /** Show confidence indicators */
    showConfidence?: boolean;
    /** Completely disable auto-scroll behavior (for meeting details page) */
    disableAutoScroll?: boolean;

    // Pagination props (infinite scroll)
    hasMore?: boolean;
    isLoadingMore?: boolean;
    totalCount?: number;
    loadedCount?: number;
    onLoadMore?: () => void;

    // Speaker identification
    /** Custom speaker names for this meeting (speaker id → name) */
    speakerNames?: SpeakerNames;
    /** When set, speaker chips are clickable (e.g. to rename) */
    onSpeakerClick?: (speakerId: string) => void;

    // Playback and search
    /** Segment currently playing; highlighted */
    activeSegmentId?: string | null;
    /** Keep the active segment in view (paused briefly while the user scrolls) */
    followActiveSegment?: boolean;
    /** When set, clicking a segment's timestamp or text moves the playhead there */
    onSeek?: (seconds: number) => void;
    /** Highlight occurrences of this text */
    searchQuery?: string;
    /** Current search match: segment id and occurrence index within that segment */
    currentMatch?: { segmentId: string; occurrence: number } | null;
}

/** How long auto-follow stays paused after the user scrolls the transcript. */
const FOLLOW_PAUSE_MS = 4000;

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
    if (seconds === undefined) return '[--:--]';

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;

    return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

// Wraps search matches in <mark>; the current match gets a stronger color.
function highlightText(text: string, query: string, currentOccurrence: number): React.ReactNode {
    const ranges = findMatches(text, query);
    if (ranges.length === 0) return text;
    const parts: React.ReactNode[] = [];
    let last = 0;
    ranges.forEach(([start, end], i) => {
        if (start > last) parts.push(text.slice(last, start));
        parts.push(
            <mark
                key={i}
                data-current-match={i === currentOccurrence ? 'true' : undefined}
                className={i === currentOccurrence ? 'rounded-sm bg-orange-300 text-gray-900' : 'rounded-sm bg-yellow-200 text-gray-900'}
            >
                {text.slice(start, end)}
            </mark>
        );
        last = end;
    });
    if (last < text.length) parts.push(text.slice(last));
    return parts;
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
    id,
    timestamp,
    text,
    confidence,
    isStreaming,
    showConfidence,
    speakerId,
    speakerLabel,
    onSpeakerClick,
    isActive,
    onSeek,
    searchQuery,
    currentOccurrence,
}: {
    id: string;
    timestamp: number;
    text: string;
    confidence?: number;
    isStreaming: boolean;
    showConfidence: boolean;
    /** Set only on the first segment of a speaker turn */
    speakerId?: string | null;
    speakerLabel?: string;
    onSpeakerClick?: (speakerId: string) => void;
    isActive?: boolean;
    onSeek?: (seconds: number) => void;
    searchQuery?: string;
    /** Occurrence of the search query in this segment that is the current match, or -1 */
    currentOccurrence?: number;
}) {
    const displayText = transcriptDisplayText(text);
    const body = searchQuery ? highlightText(displayText, searchQuery, currentOccurrence ?? -1) : displayText;
    const time = formatRecordingTime(timestamp);

    return (
        <div id={`segment-${id}`} className={speakerId ? "mb-3 mt-4 first:mt-0" : "mb-3"}>
            {speakerId && (
                <div className="mb-1 ml-[58px]">
                    {onSpeakerClick ? (
                        <button
                            type="button"
                            onClick={() => onSpeakerClick(speakerId)}
                            title="Rename speaker"
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium hover:brightness-95 focus:outline-none focus:ring-1 focus:ring-blue-500 ${speakerColorClasses(speakerId)}`}
                        >
                            {speakerLabel}
                        </button>
                    ) : (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${speakerColorClasses(speakerId)}`}>
                            {speakerLabel}
                        </span>
                    )}
                </div>
            )}
            <div className="flex items-start gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        {onSeek ? (
                            <button
                                type="button"
                                onClick={() => onSeek(timestamp)}
                                aria-label={`Jump to ${time}`}
                                className={`text-xs mt-1 flex-shrink-0 min-w-[50px] text-left rounded hover:text-blue-600 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
                            >
                                {time}
                            </button>
                        ) : (
                            <span className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px]">
                                {time}
                            </span>
                        )}
                    </TooltipTrigger>
                    <TooltipContent>
                        {onSeek && <p className="text-xs">Jump to this point</p>}
                        {confidence !== undefined && showConfidence && (
                            <ConfidenceIndicator confidence={confidence} showIndicator={showConfidence} />
                        )}
                    </TooltipContent>
                </Tooltip>
                <div
                    className={`flex-1 rounded-md transition-colors ${isActive ? 'bg-blue-50 -mx-1 px-1' : onSeek ? 'hover:bg-gray-50' : ''} ${onSeek ? 'cursor-pointer' : ''}`}
                    onClick={onSeek ? () => {
                        // Selecting text should not move the playhead.
                        const selection = window.getSelection();
                        if (selection && !selection.isCollapsed) return;
                        onSeek(timestamp);
                    } : undefined}
                    title={onSeek ? 'Jump to this point in the recording' : undefined}
                >
                    {isStreaming ? (
                        <div className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
                            <p className="text-base text-gray-800 leading-relaxed">{body}</p>
                        </div>
                    ) : (
                        <p className="text-base text-gray-800 leading-relaxed">{body}</p>
                    )}
                </div>
            </div>
        </div>
    );
});

export const VirtualizedTranscriptView: React.FC<VirtualizedTranscriptViewProps> = ({
    segments,
    isRecording = false,
    isPaused = false,
    isProcessing = false,
    isStopping = false,
    enableStreaming = false,
    showConfidence = true,
    disableAutoScroll = false,
    hasMore = false,
    isLoadingMore = false,
    totalCount = 0,
    loadedCount = 0,
    onLoadMore,
    speakerNames,
    onSpeakerClick,
    activeSegmentId,
    followActiveSegment = false,
    onSeek,
    searchQuery,
    currentMatch,
}) => {
    const segmentExtras = (segmentId: string) => ({
        isActive: !!activeSegmentId && segmentId === activeSegmentId,
        onSeek,
        searchQuery: searchQuery?.trim() ? searchQuery : undefined,
        currentOccurrence: currentMatch?.segmentId === segmentId ? currentMatch.occurrence : -1,
    });
    // Speaker chip only at the start of each speaker turn
    const speakerTurnProps = (index: number) => {
        const speaker = segments[index]?.speaker;
        if (!speaker || segments[index - 1]?.speaker === speaker) {
            return {};
        }
        return {
            speakerId: speaker,
            speakerLabel: speakerDisplayName(speaker, speakerNames),
            onSpeakerClick,
        };
    };

    // Create scroll ref first - shared between virtualizer and auto-scroll hook
    const scrollRef = useRef<HTMLDivElement>(null);
    // Ref for infinite scroll trigger element
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    // Force re-render without flushSync (avoids React warning)
    const [, rerender] = useReducer((x: number) => x + 1, 0);

    // Setup virtualizer for efficient rendering of large lists
    const virtualizer = useVirtualizer({
        count: segments.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 60, // Estimated height per segment
        overscan: 10, // Render extra items above/below viewport
        onChange: () => {
            startTransition(() => {
                rerender();
            });
        },
    });

    // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
    useAutoScroll({
        scrollRef,
        segments,
        isRecording,
        isPaused,
        virtualizer,
        virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
        disableAutoScroll,
    });

    // Scrolls a segment into view (virtualized or plain list).
    const scrollToSegment = useCallback((segmentId: string, align: 'center' | 'auto') => {
        const index = segments.findIndex(seg => seg.id === segmentId);
        if (index === -1) return;
        if (segments.length >= VIRTUALIZATION_THRESHOLD) {
            virtualizer.scrollToIndex(index, { align });
        } else {
            document.getElementById(`segment-${segmentId}`)?.scrollIntoView({ block: align === 'center' ? 'center' : 'nearest' });
        }
    }, [segments, virtualizer]);

    // Pause auto-follow while the user scrolls the transcript themselves.
    const lastUserScrollRef = useRef(0);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const markUserScroll = () => { lastUserScrollRef.current = Date.now(); };
        el.addEventListener('wheel', markUserScroll, { passive: true });
        el.addEventListener('touchmove', markUserScroll, { passive: true });
        el.addEventListener('keydown', markUserScroll);
        return () => {
            el.removeEventListener('wheel', markUserScroll);
            el.removeEventListener('touchmove', markUserScroll);
            el.removeEventListener('keydown', markUserScroll);
        };
    }, []);

    // Follow playback: keep the playing segment centred.
    useEffect(() => {
        if (!followActiveSegment || !activeSegmentId) return;
        if (Date.now() - lastUserScrollRef.current < FOLLOW_PAUSE_MS) return;
        scrollToSegment(activeSegmentId, 'center');
    }, [followActiveSegment, activeSegmentId, scrollToSegment]);

    // Jump to the current search match.
    const matchSegmentId = currentMatch?.segmentId;
    const matchOccurrence = currentMatch?.occurrence;
    useEffect(() => {
        if (!matchSegmentId) return;
        lastUserScrollRef.current = Date.now(); // searching takes over from playback follow
        scrollToSegment(matchSegmentId, 'center');
        // After the row renders, centre the exact match (long segments can exceed the viewport).
        const frame = requestAnimationFrame(() => {
            const mark = scrollRef.current?.querySelector('mark[data-current-match="true"]');
            mark?.scrollIntoView({ block: 'nearest' });
        });
        return () => cancelAnimationFrame(frame);
    }, [matchSegmentId, matchOccurrence, scrollToSegment]);

    // Streaming text effect hook (typewriter animation for new transcripts)
    const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
        segments,
        isRecording,
        enableStreaming
    );

    // Infinite scroll: IntersectionObserver to trigger loading more
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording || segments.length === 0) {
            return;
        }

        const triggerElement = loadMoreTriggerRef.current;
        if (!triggerElement) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
            },
            {
                root: null,
                rootMargin: '100px',
                threshold: 0,
            }
        );

        observer.observe(triggerElement);

        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

    // Scroll-based fallback for fast scrolling
    useEffect(() => {
        if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

        const scrollElement = scrollRef.current;
        if (!scrollElement) return;

        let ticking = false;

        const handleScroll = () => {
            if (ticking || isLoadingMore || !hasMore) return;

            ticking = true;
            requestAnimationFrame(() => {
                const { scrollTop, scrollHeight, clientHeight } = scrollElement;
                const scrollBottom = scrollHeight - scrollTop - clientHeight;

                // Trigger load when within 200px of bottom
                if (scrollBottom < 200 && hasMore && !isLoadingMore) {
                    onLoadMore();
                }
                ticking = false;
            });
        };

        scrollElement.addEventListener('scroll', handleScroll, { passive: true });
        return () => scrollElement.removeEventListener('scroll', handleScroll);
    }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

    // Use simple rendering for small lists, virtualization for large lists
    const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

    return (
        <div ref={scrollRef} className="flex flex-col h-full overflow-y-auto px-4 py-2">
            {/* Recording Status Bar - Sticky at top, always visible when recording */}
            <AnimatePresence>
                {isRecording && (
                    <div className="sticky top-0 z-10 bg-white pb-2">
                        <RecordingStatusBar isPaused={isPaused} />
                    </div>
                )}
            </AnimatePresence>

            {/* Content - add padding when recording to prevent overlap */}
            <div className={isRecording ? 'pt-2' : ''}>
            {segments.length === 0 ? (
                // Empty state
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center text-gray-500 mt-8"
                >
                    {isRecording ? (
                        <>
                            <div className="flex items-center justify-center mb-3">
                                <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-orange-500' : 'bg-blue-500 animate-pulse'}`}></div>
                            </div>
                            <p className="text-sm text-gray-600">
                                {isPaused ? 'Recording paused' : 'Listening for speech...'}
                            </p>
                            <p className="text-xs mt-1 text-gray-400">
                                {isPaused ? 'Click resume to continue recording' : 'Speak to see live transcription'}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-lg font-semibold">Welcome to meetily!</p>
                            <p className="text-xs mt-1">Start recording to see live transcription</p>
                        </>
                    )}
                </motion.div>
            ) : useVirtualization ? (
                // Virtualized rendering for large lists
                <>
                    <div
                        style={{
                            height: virtualizer.getTotalSize(),
                            width: "100%",
                            position: "relative",
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const segment = segments[virtualRow.index];
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <div
                                    key={segment.id}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    style={{
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                        width: "100%",
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    <TranscriptSegment
                                        id={segment.id}
                                        timestamp={segment.timestamp}
                                        text={getDisplayText(segment)}
                                        confidence={segment.confidence}
                                        isStreaming={isStreaming}
                                        showConfidence={showConfidence}
                                        {...speakerTurnProps(virtualRow.index)}
                                        {...segmentExtras(segment.id)}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger and loading indicator */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-gray-400">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-gray-500"
                        >
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            ) : (
                // Simple rendering for small lists (better animations)
                <>
                    <div className="space-y-1">
                        {segments.map((segment, index) => {
                            const isStreaming = streamingSegmentId === segment.id;

                            return (
                                <motion.div
                                    key={segment.id}
                                    initial={{ opacity: 0, y: 5 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    <TranscriptSegment
                                        id={segment.id}
                                        timestamp={segment.timestamp}
                                        text={getDisplayText(segment)}
                                        confidence={segment.confidence}
                                        isStreaming={isStreaming}
                                        showConfidence={showConfidence}
                                        {...speakerTurnProps(index)}
                                        {...segmentExtras(segment.id)}
                                    />
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Infinite scroll trigger (for small lists that grow) */}
                    {(hasMore || isLoadingMore) && !isRecording && segments.length > 0 && (
                        <div ref={loadMoreTriggerRef} className="flex justify-center items-center py-4 mt-2">
                            {isLoadingMore ? (
                                <div className="flex items-center gap-2 text-gray-500">
                                    <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                                    <span className="text-sm">Loading more...</span>
                                </div>
                            ) : hasMore && totalCount > 0 ? (
                                <span className="text-sm text-gray-400">
                                    Showing {loadedCount} of {totalCount} segments
                                </span>
                            ) : null}
                        </div>
                    )}

                    {/* Listening indicator when recording */}
                    {!isStopping && isRecording && !isPaused && !isProcessing && segments.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2 mt-4 text-gray-500"
                        >
                            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                            <span className="text-sm">Listening...</span>
                        </motion.div>
                    )}
                </>
            )}
            </div>
        </div>
    );
};
