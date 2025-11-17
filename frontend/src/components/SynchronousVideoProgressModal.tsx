import { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertCircle, Loader2, Play, Pause, Download } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from './auth/AuthProvider';

interface SynchronousVideoProgressModalProps {
  isOpen: boolean;
  projectId: string;
  generationResult: {
    videoUrl: string;
    sceneUrls: string[];
    frameUrls: Array<{ first: string; last: string }>;
  } | null;
  onClose: () => void;
  onError: (error: string) => void;
}

interface ProjectStatus {
  id: string;
  status: string;
  config?: {
    videoUrl?: string;
    sceneUrls?: string[];
    frameUrls?: Array<{ first: string; last: string }>;
  };
}

export function SynchronousVideoProgressModal({
  isOpen,
  projectId,
  generationResult,
  onClose,
  onError,
}: SynchronousVideoProgressModalProps) {
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { getAccessToken } = useAuth();

  // Poll for project status
  useEffect(() => {
    if (!isOpen || !projectId) return;

    const pollProjectStatus = async () => {
      try {
        const token = await getAccessToken();
        const status: ProjectStatus = await apiRequest<ProjectStatus>(
          `/api/projects/${projectId}`,
          { method: 'GET' },
          token
        );

        setProjectStatus(status);

        // Update progress based on status
        if (status.status === 'generating') {
          // Simulate progress (in real implementation, you'd get this from the backend)
          setProgress((prev) => Math.min(prev + 2, 95));
        } else if (status.status === 'completed') {
          setProgress(100);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
        } else if (status.status === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          onError('Video generation failed');
        }
      } catch (error: any) {
        console.error('Error polling project status:', error);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
        onError(error.message || 'Failed to check generation progress');
      }
    };

    // Initial poll
    pollProjectStatus();

    // Poll every 2 seconds
    pollIntervalRef.current = setInterval(pollProjectStatus, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen, projectId, getAccessToken, onError]);

  // Use generationResult if available (from synchronous call)
  const finalResult = generationResult || projectStatus?.config;
  const isCompleted = projectStatus?.status === 'completed' || !!generationResult;
  const isFailed = projectStatus?.status === 'failed';
  const canClose = isCompleted || isFailed;

  const getProgressStage = (currentProgress: number): string => {
    if (currentProgress < 5) return 'Initializing video generation...';
    if (currentProgress < 10) return 'Analyzing your prompt and extracting key elements...';
    if (currentProgress < 15) return 'Planning scene structure and timing...';
    if (currentProgress < 75) {
      const sceneNum = Math.floor(((currentProgress - 15) / 60) * 5) + 1;
      const sceneProgress = Math.round(((currentProgress - 15 - ((sceneNum - 1) * 12)) / 12) * 100);
      if (sceneProgress < 30) {
        return `Scene ${sceneNum}/5: Generating video with AI models...`;
      } else if (sceneProgress < 60) {
        return `Scene ${sceneNum}/5: Processing video frames...`;
      } else if (sceneProgress < 90) {
        return `Scene ${sceneNum}/5: Extracting key frames...`;
      } else {
        return `Scene ${sceneNum}/5: Finalizing scene...`;
      }
    }
    if (currentProgress < 80) return 'Stitching all scenes together into final video...';
    if (currentProgress < 85) return 'Applying transitions and effects...';
    if (currentProgress < 90) return 'Adding audio track (if provided)...';
    if (currentProgress < 95) return 'Uploading final video to cloud storage...';
    if (currentProgress < 100) return 'Finalizing and optimizing video...';
    return 'Video generation complete!';
  };

  const sceneUrls = finalResult?.sceneUrls || [];
  const frameUrls = finalResult?.frameUrls || [];
  const videoUrl = finalResult?.videoUrl;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (!canClose && e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Video Generation</h2>
          {canClose && (
            <button
              onClick={onClose}
              className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {isCompleted && videoUrl ? (
          /* Completed State - Show Results */
          <div className="space-y-6">
            <div className="flex items-center gap-3 text-green-400">
              <CheckCircle2 className="w-6 h-6" />
              <span className="text-lg font-semibold">Video generation completed successfully!</span>
            </div>

            {/* Final Video */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">Final Video</h3>
              <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
              </div>
              <div className="mt-3 flex gap-3">
                <a
                  href={videoUrl}
                  download
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all"
                >
                  <Download className="w-4 h-4" />
                  Download Video
                </a>
              </div>
            </div>

            {/* Scene Videos */}
            {sceneUrls.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Scene Videos ({sceneUrls.length})</h3>
                <div className="grid grid-cols-2 gap-4">
                  {sceneUrls.map((url, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50">
                      <video src={url} controls className="w-full" />
                      <p className="text-xs text-white/70 mt-2 text-center">Scene {idx + 1}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Frame Previews */}
            {frameUrls.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Key Frames</h3>
                <div className="grid grid-cols-4 gap-3">
                  {frameUrls.map((frames, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50">
                        <img src={frames.first} alt={`Scene ${idx + 1} - First Frame`} className="w-full" />
                      </div>
                      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50">
                        <img src={frames.last} alt={`Scene ${idx + 1} - Last Frame`} className="w-full" />
                      </div>
                      <p className="text-xs text-white/70 text-center">Scene {idx + 1}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex justify-end pt-4 border-t border-white/10">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all"
              >
                Done
              </button>
            </div>
          </div>
        ) : isFailed ? (
          /* Failed State */
          <div className="text-center py-8">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Generation Failed</h3>
            <p className="text-white/70 mb-6">Video generation encountered an error. Please try again.</p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all"
            >
              Close
            </button>
          </div>
        ) : (
          /* Processing State */
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              <span className="text-lg font-semibold text-white">Processing...</span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-white/70">
                <span>{getProgressStage(progress)}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="text-center text-white/50 text-sm">
              This may take several minutes. Please keep this window open.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

