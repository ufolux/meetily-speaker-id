"use client";

import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import type { MeetingAudioControls } from '@/hooks/meeting-details/useMeetingAudio';
import { formatClock } from '@/lib/text-search';

const RATES = [0.75, 1, 1.25, 1.5, 2];

/** Compact player for the meeting recording. */
export function AudioPlayerBar({ audio }: { audio: MeetingAudioControls }) {
  if (audio.isLoading || !audio.src) return null;

  if (audio.error) {
    return (
      <div className="border-b border-gray-200 px-4 py-2 text-xs text-gray-500">{audio.error}</div>
    );
  }

  const nextRate = () => {
    const i = RATES.indexOf(audio.playbackRate);
    audio.setPlaybackRate(RATES[(i + 1) % RATES.length]);
  };

  return (
    <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
      <button
        type="button"
        onClick={() => audio.skip(-10)}
        title="Back 10 seconds"
        aria-label="Back 10 seconds"
        className="rounded p-1 text-gray-600 hover:bg-gray-100"
      >
        <RotateCcw className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={audio.togglePlay}
        title={audio.isPlaying ? 'Pause' : 'Play recording'}
        aria-label={audio.isPlaying ? 'Pause' : 'Play recording'}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        {audio.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => audio.skip(10)}
        title="Forward 10 seconds"
        aria-label="Forward 10 seconds"
        className="rounded p-1 text-gray-600 hover:bg-gray-100"
      >
        <RotateCw className="h-4 w-4" />
      </button>
      <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">{formatClock(audio.currentTime)}</span>
      <input
        type="range"
        min={0}
        max={audio.duration || 0}
        step={0.1}
        value={Math.min(audio.currentTime, audio.duration || 0)}
        onChange={(e) => audio.seek(Number(e.target.value))}
        disabled={!audio.duration}
        aria-label="Seek"
        className="h-1 min-w-0 flex-1 cursor-pointer accent-blue-600"
      />
      <span className="flex-shrink-0 text-xs tabular-nums text-gray-500">{formatClock(audio.duration)}</span>
      <button
        type="button"
        onClick={nextRate}
        title="Playback speed"
        aria-label={`Playback speed ${audio.playbackRate}x`}
        className="w-11 flex-shrink-0 rounded px-1 py-0.5 text-xs font-medium tabular-nums text-gray-600 hover:bg-gray-100"
      >
        {audio.playbackRate}x
      </button>
    </div>
  );
}
