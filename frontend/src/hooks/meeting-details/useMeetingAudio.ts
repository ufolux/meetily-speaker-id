import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export interface MeetingAudioControls {
  /** null while loading or when the meeting has no recording */
  src: string | null;
  available: boolean;
  isLoading: boolean;
  error: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  /** Set once the user plays or seeks, so the transcript only highlights after they engage the player */
  hasStarted: boolean;
  togglePlay: () => void;
  seek: (seconds: number, autoplay?: boolean) => void;
  skip: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: number) => void;
}

/** Loads a meeting's recording and drives an <audio> element for it. */
export function useMeetingAudio(meetingId: string | undefined, enabled: boolean): MeetingAudioControls {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setRate] = useState(1);
  const [hasStarted, setHasStarted] = useState(false);
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  // Resolve the recording path for this meeting.
  useEffect(() => {
    setSrc(null);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasStarted(false);
    if (!meetingId || !enabled) return;

    let cancelled = false;
    setIsLoading(true);
    invoke<{ path: string } | null>('api_get_meeting_audio', { meetingId })
      .then((audio) => {
        if (!cancelled) setSrc(audio ? convertFileSrc(audio.path) : null);
      })
      .catch((err) => {
        console.warn('Failed to locate meeting audio:', err);
        if (!cancelled) setError('Recording unavailable');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, enabled]);

  // One audio element per source.
  useEffect(() => {
    if (!src) return;
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = src;
    audio.playbackRate = playbackRateRef.current;
    audioRef.current = audio;

    let frame = 0;
    const tick = () => {
      setCurrentTime(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setIsPlaying(true);
      setHasStarted(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(frame);
      setCurrentTime(audio.currentTime);
    };
    const onTime = () => {
      if (audio.paused) setCurrentTime(audio.currentTime);
    };
    const onDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onError = () => {
      setIsPlaying(false);
      setError('This recording format cannot be played');
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('seeked', onTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('error', onError);

    return () => {
      cancelAnimationFrame(frame);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('seeked', onTime);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('error', onError);
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [src]);

  const play = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch((err) => {
      console.warn('Playback failed:', err);
      setError('This recording format cannot be played');
    });
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) play(audio);
    else audio.pause();
  }, [play]);

  const seek = useCallback((seconds: number, autoplay = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    audio.currentTime = Math.min(Math.max(0, seconds), max);
    setCurrentTime(audio.currentTime);
    setHasStarted(true);
    if (autoplay && audio.paused) play(audio);
  }, [play]);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (audio) seek(audio.currentTime + delta);
  }, [seek]);

  const setPlaybackRate = useCallback((rate: number) => {
    setRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, []);

  return {
    src,
    available: !!src && !error,
    isLoading,
    error,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    hasStarted,
    togglePlay,
    seek,
    skip,
    setPlaybackRate,
  };
}
