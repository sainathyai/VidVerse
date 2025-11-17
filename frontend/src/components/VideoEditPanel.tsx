import React, { useState, useRef, useEffect } from 'react';
import { Scissors, Sparkles, Layers, Music, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from './auth/AuthProvider';
import { uploadFile } from '../lib/upload';

interface VideoEditPanelProps {
  videoUrl: string;
  projectId: string;
  initialMode?: 'trim' | 'effects' | 'transitions' | 'music';
  onSave: (editedVideoUrl: string) => void;
  onClose: () => void;
}

type EditMode = 'trim' | 'effects' | 'transitions' | 'music' | null;

export function VideoEditPanel({ videoUrl, projectId, initialMode, onSave, onClose }: VideoEditPanelProps) {
  const { getAccessToken } = useAuth();
  const [activeMode, setActiveMode] = useState<EditMode>(initialMode || null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [selectedEffect, setSelectedEffect] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioVolume, setAudioVolume] = useState(0.5);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Get video duration when loaded
  useEffect(() => {
    if (videoRef.current) {
      const handleLoadedMetadata = () => {
        if (videoRef.current) {
          setTrimEnd(videoRef.current.duration);
        }
      };
      videoRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => {
        if (videoRef.current) {
          videoRef.current.removeEventListener('loadedmetadata', handleLoadedMetadata);
        }
      };
    }
  }, [videoUrl]);

  const effects = [
    { id: 'fade_in', name: 'Fade In', description: 'Fade in from black' },
    { id: 'fade_out', name: 'Fade Out', description: 'Fade out to black' },
    { id: 'blur', name: 'Blur', description: 'Apply blur effect' },
    { id: 'brightness', name: 'Brightness', description: 'Adjust brightness' },
    { id: 'contrast', name: 'Contrast', description: 'Adjust contrast' },
    { id: 'saturation', name: 'Saturation', description: 'Adjust color saturation' },
    { id: 'vintage', name: 'Vintage', description: 'Vintage film look' },
    { id: 'black_white', name: 'Black & White', description: 'Convert to grayscale' },
  ];

  const transitions = [
    { id: 'fade', name: 'Fade', description: 'Crossfade transition' },
    { id: 'slide_left', name: 'Slide Left', description: 'Slide from right to left' },
    { id: 'slide_right', name: 'Slide Right', description: 'Slide from left to right' },
    { id: 'slide_up', name: 'Slide Up', description: 'Slide from bottom to top' },
    { id: 'slide_down', name: 'Slide Down', description: 'Slide from top to bottom' },
    { id: 'zoom_in', name: 'Zoom In', description: 'Zoom in transition' },
    { id: 'zoom_out', name: 'Zoom Out', description: 'Zoom out transition' },
    { id: 'circle_open', name: 'Circle Open', description: 'Circular wipe' },
    { id: 'circle_close', name: 'Circle Close', description: 'Circular close' },
  ];

  const handleApply = async () => {
    setIsProcessing(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      let resultUrl = videoUrl;

      // Apply trim if set
      if (activeMode === 'trim' && trimEnd > trimStart) {
        const trimResult = await apiRequest<{ success: boolean; videoUrl: string }>(
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
        if (trimResult.success) {
          resultUrl = trimResult.videoUrl;
        }
      }

      // Apply effect
      if (activeMode === 'effects' && selectedEffect) {
        const effectResult = await apiRequest<{ success: boolean; videoUrl: string }>(
          `/api/projects/${projectId}/apply-effect`,
          {
            method: 'POST',
            body: JSON.stringify({
              videoUrl: resultUrl,
              effect: selectedEffect,
            }),
          },
          token
        );
        if (effectResult.success) {
          resultUrl = effectResult.videoUrl;
        }
      }

      // Add music
      if (activeMode === 'music' && audioUrl) {
        const musicResult = await apiRequest<{ success: boolean; videoUrl: string }>(
          `/api/projects/${projectId}/add-audio`,
          {
            method: 'POST',
            body: JSON.stringify({
              audioUrl: audioUrl,
              volume: audioVolume,
            }),
          },
          token
        );
        if (musicResult.success) {
          resultUrl = musicResult.videoUrl;
        }
      }

      onSave(resultUrl);
      onClose();
    } catch (error: any) {
      console.error('Error applying edits:', error);
      alert(`Failed to apply edits: ${error.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-black/95 border border-white/10 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-xl font-semibold text-white">Video Editor</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Preview */}
        <div className="p-4 border-b border-white/10">
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full h-full"
            />
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-2 p-4 border-b border-white/10 overflow-x-auto">
          <button
            onClick={() => setActiveMode(activeMode === 'trim' ? null : 'trim')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all whitespace-nowrap ${
              activeMode === 'trim'
                ? 'bg-blue-500 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            <Scissors className="w-4 h-4" />
            Trim
          </button>
          <button
            onClick={() => setActiveMode(activeMode === 'effects' ? null : 'effects')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all whitespace-nowrap ${
              activeMode === 'effects'
                ? 'bg-blue-500 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Effects
          </button>
          <button
            onClick={() => setActiveMode(activeMode === 'transitions' ? null : 'transitions')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all whitespace-nowrap ${
              activeMode === 'transitions'
                ? 'bg-blue-500 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            <Layers className="w-4 h-4" />
            Transitions
          </button>
          <button
            onClick={() => setActiveMode(activeMode === 'music' ? null : 'music')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all whitespace-nowrap ${
              activeMode === 'music'
                ? 'bg-blue-500 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            <Music className="w-4 h-4" />
            Music
          </button>
        </div>

        {/* Mode Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeMode === 'trim' && (
            <TrimPanel
              trimStart={trimStart}
              trimEnd={trimEnd}
              onTrimStartChange={setTrimStart}
              onTrimEndChange={setTrimEnd}
            />
          )}

          {activeMode === 'effects' && (
            <EffectsPanel
              effects={effects}
              selectedEffect={selectedEffect}
              onSelectEffect={setSelectedEffect}
            />
          )}

          {activeMode === 'transitions' && (
            <TransitionsPanel
              transitions={transitions}
              selectedTransition={selectedTransition}
              onSelectTransition={setSelectedTransition}
            />
          )}

          {activeMode === 'music' && (
            <MusicPanel
              audioUrl={audioUrl}
              audioVolume={audioVolume}
              onAudioUrlChange={setAudioUrl}
              onVolumeChange={setAudioVolume}
            />
          )}

          {!activeMode && (
            <div className="text-center py-12 text-white/50">
              <p>Select an editing mode to get started</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={isProcessing || !activeMode}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Apply Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrimPanel({
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
}: {
  trimStart: number;
  trimEnd: number;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Trim Video</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Start Time (seconds)
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={trimStart}
            onChange={(e) => onTrimStartChange(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            End Time (seconds)
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={trimEnd}
            onChange={(e) => onTrimEndChange(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-white/70">
            Video will be trimmed from {trimStart.toFixed(1)}s to {trimEnd.toFixed(1)}s
            {trimEnd > trimStart && (
              <span className="ml-2 text-blue-400">
                (Duration: {(trimEnd - trimStart).toFixed(1)}s)
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function EffectsPanel({
  effects,
  selectedEffect,
  onSelectEffect,
}: {
  effects: Array<{ id: string; name: string; description: string }>;
  selectedEffect: string | null;
  onSelectEffect: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Video Effects</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {effects.map((effect) => (
          <button
            key={effect.id}
            onClick={() => onSelectEffect(effect.id)}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              selectedEffect === effect.id
                ? 'border-blue-500 bg-blue-500/20'
                : 'border-white/10 bg-white/5 hover:border-white/20'
            }`}
          >
            <div className="text-white font-medium mb-1">{effect.name}</div>
            <div className="text-xs text-white/60">{effect.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TransitionsPanel({
  transitions,
  selectedTransition,
  onSelectTransition,
}: {
  transitions: Array<{ id: string; name: string; description: string }>;
  selectedTransition: string | null;
  onSelectTransition: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Transitions</h3>
      <p className="text-sm text-white/60">
        Select a transition style to apply between scenes
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {transitions.map((transition) => (
          <button
            key={transition.id}
            onClick={() => onSelectTransition(transition.id)}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              selectedTransition === transition.id
                ? 'border-blue-500 bg-blue-500/20'
                : 'border-white/10 bg-white/5 hover:border-white/20'
            }`}
          >
            <div className="text-white font-medium mb-1">{transition.name}</div>
            <div className="text-xs text-white/60">{transition.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MusicPanel({
  audioUrl,
  audioVolume,
  onAudioUrlChange,
  onVolumeChange,
}: {
  audioUrl: string | null;
  audioVolume: number;
  onAudioUrlChange: (url: string | null) => void;
  onVolumeChange: (volume: number) => void;
}) {
  const { getAccessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const { url } = await uploadFile(file, 'audio', token, undefined, undefined);
      onAudioUrlChange(url);
    } catch (error: any) {
      console.error('Error uploading audio:', error);
      alert(`Failed to upload audio: ${error.message || 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Add Music</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-white/70 mb-2">
            Audio File
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full px-4 py-3 border-2 border-dashed border-white/20 hover:border-white/40 rounded-lg text-white/70 hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Music className="w-5 h-5" />
            {isUploading ? 'Uploading...' : audioUrl ? 'Change Audio File' : 'Choose Audio File'}
          </button>
        </div>

        {audioUrl && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Volume: {Math.round(audioVolume * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={audioVolume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm text-white/70">Audio file selected</p>
            </div>
          </div>
        )}

        <div className="text-xs text-white/50">
          Supported formats: MP3, WAV, AAC, OGG
        </div>
      </div>
    </div>
  );
}


