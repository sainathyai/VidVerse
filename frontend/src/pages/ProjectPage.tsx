import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { Header } from "../components/Header";
import { Play, Film } from "lucide-react";

interface Project {
  id: string;
  name?: string;
  category: string;
  prompt: string;
  duration: number;
  status: string;
  created_at: string;
  mode?: string;
  config?: {
    videoUrl?: string;
    duration?: number;
    style?: string;
    mood?: string;
    audioUrl?: string;
  };
}

interface Scene {
  id: string;
  sceneNumber: number;
  prompt: string;
  duration: number;
  startTime: number;
  videoUrl: string;
  thumbnailUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
}

function ProjectContent() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);
  const [selectedVideoType, setSelectedVideoType] = useState<'final' | 'scene' | null>(null);
  const [selectedSceneNumber, setSelectedSceneNumber] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { getAccessToken } = useAuth();

  useEffect(() => {
    if (id) {
      fetchProject();
    }
  }, [id]);

  const fetchProject = async () => {
    try {
      const token = await getAccessToken();
      const data = await apiRequest<Project>(`/api/projects/${id}`, { method: 'GET' }, token);
      setProject(data);
      
      // Set default video to final video if available (for completed projects or any project with video)
      if (data.config?.videoUrl) {
        setSelectedVideoUrl(data.config.videoUrl);
        setSelectedVideoType('final');
        setSelectedSceneNumber(null);
      }
      
      // Fetch scenes if project is completed
      if (data.status === 'completed') {
        try {
          const scenesData = await apiRequest<Scene[]>(`/api/projects/${id}/scenes`, { method: 'GET' }, token);
          setScenes(scenesData.sort((a, b) => a.sceneNumber - b.sceneNumber));
        } catch (err) {
          console.warn('Could not fetch scenes:', err);
        }
      }
      
      // Check if project is generating and get job ID
      if (data.status === 'generating') {
        try {
          const jobs = await apiRequest<{ jobs: any[] }>(`/api/projects/${id}/jobs`, { method: 'GET' }, token);
          const activeJob = jobs.jobs.find((j: any) => j.status === 'active' || j.status === 'waiting');
          if (activeJob) {
            setJobId(activeJob.id);
            setGenerating(true);
          }
        } catch (err) {
          // Jobs endpoint might not be available yet
          console.warn('Could not fetch jobs:', err);
        }
      }
    } catch (error) {
      console.error('Error fetching project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVideoSelect = (url: string, type: 'final' | 'scene', sceneNumber?: number) => {
    setSelectedVideoUrl(url);
    setSelectedVideoType(type);
    setSelectedSceneNumber(sceneNumber || null);
    // Reset video player
    if (videoRef.current) {
      videoRef.current.load();
    }
  };

  const handleGenerateVideo = async () => {
    try {
      setGenerating(true);
      const token = await getAccessToken();
      const result = await apiRequest<{ jobId: string; status: string }>(
        '/api/jobs/generate-video',
        {
          method: 'POST',
          body: JSON.stringify({ projectId: id }),
        },
        token
      );
      setJobId(result.jobId);
      // Refresh project to update status
      await fetchProject();
    } catch (error: any) {
      console.error('Error starting video generation:', error);
      alert(error.message || 'Failed to start video generation');
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        {/* Animated Textured Background */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950" />
          <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-purple-950/20 to-pink-950/20 animate-gradient-shift" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float-delayed" />
          <div className="absolute top-1/2 right-1/3 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl animate-float-slow" />
        </div>
        <Header />
        <div className="relative z-10 max-w-4xl mx-auto p-8">
          <div className="text-center text-white/70 py-12">
            <div className="animate-pulse">Loading project...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen relative overflow-hidden">
        {/* Animated Textured Background */}
        <div className="fixed inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950" />
          <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-purple-950/20 to-pink-950/20 animate-gradient-shift" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float-delayed" />
          <div className="absolute top-1/2 right-1/3 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl animate-float-slow" />
        </div>
        <Header />
        <div className="relative z-10 max-w-4xl mx-auto p-8">
          <div className="text-center text-white/70 py-12">
            <p>Project not found</p>
            <Link to="/dashboard" className="text-blue-400 hover:text-blue-300 hover:underline mt-4 inline-block transition-colors">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Animated Textured Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-purple-950/20 to-pink-950/20 animate-gradient-shift" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float-delayed" />
        <div className="absolute top-1/2 right-1/3 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl animate-float-slow" />
      </div>
      <Header />
      <div className="relative z-10 max-w-4xl mx-auto p-8">
        {/* Page Header */}
        <div className="mb-8 animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <Link to="/dashboard" className="text-white/70 hover:text-white inline-block transition-colors flex items-center gap-2">
              <span>←</span> Back to Dashboard
            </Link>
            <Link
              to={`/project/${id}/edit`}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all shadow-lg shadow-blue-500/30"
            >
              Open Editor
            </Link>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">
            {project?.name || 'Project Details'}
          </h1>
          {project?.name && (
            <p className="text-white/60 text-lg">{project.prompt}</p>
          )}
        </div>

        {/* Project Info Card */}
        <div className="rounded-xl border border-white/10 bg-black/20 backdrop-blur-xl p-6 mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              {project.name ? (
                <>
                  <h2 className="text-2xl font-semibold text-white mb-2">{project.name}</h2>
                  <p className="text-white/60 text-sm mb-1">{project.prompt}</p>
                </>
              ) : (
                <h2 className="text-2xl font-semibold text-white mb-2">{project.prompt}</h2>
              )}
              <p className="text-white/50 capitalize">{project.category.replace('_', ' ')}</p>
            </div>
            <span className="px-3 py-1 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-sm font-medium capitalize">
              {project.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            <div>
              <p className="text-sm text-white/50 mb-1">Duration</p>
              <p className="text-white font-medium">{project.duration} seconds</p>
            </div>
            <div>
              <p className="text-sm text-white/50 mb-1">Created</p>
              <p className="text-white font-medium">
                {new Date(project.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Video Generation Section */}
        <div className="rounded-xl border border-white/10 bg-black/20 backdrop-blur-xl p-6 mb-6 animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <h3 className="text-lg font-semibold text-white mb-4">Video Generation</h3>
          
          {project.status === 'draft' && (
            <div>
              <p className="text-white/60 mb-4">
                Ready to generate your video? Click the button below to start the generation process.
              </p>
              <button
                onClick={handleGenerateVideo}
                disabled={generating}
                className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-3 rounded-lg font-medium hover:shadow-lg hover:shadow-blue-500/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Starting...' : 'Generate Video'}
              </button>
            </div>
          )}

          {(project.status === 'generating' || generating) && jobId && (
            <div>
              <p className="text-white/60 mb-4">Video generation in progress...</p>
              <ProgressIndicator
                jobId={jobId}
                onComplete={async () => {
                  setGenerating(false);
                  alert('Video generation completed!');
                  await fetchProject(); // Refresh to show completed status
                }}
                onError={(error) => {
                  setGenerating(false);
                  alert(`Generation failed: ${error}`);
                }}
              />
            </div>
          )}

          {project.status === 'completed' && (
            <div>
              <p className="text-green-400 mb-4">✅ Video generation completed!</p>
              {project.config?.videoUrl && (
                <div className="flex gap-4">
                  {/* Scene Tiles - Left Side */}
                  <div className="w-48 flex-shrink-0 space-y-2">
                    <h4 className="text-sm font-semibold text-white/70 mb-2">Scenes</h4>
                    
                    {/* Final Video Tile */}
                    <button
                      onClick={() => handleVideoSelect(project.config!.videoUrl!, 'final')}
                      className={`w-full aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                        selectedVideoType === 'final'
                          ? 'border-blue-500 ring-2 ring-blue-500/50'
                          : 'border-white/20 hover:border-white/40'
                      }`}
                    >
                      <div className="relative w-full h-full bg-black/50 flex items-center justify-center">
                        {project.config?.videoUrl ? (
                          <video
                            src={project.config.videoUrl}
                            className="w-full h-full object-cover"
                            muted
                            onMouseEnter={(e) => e.currentTarget.play()}
                            onMouseLeave={(e) => {
                              e.currentTarget.pause();
                              e.currentTarget.currentTime = 0;
                            }}
                          />
                        ) : (
                          <Film className="w-8 h-8 text-white/50" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2">
                          <span className="text-xs text-white font-medium">Final Video</span>
                        </div>
                        {selectedVideoType === 'final' && (
                          <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                            <Play className="w-6 h-6 text-blue-400" fill="currentColor" />
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Scene Tiles */}
                    {scenes.map((scene) => (
                      <button
                        key={scene.id}
                        onClick={() => handleVideoSelect(scene.videoUrl, 'scene', scene.sceneNumber)}
                        className={`w-full aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                          selectedVideoType === 'scene' && selectedSceneNumber === scene.sceneNumber
                            ? 'border-blue-500 ring-2 ring-blue-500/50'
                            : 'border-white/20 hover:border-white/40'
                        }`}
                      >
                        <div className="relative w-full h-full bg-black/50 flex items-center justify-center">
                          {scene.firstFrameUrl ? (
                            <img
                              src={scene.firstFrameUrl}
                              alt={`Scene ${scene.sceneNumber}`}
                              className="w-full h-full object-cover"
                            />
                          ) : scene.videoUrl ? (
                            <video
                              src={scene.videoUrl}
                              className="w-full h-full object-cover"
                              muted
                              onMouseEnter={(e) => e.currentTarget.play()}
                              onMouseLeave={(e) => {
                                e.currentTarget.pause();
                                e.currentTarget.currentTime = 0;
                              }}
                            />
                          ) : (
                            <Film className="w-8 h-8 text-white/50" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-2">
                            <span className="text-xs text-white font-medium">Scene {scene.sceneNumber}</span>
                          </div>
                          {selectedVideoType === 'scene' && selectedSceneNumber === scene.sceneNumber && (
                            <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                              <Play className="w-6 h-6 text-blue-400" fill="currentColor" />
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Video Player - Right Side */}
                  <div className="flex-1">
                    {selectedVideoUrl ? (
                      <div className="space-y-4">
                        <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-black">
                          <video
                            ref={videoRef}
                            src={selectedVideoUrl}
                            controls
                            className="w-full h-full"
                            key={selectedVideoUrl} // Force re-render on URL change
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-white font-medium">
                              {selectedVideoType === 'final' 
                                ? 'Final Video' 
                                : `Scene ${selectedSceneNumber}`}
                            </h4>
                            {selectedVideoType === 'scene' && selectedSceneNumber && (
                              <p className="text-sm text-white/60 mt-1">
                                {scenes.find(s => s.sceneNumber === selectedSceneNumber)?.prompt || ''}
                              </p>
                            )}
                          </div>
                          <a
                            href={selectedVideoUrl}
                            download
                            className="inline-block bg-gradient-to-r from-blue-500 to-purple-500 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-600 transition-all shadow-lg shadow-blue-500/30 text-sm"
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="aspect-video rounded-lg border border-white/10 bg-black/50 flex items-center justify-center">
                        <p className="text-white/50">Select a scene or final video to play</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {project.status === 'failed' && (
            <div>
              <p className="text-red-400 mb-4">❌ Video generation failed. Please try again.</p>
              <button
                onClick={handleGenerateVideo}
                className="bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-3 rounded-lg font-medium hover:from-blue-600 hover:to-purple-600 transition-all shadow-lg shadow-blue-500/30"
              >
                Retry Generation
              </button>
            </div>
          )}
        </div>

        {/* Project Details */}
        <div className="rounded-xl border border-white/10 bg-black/20 backdrop-blur-xl p-6 animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <h3 className="text-lg font-semibold text-white mb-4">Project Details</h3>
          <div className="space-y-2 text-white/60">
            <p><strong className="text-white">Category:</strong> {project.category.replace('_', ' ')}</p>
            <p><strong className="text-white">Mode:</strong> {project.mode || 'classic'}</p>
            <p><strong className="text-white">Prompt:</strong> {project.prompt}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  return (
    <ProtectedRoute>
      <ProjectContent />
    </ProtectedRoute>
  );
}

