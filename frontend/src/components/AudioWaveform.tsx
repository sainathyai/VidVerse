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
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      cursorColor: progressColor,
      barWidth: 2,
      barRadius: 3,
      responsive: true,
      height,
      normalize: true,
    });

    wavesurferRef.current = wavesurfer;

    // Load audio
    if (audioUrl instanceof File) {
      const objectUrl = URL.createObjectURL(audioUrl);
      wavesurfer.load(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    } else {
      wavesurfer.load(audioUrl);
    }

    // Event listeners
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("timeupdate", (time) => setCurrentTime(time));
    wavesurfer.on("ready", () => setDuration(wavesurfer.getDuration()));

    return () => {
      wavesurfer.destroy();
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

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full" />
      <div className="flex items-center justify-between">
        <button
          onClick={togglePlayback}
          className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <span className="text-sm text-muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

