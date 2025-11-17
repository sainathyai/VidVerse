import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Scissors, Film, Music, Volume2, VolumeX, Trash2, Plus } from 'lucide-react';

interface Scene {
  id: string;
  sceneNumber: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  firstFrameUrl?: string;
  duration: number;
  prompt?: string;
}

interface AudioTrack {
  id: string;
  url: string;
  startTime: number;
  duration: number;
  volume: number;
  name?: string;
}

interface VideoTimelineProps {
  scenes: Scene[];
  videoUrl?: string;
  onSceneClick?: (scene: Scene) => void;
  onSeek?: (time: number) => void;
  currentTime?: number;
  duration?: number;
  audioTracks?: AudioTrack[];
  onAddMusic?: () => void;
  onEditMusic?: (track: AudioTrack) => void;
  onRemoveMusic?: (trackId: string) => void;
  onMusicVolumeChange?: (trackId: string, volume: number) => void;
}

export function VideoTimeline({ 
  scenes, 
  videoUrl, 
  onSceneClick, 
  onSeek, 
  currentTime = 0,
  duration = 0,
  audioTracks = [],
  onAddMusic,
  onEditMusic,
  onRemoveMusic,
  onMusicVolumeChange
}: VideoTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [hoveredScene, setHoveredScene] = useState<number | null>(null);
  const [hoveredAudioTrack, setHoveredAudioTrack] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Only show timeline content if we have an actual video loaded with duration
  // Don't calculate from scenes if no video is loaded
  const hasVideo = videoUrl && duration > 0;
  const totalDuration = hasVideo ? duration : 0;

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const timeline = timelineRef.current;
    if (!timeline || !totalDuration) return;

    const rect = timeline.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const time = percentage * totalDuration;

    if (onSeek) {
      onSeek(time);
    }
  };

  // Calculate scene positions
  const getScenePosition = (sceneIndex: number) => {
    let startTime = 0;
    for (let i = 0; i < sceneIndex; i++) {
      startTime += scenes[i]?.duration || 5;
    }
    const sceneDuration = scenes[sceneIndex]?.duration || 5;
    const startPercent = (startTime / totalDuration) * 100;
    const widthPercent = (sceneDuration / totalDuration) * 100;
    return { startPercent, widthPercent, startTime, duration: sceneDuration };
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentTimePercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="w-full bg-black/40 border border-white/10 rounded-lg p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold text-white flex items-center gap-1.5">
            <Film className="w-3 h-3" />
            Timeline
          </h3>
          {hasVideo && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-white/60 hover:text-white/80 transition-colors"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
        <div className="text-[10px] text-white/60">
          {hasVideo ? (
            <>
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </>
          ) : (
            <span className="text-white/40">No video loaded</span>
          )}
        </div>
      </div>

      {hasVideo && expanded && (
        <div className="space-y-1.5">
          {/* Video Track */}
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 mb-1">
              <Film className="w-3 h-3 text-white/60" />
              <span className="text-[10px] text-white/60 font-medium">Video Track</span>
            </div>
            <div
              ref={timelineRef}
              className="relative h-6 bg-white/5 rounded-lg overflow-hidden border border-white/10 cursor-pointer"
              onClick={handleTimelineClick}
            >
              {/* Timeline Background with Time Markers */}
              <div className="absolute inset-0 flex items-center">
                {/* Time markers */}
                {Array.from({ length: 5 }).map((_, i) => {
                  const markerPercent = (i / 4) * 100;
                  return (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 w-px bg-white/10"
                      style={{ left: `${markerPercent}%` }}
                    >
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] text-white/40 whitespace-nowrap">
                        {formatTime((markerPercent / 100) * totalDuration)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Playhead */}
              {totalDuration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-10"
                  style={{
                    left: `${currentTimePercent}%`,
                  }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full" />
                </div>
              )}
            </div>
          </div>

          {/* Audio/Music Tracks */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-2">
                <Music className="w-3 h-3 text-white/60" />
                <span className="text-[10px] text-white/60 font-medium">Audio Tracks</span>
                {audioTracks.length > 0 && (
                  <span className="text-[9px] text-white/40">({audioTracks.length})</span>
                )}
              </div>
              {onAddMusic && (
                <button
                  onClick={onAddMusic}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded border border-blue-500/30 transition-colors"
                  title="Add music track"
                >
                  <Plus className="w-2.5 h-2.5" />
                  Add Music
                </button>
              )}
            </div>
            
            {audioTracks.length > 0 ? (
              <div className="space-y-1">
                {audioTracks.map((track) => {
                  const trackStartPercent = (track.startTime / totalDuration) * 100;
                  const trackWidthPercent = ((track.duration || totalDuration) / totalDuration) * 100;
                  const isHovered = hoveredAudioTrack === track.id;
                  
                  return (
                    <div
                      key={track.id}
                      className="relative h-5 bg-white/5 rounded border border-white/10 overflow-hidden group"
                      onMouseEnter={() => setHoveredAudioTrack(track.id)}
                      onMouseLeave={() => setHoveredAudioTrack(null)}
                    >
                      {/* Audio Track Bar */}
                      <div
                        className="absolute top-0 bottom-0 bg-gradient-to-r from-purple-500/40 to-pink-500/40 border-r border-purple-400/50"
                        style={{
                          left: `${trackStartPercent}%`,
                          width: `${trackWidthPercent}%`,
                        }}
                      >
                        <div className="absolute inset-0 flex items-center px-1.5">
                          <Music className="w-2.5 h-2.5 text-white/80" />
                          <span className="ml-1 text-[8px] text-white/80 font-medium truncate flex-1">
                            {track.name || 'Music Track'}
                          </span>
                          <div className="flex items-center gap-0.5 ml-1.5">
                            {track.volume > 0 ? (
                              <Volume2 className="w-2 h-2 text-white/70" />
                            ) : (
                              <VolumeX className="w-2 h-2 text-white/50" />
                            )}
                            <span className="text-[7px] text-white/60">{Math.round(track.volume * 100)}%</span>
                          </div>
                        </div>
                      </div>

                      {/* Hover Controls */}
                      {isHovered && (
                        <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-20">
                          {onEditMusic && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditMusic(track);
                              }}
                              className="p-0.5 bg-blue-500/80 hover:bg-blue-500 text-white rounded text-[7px] transition-colors"
                              title="Edit music"
                            >
                              <Scissors className="w-2 h-2" />
                            </button>
                          )}
                          {onMusicVolumeChange && (
                            <div className="flex items-center gap-0.5 bg-black/80 rounded px-1 py-0.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMusicVolumeChange(track.id, Math.max(0, track.volume - 0.1));
                                }}
                                className="text-white/80 hover:text-white text-[7px] leading-none"
                                title="Decrease volume"
                              >
                                −
                              </button>
                              <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={track.volume}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  onMusicVolumeChange(track.id, parseFloat(e.target.value));
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-10 h-0.5"
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMusicVolumeChange(track.id, Math.min(1, track.volume + 0.1));
                                }}
                                className="text-white/80 hover:text-white text-[7px] leading-none"
                                title="Increase volume"
                              >
                                +
                              </button>
                            </div>
                          )}
                          {onRemoveMusic && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveMusic(track.id);
                              }}
                              className="p-0.5 bg-red-500/80 hover:bg-red-500 text-white rounded transition-colors"
                              title="Remove music"
                            >
                              <Trash2 className="w-2 h-2" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="relative h-5 bg-white/5 rounded border border-dashed border-white/10 flex items-center justify-center">
                {onAddMusic ? (
                  <button
                    onClick={onAddMusic}
                    className="flex items-center gap-1 text-[8px] text-white/50 hover:text-white/70 transition-colors"
                  >
                    <Plus className="w-2.5 h-2.5" />
                    Click to add music track
                  </button>
                ) : (
                  <span className="text-[8px] text-white/30">No audio tracks</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!hasVideo && (
        <div className="relative h-6 bg-white/5 rounded-lg overflow-hidden border border-white/10 flex items-center justify-center">
          <span className="text-[8px] text-white/30">Timeline will appear when video is loaded</span>
        </div>
      )}
    </div>
  );
}

