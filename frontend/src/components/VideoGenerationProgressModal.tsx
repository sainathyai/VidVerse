import { useState, useEffect, useRef } from 'react';
import { X, CheckCircle2, AlertCircle, Loader2, Play, Pause } from 'lucide-react';

interface VideoGenerationProgressModalProps {
  isOpen: boolean;
  projectId: string;
  jobId: string | null;
  onComplete: (videoUrl: string) => void;
  onClose: () => void;
  onError: (error: string) => void;
}

interface JobStatus {
  id: string;
  status: string;
  progress: number;
  result?: {
    videoUrl: string;
    sceneUrls: string[];
    frameUrls: Array<{ first: string; last: string }>;
    status: string;
  };
  error?: string;
}

export function VideoGenerationProgressModal({
  isOpen,
  projectId,
  jobId,
  onComplete,
  onClose,
  onError,
}: VideoGenerationProgressModalProps) {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sceneUrls, setSceneUrls] = useState<string[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scenePollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for job status
  useEffect(() => {
    if (!isOpen || !jobId) return;

    const pollJobStatus = async () => {
      try {
        const token = localStorage.getItem('cognito_access_token');
        if (!token) return;

        const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
        const apiUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com');
        const response = await fetch(
          `${apiUrl}/api/jobs/${jobId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch job status');
        }

        const status: JobStatus = await response.json();
        setJobStatus(status);

        // Update scene URLs from job result if available
        if (status.result?.sceneUrls && status.result.sceneUrls.length > 0) {
          setSceneUrls(status.result.sceneUrls);
        }

        // Check if job is complete - don't auto-close, let user close manually
        if (status.status === 'completed' && status.result) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          if (scenePollIntervalRef.current) {
            clearInterval(scenePollIntervalRef.current);
          }
          // Don't call onComplete automatically - modal stays open
        } else if (status.status === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
          if (scenePollIntervalRef.current) {
            clearInterval(scenePollIntervalRef.current);
          }
          onError(status.error || 'Video generation failed');
        }
      } catch (error: any) {
        console.error('Error polling job status:', error);
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
        if (scenePollIntervalRef.current) {
          clearInterval(scenePollIntervalRef.current);
        }
        onError(error.message || 'Failed to check generation progress');
      }
    };

    // Poll immediately, then every 2 seconds
    pollJobStatus();
    pollIntervalRef.current = setInterval(pollJobStatus, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (scenePollIntervalRef.current) {
        clearInterval(scenePollIntervalRef.current);
      }
    };
  }, [isOpen, jobId, onComplete, onError]);

  // Poll for scenes from database to show preview clips in real-time
  useEffect(() => {
    if (!isOpen || !projectId) return;

    const pollScenes = async () => {
      try {
        const token = localStorage.getItem('cognito_access_token');
        if (!token) return;

        const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
        const apiUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com');
        const response = await fetch(
          `${apiUrl}/api/projects/${projectId}/scenes`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const scenes = await response.json();
          // Filter scenes that have video URLs and sort by scene number
          const urls = scenes
            .filter((scene: any) => scene.videoUrl)
            .sort((a: any, b: any) => a.sceneNumber - b.sceneNumber)
            .map((scene: any) => scene.videoUrl);
          
          if (urls.length > 0) {
            setSceneUrls(urls);
          }
        }
      } catch (error) {
        // Silently fail - scenes might not be available yet
        console.debug('Error fetching scenes:', error);
      }
    };

    // Poll immediately, then every 3 seconds
    pollScenes();
    scenePollIntervalRef.current = setInterval(pollScenes, 3000);

    return () => {
      if (scenePollIntervalRef.current) {
        clearInterval(scenePollIntervalRef.current);
      }
    };
  }, [isOpen, projectId]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setJobStatus(null);
      setCurrentPreviewIndex(0);
      setIsPlaying(false);
      setSceneUrls([]);
    }
  }, [isOpen]);

  // Get progress stage description with detailed information
  const getProgressStage = (progress: number): string => {
    if (progress < 5) return 'Initializing video generation...';
    if (progress < 10) return 'Analyzing your prompt and extracting key elements...';
    if (progress < 15) return 'Planning scene structure and timing...';
    if (progress < 75) {
      const sceneNum = Math.floor(((progress - 15) / 60) * 5) + 1;
      const sceneProgress = Math.round(((progress - 15 - ((sceneNum - 1) * 12)) / 12) * 100);
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
    if (progress < 80) return 'Stitching all scenes together into final video...';
    if (progress < 85) return 'Applying transitions and effects...';
    if (progress < 90) return 'Adding audio track (if provided)...';
    if (progress < 95) return 'Uploading final video to cloud storage...';
    if (progress < 100) return 'Finalizing and optimizing video...';
    return 'Video generation complete!';
  };

  const hasPreviewClips = sceneUrls.length > 0;

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  if (!isOpen) return null;

  const canClose = jobStatus?.status === 'completed' || jobStatus?.status === 'failed';

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => {
        // Prevent closing by clicking backdrop during processing
        if (!canClose && e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 rounded-2xl border border-white/10 shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            {jobStatus?.status === 'completed' ? (
              <CheckCircle2 className="w-6 h-6 text-green-400" />
            ) : jobStatus?.status === 'failed' ? (
              <AlertCircle className="w-6 h-6 text-red-400" />
            ) : (
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            )}
            <h2 className="text-xl font-bold text-white">
              {jobStatus?.status === 'completed'
                ? 'Video Generated!'
                : jobStatus?.status === 'failed'
                ? 'Generation Failed'
                : 'Generating Your Video'}
            </h2>
          </div>
          {jobStatus?.status === 'completed' || jobStatus?.status === 'failed' ? (
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-white/70" />
            </button>
          ) : (
            <div className="p-2">
              <X className="w-5 h-5 text-white/30" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">
                {jobStatus ? getProgressStage(jobStatus.progress) : 'Initializing...'}
              </span>
              <span className="text-white font-semibold">
                {jobStatus?.progress || 0}%
              </span>
            </div>
            <div className="h-3 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                style={{ width: `${jobStatus?.progress || 0}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-shimmer" />
              </div>
            </div>
          </div>

          {/* Preview Clips */}
          {hasPreviewClips && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Preview Clips</h3>
                {sceneUrls.length > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setCurrentPreviewIndex((prev) =>
                          prev > 0 ? prev - 1 : sceneUrls.length - 1
                        )
                      }
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <span className="text-white text-sm">←</span>
                    </button>
                    <span className="text-white/70 text-sm">
                      {currentPreviewIndex + 1} / {sceneUrls.length}
                    </span>
                    <button
                      onClick={() =>
                        setCurrentPreviewIndex((prev) =>
                          prev < sceneUrls.length - 1 ? prev + 1 : 0
                        )
                      }
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <span className="text-white text-sm">→</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="relative aspect-video bg-black rounded-xl overflow-hidden group">
                {sceneUrls[currentPreviewIndex] && (
                  <video
                    ref={videoRef}
                    src={sceneUrls[currentPreviewIndex]}
                    className="w-full h-full object-contain"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    loop
                  />
                )}
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {isPlaying ? (
                    <Pause className="w-16 h-16 text-white" />
                  ) : (
                    <Play className="w-16 h-16 text-white" />
                  )}
                </button>
              </div>

              {/* Scene thumbnails */}
              {sceneUrls.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {sceneUrls.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setCurrentPreviewIndex(idx);
                        setIsPlaying(false);
                      }}
                      className={`flex-shrink-0 w-24 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        currentPreviewIndex === idx
                          ? 'border-blue-500 scale-105'
                          : 'border-white/20 hover:border-white/40'
                      }`}
                    >
                      <video
                        src={url}
                        className="w-full h-full object-cover"
                        muted
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {jobStatus?.status === 'failed' && jobStatus.error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-red-400 text-sm">{jobStatus.error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 flex items-center justify-between gap-3">
          <div className="text-sm text-white/50">
            {jobStatus?.status === 'completed' 
              ? 'Video generation completed successfully!'
              : jobStatus?.status === 'failed'
              ? 'Generation failed. Please try again.'
              : 'This may take a few minutes. Please keep this window open...'}
          </div>
          <div className="flex items-center gap-3">
            {jobStatus?.status === 'completed' ? (
              <>
                <button
                  onClick={() => {
                    if (jobStatus?.result?.videoUrl) {
                      onComplete(jobStatus.result.videoUrl);
                    }
                    onClose();
                  }}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition-all"
                >
                  View Project
                </button>
              </>
            ) : jobStatus?.status === 'failed' ? (
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-white/10 text-white rounded-lg font-semibold hover:bg-white/20 transition-all"
              >
                Close
              </button>
            ) : (
              <div className="px-4 py-2 text-sm text-white/50 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

