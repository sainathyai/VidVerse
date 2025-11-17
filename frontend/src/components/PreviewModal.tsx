import { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX } from 'lucide-react';

interface PreviewItem {
  id: string;
  type: 'image' | 'video' | 'audio' | 'scene';
  url: string;
  thumbnail?: string;
  title?: string;
  description?: string;
}

interface PreviewModalProps {
  items: PreviewItem[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}

export function PreviewModal({ items, initialIndex = 0, isOpen, onClose }: PreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [audioReady, setAudioReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentItem = items[currentIndex];

  // Reset when modal opens/closes or items change
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsPlaying(false);
      setAudioReady(false);
      setVideoReady(false);
    }
  }, [isOpen, initialIndex]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        setIsPlaying(false);
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        setIsPlaying(false);
      } else if (e.key === ' ') {
        e.preventDefault();
        const item = items[currentIndex];
        if (item?.type === 'audio' || item?.type === 'video' || item?.type === 'scene') {
          setIsPlaying(!isPlaying);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, items.length, items, isPlaying, onClose]);

  // Sync audio/video state - only play if ready and has valid source
  useEffect(() => {
    if (audioRef.current && currentItem?.type === 'audio' && currentItem.url && currentItem.url.trim() !== '') {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
      if (isPlaying && audioReady) {
        audioRef.current.play().catch((error) => {
          // Only log if it's not a common expected error
          if (error.name !== 'NotAllowedError' && error.name !== 'NotSupportedError') {
            console.warn('Error playing audio:', error);
          }
          setIsPlaying(false);
          setAudioReady(false);
        });
      } else if (!isPlaying) {
        audioRef.current.pause();
      }
    }
    if (videoRef.current && (currentItem?.type === 'video' || currentItem?.type === 'scene') && currentItem.url && currentItem.url.trim() !== '') {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
      if (isPlaying && videoReady) {
        videoRef.current.play().catch((error) => {
          // Only log if it's not a common expected error
          if (error.name !== 'NotAllowedError' && error.name !== 'NotSupportedError') {
            console.warn('Error playing video:', error);
          }
          setIsPlaying(false);
          setVideoReady(false);
        });
      } else if (!isPlaying) {
        videoRef.current.pause();
      }
    }
  }, [isPlaying, isMuted, volume, audioReady, videoReady, currentItem]);

  // Reset playback when item changes
  useEffect(() => {
    setIsPlaying(false);
    setAudioReady(false);
    setVideoReady(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [currentIndex]);

  const handlePrevious = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    setIsPlaying(false);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (currentItem?.type === 'audio' || currentItem?.type === 'video' || currentItem?.type === 'scene') {
      if (!currentItem.url) {
        console.warn('No source URL available for playback');
        return;
      }
      // For audio, wait for ready state
      if (currentItem.type === 'audio' && !audioReady) {
        // Trigger load if not ready
        if (audioRef.current) {
          audioRef.current.load();
        }
        return;
      }
      // For video, wait for ready state
      if ((currentItem.type === 'video' || currentItem.type === 'scene') && !videoReady) {
        // Trigger load if not ready
        if (videoRef.current) {
          videoRef.current.load();
        }
        return;
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  if (!isOpen || !currentItem) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Navigation buttons */}
      {items.length > 1 && (
        <>
          <button
            onClick={handlePrevious}
            className="absolute left-4 z-10 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-4 z-10 p-3 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Content */}
      <div className="relative w-full h-full flex items-center justify-center p-8">
        <div className="max-w-6xl w-full h-full flex flex-col items-center justify-center">
          {/* Title */}
          {currentItem.title && (
            <h3 className="text-white text-xl font-semibold mb-4">{currentItem.title}</h3>
          )}

          {/* Preview content */}
          <div className="relative w-full h-full flex items-center justify-center bg-black/30 rounded-lg overflow-hidden">
            {currentItem.type === 'image' && (
              <img
                src={currentItem.url}
                alt={currentItem.title || 'Preview'}
                className="max-w-full max-h-full object-contain"
              />
            )}

            {currentItem.type === 'video' && (
              <video
                ref={videoRef}
                src={currentItem.url}
                controls
                className="max-w-full max-h-full"
                preload="metadata"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={(e) => {
                  console.error('Video error:', e);
                  setIsPlaying(false);
                  setVideoReady(false);
                }}
                onLoadedMetadata={() => {
                  setVideoReady(true);
                }}
                onCanPlay={() => {
                  setVideoReady(true);
                }}
              />
            )}

            {currentItem.type === 'audio' && (
              <div className="flex flex-col items-center justify-center w-full max-w-md p-8">
                <div className="w-64 h-64 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mb-8">
                  <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                    <Volume2 className="w-16 h-16 text-white" />
                  </div>
                </div>
                {currentItem.url && currentItem.url.trim() !== '' ? (
                  <audio
                    ref={audioRef}
                    src={currentItem.url}
                    preload="none"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onError={(e) => {
                      const audioElement = e.currentTarget;
                      const error = audioElement.error;
                      if (error) {
                        // Only log if it's not a network error (which might be expected)
                        if (error.code !== MediaError.MEDIA_ERR_NETWORK) {
                          console.warn('Audio playback error:', {
                            code: error.code,
                            message: error.message,
                            url: currentItem.url
                          });
                        }
                      }
                      setIsPlaying(false);
                      setAudioReady(false);
                    }}
                    onLoadedMetadata={() => {
                      setAudioReady(true);
                    }}
                    onCanPlay={() => {
                      setAudioReady(true);
                    }}
                    onLoadedData={() => {
                      setAudioReady(true);
                    }}
                  />
                ) : null}
                <div className="w-full space-y-4">
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={togglePlay}
                      className="p-4 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!currentItem.url || currentItem.url.trim() === ''}
                    >
                      {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
                    </button>
                    <button
                      onClick={toggleMute}
                      className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                      disabled={!currentItem.url || currentItem.url.trim() === ''}
                    >
                      {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <VolumeX className="w-4 h-4 text-white/70" />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                    <Volume2 className="w-4 h-4 text-white/70" />
                  </div>
                  {(!currentItem.url || currentItem.url.trim() === '') && (
                    <p className="text-white/50 text-sm text-center">No audio source available</p>
                  )}
                </div>
              </div>
            )}

            {currentItem.type === 'scene' && (
              <div className="w-full h-full flex items-center justify-center">
                {currentItem.url ? (
                  <video
                    ref={videoRef}
                    src={currentItem.url}
                    controls
                    className="max-w-full max-h-full"
                    preload="metadata"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onError={(e) => {
                      console.error('Scene video error:', e);
                      setIsPlaying(false);
                      setVideoReady(false);
                    }}
                    onLoadedMetadata={() => {
                      setVideoReady(true);
                    }}
                    onCanPlay={() => {
                      setVideoReady(true);
                    }}
                  />
                ) : (
                  <div className="text-white/50 text-center">
                    <p className="text-lg mb-2">Scene Preview</p>
                    <p className="text-sm">{currentItem.description || 'No video available'}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          {currentItem.description && (
            <p className="text-white/70 text-sm mt-4 text-center max-w-2xl">
              {currentItem.description}
            </p>
          )}

          {/* Counter */}
          {items.length > 1 && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/70 text-sm">
              {currentIndex + 1} / {items.length}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

