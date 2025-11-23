import { useEffect, useRef, useState } from 'react';
import { X, Play, Pause, Volume2, VolumeX, Maximize2 } from 'lucide-react';

interface VideoPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
  projectName?: string;
}

export function VideoPlayerModal({ isOpen, onClose, videoUrl, projectName }: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen && videoRef.current && videoUrl) {
      // Validate URL is complete
      const trimmedUrl = videoUrl.trim();
      const isComplete = trimmedUrl.endsWith('.mp4') || 
                        trimmedUrl.endsWith('.mov') || 
                        trimmedUrl.endsWith('.webm') ||
                        trimmedUrl.includes('?') || // Presigned URLs have query params
                        trimmedUrl.includes('X-Amz-Signature'); // AWS presigned URL signature
      
      if (!trimmedUrl.startsWith('http')) {
        setIsLoading(false);
        return;
      }
      
      // Set video source and load
      videoRef.current.src = trimmedUrl; // Use full URL
      videoRef.current.crossOrigin = 'anonymous'; // Enable CORS for presigned URLs
      videoRef.current.load();
      setIsLoading(true);
    } else if (isOpen && !videoUrl) {
      setIsLoading(false);
    }
  }, [isOpen, videoUrl]);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setIsPlaying(false);
      setIsMuted(true);
      setCurrentTime(0);
      setDuration(0);
      setIsLoading(true);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
  }, [isOpen]);

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleMuteToggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = x / rect.width;
      const newTime = percent * duration;
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleFullscreen = () => {
    if (videoRef.current) {
      if (videoRef.current.requestFullscreen) {
        videoRef.current.requestFullscreen();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-6xl bg-black rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black/50">
          <h2 className="text-lg font-semibold text-white">
            {projectName || 'Video Player'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Video Container */}
        <div className="relative bg-black">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
          )}
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-auto max-h-[80vh]"
            crossOrigin="anonymous"
            controls={false}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={() => {
              setIsPlaying(true);
              setIsLoading(false);
            }}
            onPause={() => {
              setIsPlaying(false);
            }}
            onEnded={() => {
              setIsPlaying(false);
            }}
            onError={(e) => {
              const video = e.currentTarget;
              const error = video.error;
              console.error('[VideoPlayerModal] Video playback error:', {
                errorCode: error?.code,
                errorMessage: error?.message,
                networkState: video.networkState,
                readyState: video.readyState,
                videoUrl: videoUrl.substring(0, 200),
                videoUrlLength: videoUrl.length,
                videoUrlEnd: videoUrl.substring(Math.max(0, videoUrl.length - 50)),
                src: video.src?.substring(0, 200),
                srcLength: video.src?.length,
                srcEnd: video.src?.substring(Math.max(0, (video.src?.length || 0) - 50))
              });
              setIsLoading(false);
            }}
            onLoadStart={() => {}}
            onCanPlay={() => {
              setIsLoading(false);
            }}
            onProgress={() => {}}
          />

          {/* Video Controls Overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4">
            {/* Progress Bar */}
            <div 
              className="w-full h-2 bg-white/20 rounded-full mb-4 cursor-pointer group"
              onClick={handleSeek}
            >
              <div 
                className="h-full bg-blue-500 rounded-full transition-all group-hover:bg-blue-400"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <button
                onClick={handlePlayPause}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                {isPlaying ? (
                  <Pause className="w-6 h-6 text-white" />
                ) : (
                  <Play className="w-6 h-6 text-white" />
                )}
              </button>

              <button
                onClick={handleMuteToggle}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                {isMuted ? (
                  <VolumeX className="w-5 h-5 text-white" />
                ) : (
                  <Volume2 className="w-5 h-5 text-white" />
                )}
              </button>

              <div className="flex-1 text-sm text-white/80">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>

              <button
                onClick={handleFullscreen}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <Maximize2 className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

