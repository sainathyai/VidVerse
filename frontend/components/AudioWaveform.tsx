"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";

interface AudioWaveformProps {
  audioUrl: string | File;
  height?: number;
  waveColor?: string;
  progressColor?: string;
}

export function AudioWaveform({
  audioUrl,
  height = 100,
  waveColor = "rgba(59, 130, 246, 0.5)",
  progressColor = "rgba(59, 130, 246, 1)",
}: AudioWaveformProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!waveformRef.current) return;

    // Create WaveSurfer instance
    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      waveColor,
      progressColor,
      cursorColor: "rgba(255, 255, 255, 0.5)",
      barWidth: 2,
      barRadius: 3,
      responsive: true,
      height,
      normalize: true,
      backend: "WebAudio",
    });

    wavesurferRef.current = wavesurfer;

    // Load audio
    const loadAudio = async () => {
      try {
        setLoading(true);
        if (audioUrl instanceof File) {
          const url = URL.createObjectURL(audioUrl);
          await wavesurfer.load(url);
        } else {
          await wavesurfer.load(audioUrl);
        }
        setDuration(wavesurfer.getDuration());
        setLoading(false);
      } catch (error) {
        console.error("Error loading audio:", error);
        setLoading(false);
      }
    };

    loadAudio();

    // Event listeners
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("timeupdate", (time) => setCurrentTime(time));
    wavesurfer.on("ready", () => {
      setDuration(wavesurfer.getDuration());
      setLoading(false);
    });

    // Cleanup
    return () => {
      wavesurfer.destroy();
      if (audioUrl instanceof File) {
        URL.revokeObjectURL(URL.createObjectURL(audioUrl));
      }
    };
  }, [audioUrl, height, waveColor, progressColor]);

  const togglePlayback = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24 bg-surface/40 rounded-lg">
        <div className="text-muted">Loading audio...</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={waveformRef} className="w-full" />
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{formatTime(currentTime)}</span>
        <button
          onClick={togglePlayback}
          className="px-4 py-2 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 rounded-lg transition-colors"
        >
          {isPlaying ? "⏸ Pause" : "▶ Play"}
        </button>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}

