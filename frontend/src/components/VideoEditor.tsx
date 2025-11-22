import { useState, useRef, useEffect } from 'react';
import { Video, Scissors, Play, Pause, Volume2, VolumeX, Maximize2, X, Copy, Trash2, Move, ZoomIn, ZoomOut } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../components/auth/AuthProvider';

interface VideoSegment {
  id: string;
  startTime: number;
  endTime: number;
  sceneNumber?: number;
  selected?: boolean;
}

interface VideoEditorProps {
  videoUrl: string;
  scenes: Array<{ id: string; sceneNumber: number; videoUrl?: string; startTime: number; duration: number }>;
  projectId?: string;
  onSave?: (editedVideoUrl: string) => void;
  onClose?: () => void;
}

export function VideoEditor({ videoUrl, scenes, projectId, onSave, onClose }: VideoEditorProps) {
  const { getAccessToken } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [segments, setSegments] = useState<VideoSegment[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState<number | null>(null);
  const [trimEnd, setTrimEnd] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showMultiSelect, setShowMultiSelect] = useState(false);
  const [multiSelectWindows, setMultiSelectWindows] = useState<Array<{ id: string; start: number; end: number; selected: boolean }>>([]);

  // Initialize segments from scenes
  useEffect(() => {
    if (scenes && scenes.length > 0) {
      const newSegments: VideoSegment[] = [];
      let currentTime = 0;
      
      scenes.forEach((scene) => {
        if (scene.videoUrl) {
          newSegments.push({
            id: scene.id,
            startTime: currentTime,
            endTime: currentTime + scene.duration,
            sceneNumber: scene.sceneNumber,
            selected: false,
          });
          currentTime += scene.duration;
        }
      });
      
      setSegments(newSegments);
      setDuration(currentTime);
    }
  }, [scenes]);

  // Update current time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateTime = () => setCurrentTime(video.currentTime);
    video.addEventListener('timeupdate', updateTime);
    video.addEventListener('loadedmetadata', () => {
      setDuration(video.duration);
    });

    return () => {
      video.removeEventListener('timeupdate', updateTime);
    };
  }, [videoUrl]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const timeline = timelineRef.current;
    if (!timeline || !duration) return;

    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;

    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsSelecting(true);
    const timeline = timelineRef.current;
    if (!timeline || !duration) return;

    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const time = percentage * duration;
    
    setSelectionStart(time);
    setSelectionEnd(time);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelecting || selectionStart === null) return;
    
    const timeline = timelineRef.current;
    if (!timeline || !duration) return;

    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const time = percentage * duration;
    
    setSelectionEnd(time);
  };

  const handleTimelineMouseUp = () => {
    if (isSelecting && selectionStart !== null && selectionEnd !== null) {
      // Select segments within the selection range
      const start = Math.min(selectionStart, selectionEnd);
      const end = Math.max(selectionStart, selectionEnd);
      
      const newSelected = new Set<string>();
      segments.forEach(segment => {
        if (segment.startTime < end && segment.endTime > start) {
          newSelected.add(segment.id);
        }
      });
      
      setSelectedSegments(newSelected);
      setIsSelecting(false);
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  };

  const handleTrim = async () => {
    if (trimStart !== null && trimEnd !== null && trimStart < trimEnd && projectId) {
      try {
        const token = await getAccessToken();
        const result = await apiRequest<{ success: boolean; videoUrl: string }>(
          `/api/projects/${projectId}/trim-video`,
          {
            method: 'POST',
            body: JSON.stringify({
              startTime: trimStart,
              endTime: trimEnd,
            }),
          },
          token
        );

        if (result.success && result.videoUrl) {
          // Update video URL
          if (videoRef.current) {
            videoRef.current.src = result.videoUrl;
            videoRef.current.load();
          }
          if (onSave) {
            onSave(result.videoUrl);
          }
          setTrimStart(null);
          setTrimEnd(null);
        }
      } catch (error: any) {
        console.error('Error trimming video:', error);
        alert(`Failed to trim video: ${error.message || 'Unknown error'}`);
      }
    }
  };

  const handleDeleteSelected = () => {
    if (selectedSegments.size > 0) {
      setSegments(segments.filter(s => !selectedSegments.has(s.id)));
      setSelectedSegments(new Set());
    }
  };

  const handleCopySelected = () => {
    if (selectedSegments.size > 0) {
      // Find selected segments and create duplicates
      const selectedSegmentIds = Array.from(selectedSegments);
      const segmentsToCopy = segments.filter(s => selectedSegmentIds.includes(s.id));
      
      if (segmentsToCopy.length === 0) return;
      
      // Calculate the end time of the last segment to place copies after it
      const lastSegmentEnd = Math.max(...segments.map(s => s.endTime), 0);
      const firstSelectedStart = Math.min(...segmentsToCopy.map(s => s.startTime));
      const offset = lastSegmentEnd - firstSelectedStart + 0.1; // Small gap between original and copy
      
      // Create copies with new IDs and adjusted times
      const copiedSegments: VideoSegment[] = segmentsToCopy.map(segment => ({
        ...segment,
        id: `${segment.id}-copy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        startTime: segment.startTime + offset,
        endTime: segment.endTime + offset,
        selected: false, // Deselect copied segments
      }));
      
      // Add copied segments to the timeline
      setSegments(prev => [...prev, ...copiedSegments].sort((a, b) => a.startTime - b.startTime));
      
      // Clear selection
      setSelectedSegments(new Set());
      
      console.log(`Copied ${copiedSegments.length} segment(s) to timeline`);
    }
  };

  const addMultiSelectWindow = () => {
    if (selectionStart !== null && selectionEnd !== null) {
      const start = Math.min(selectionStart, selectionEnd);
      const end = Math.max(selectionStart, selectionEnd);
      
      const newWindow = {
        id: `window-${Date.now()}`,
        start,
        end,
        selected: false,
      };
      
      setMultiSelectWindows([...multiSelectWindows, newWindow]);
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  };

  const deleteMultiSelectWindow = (windowId: string) => {
    setMultiSelectWindows(multiSelectWindows.filter(w => w.id !== windowId));
  };

  const toggleFullscreen = () => {
    const container = document.getElementById('video-editor-container');
    if (!container) return;

    if (!isFullscreen) {
      container.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  const selectionStartPercent = selectionStart !== null ? (selectionStart / duration) * 100 : 0;
  const selectionEndPercent = selectionEnd !== null ? (selectionEnd / duration) * 100 : 0;
  const selectionLeft = Math.min(selectionStartPercent, selectionEndPercent);
  const selectionWidth = Math.abs(selectionEndPercent - selectionStartPercent);

  return (
    <div id="video-editor-container" className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <h2 className="text-xl font-semibold text-white">Video Editor</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Video Player */}
      <div className="flex-1 flex items-center justify-center bg-black relative">
        <video
          ref={videoRef}
          src={videoUrl}
          className="max-w-full max-h-full"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        
        {/* Play/Pause Overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <button
            onClick={togglePlay}
            className="pointer-events-auto w-20 h-20 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center transition-all"
          >
            {isPlaying ? (
              <Pause className="w-10 h-10 text-white" />
            ) : (
              <Play className="w-10 h-10 text-white ml-1" />
            )}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 border-t border-white/10 bg-black/50">
        {/* Playback Controls */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={togglePlay}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          
          <div className="flex-1 text-sm text-white/70">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
          >
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const newVolume = parseFloat(e.target.value);
              setVolume(newVolume);
              setIsMuted(newVolume === 0);
              if (videoRef.current) {
                videoRef.current.volume = newVolume;
                videoRef.current.muted = newVolume === 0;
              }
            }}
            className="w-24"
          />
        </div>

        {/* Timeline */}
        <div className="mb-4">
          <div
            ref={timelineRef}
            className="relative h-24 bg-white/5 rounded-lg cursor-pointer overflow-x-auto"
            onClick={handleTimelineClick}
            onMouseDown={handleTimelineMouseDown}
            onMouseMove={handleTimelineMouseMove}
            onMouseUp={handleTimelineMouseUp}
            onMouseLeave={handleTimelineMouseUp}
          >
            <div 
              className="relative h-full" 
              style={{ 
                width: `${duration * zoomLevel * 100}px`,
                minWidth: '100%'
              }}
            >
              {/* Segments */}
              {segments.map((segment) => {
                const left = (segment.startTime / duration) * 100;
                const width = ((segment.endTime - segment.startTime) / duration) * 100;
                const isSelected = selectedSegments.has(segment.id);

                return (
                  <div
                    key={segment.id}
                    className={`absolute h-full border-r border-white/20 ${
                      isSelected
                        ? 'bg-blue-500/50 border-blue-400'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const newSelected = new Set(selectedSegments);
                      if (newSelected.has(segment.id)) {
                        newSelected.delete(segment.id);
                      } else {
                        newSelected.add(segment.id);
                      }
                      setSelectedSegments(newSelected);
                    }}
                  >
                    <div className="absolute top-1 left-1 text-xs text-white/70 font-medium">
                      Scene {segment.sceneNumber}
                    </div>
                  </div>
                );
              })}

              {/* Selection Range */}
              {isSelecting && selectionStart !== null && selectionEnd !== null && (
                <div
                  className="absolute top-0 bottom-0 bg-blue-500/30 border-l border-r border-blue-400"
                  style={{
                    left: `${selectionLeft}%`,
                    width: `${selectionWidth}%`,
                  }}
                />
              )}

              {/* Multi-Select Windows */}
              {multiSelectWindows.map((window) => {
                const left = (window.start / duration) * 100;
                const width = ((window.end - window.start) / duration) * 100;
                
                return (
                  <div
                    key={window.id}
                    className={`absolute top-0 bottom-0 border-2 ${
                      window.selected
                        ? 'bg-yellow-500/30 border-yellow-400'
                        : 'bg-yellow-500/20 border-yellow-500/50'
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMultiSelectWindows(
                        multiSelectWindows.map(w =>
                          w.id === window.id ? { ...w, selected: !w.selected } : w
                        )
                      );
                    }}
                  />
                );
              })}

              {/* Trim Range Indicator */}
              {trimStart !== null && trimEnd !== null && (
                <div
                  className="absolute top-0 bottom-0 bg-purple-500/30 border-l-2 border-r-2 border-purple-400 pointer-events-none z-5"
                  style={{
                    left: `${(trimStart / duration) * 100}%`,
                    width: `${((trimEnd - trimStart) / duration) * 100}%`,
                  }}
                >
                  <div className="absolute -top-5 left-0 text-xs text-purple-400 font-medium whitespace-nowrap">
                    Trim: {formatTime(trimStart)} - {formatTime(trimEnd)}
                  </div>
                </div>
              )}

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
                style={{
                  left: `${(currentTime / duration) * 100}%`,
                }}
              >
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Select Windows (Loom-style) */}
        {showMultiSelect && multiSelectWindows.length > 0 && (
          <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/10">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-white">Multi-Select Windows</h4>
              <button
                onClick={() => setShowMultiSelect(false)}
                className="text-xs text-white/70 hover:text-white"
              >
                Hide
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {multiSelectWindows.map((window) => (
                <div
                  key={window.id}
                  className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-2 ${
                    window.selected
                      ? 'bg-blue-500/50 border border-blue-400'
                      : 'bg-white/10 border border-white/20'
                  }`}
                >
                  <span className="text-white/70">
                    {formatTime(window.start)} - {formatTime(window.end)}
                  </span>
                  <button
                    onClick={() => deleteMultiSelectWindow(window.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteSelected}
              disabled={selectedSegments.size === 0}
              className="px-3 py-1.5 text-sm bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-2 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>

            <button
              onClick={handleCopySelected}
              disabled={selectedSegments.size === 0}
              className="px-3 py-1.5 text-sm bg-blue-500/20 hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-2 transition-all"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>

            <button
              onClick={() => {
                if (selectionStart !== null && selectionEnd !== null) {
                  setTrimStart(Math.min(selectionStart, selectionEnd));
                  setTrimEnd(Math.max(selectionStart, selectionEnd));
                }
              }}
              disabled={selectionStart === null || selectionEnd === null}
              className="px-3 py-1.5 text-sm bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-2 transition-all"
            >
              <Scissors className="w-4 h-4" />
              Set Trim Points
            </button>

            <button
              onClick={handleTrim}
              disabled={trimStart === null || trimEnd === null}
              className="px-3 py-1.5 text-sm bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-2 transition-all"
            >
              <Scissors className="w-4 h-4" />
              Trim Video
            </button>

            <button
              onClick={() => {
                if (selectionStart !== null && selectionEnd !== null) {
                  addMultiSelectWindow();
                }
                setShowMultiSelect(true);
              }}
              disabled={selectionStart === null || selectionEnd === null}
              className="px-3 py-1.5 text-sm bg-green-500/20 hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md flex items-center gap-2 transition-all"
            >
              <Move className="w-4 h-4" />
              Add Window
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.25))}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-white/70 min-w-[3rem] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel(Math.min(3, zoomLevel + 0.25))}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {onSave && (
              <button
                onClick={() => onSave(videoUrl)}
                className="px-4 py-1.5 text-sm bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-md hover:from-blue-600 hover:to-purple-600 transition-all"
              >
                Save Changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

