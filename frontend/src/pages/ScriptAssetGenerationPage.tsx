import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { Header } from "../components/Header";
import { FileText, Image, Video, Music, Sparkles, CheckCircle2, Loader2, ArrowRight } from "lucide-react";

interface Project {
  id: string;
  name?: string;
  prompt: string;
  category: string;
}

function ScriptAssetGenerationContent() {
  const { id } = useParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<'script' | 'assets' | 'complete'>('script');
  const [script, setScript] = useState<string>("");
  const [generatedAssets, setGeneratedAssets] = useState<Array<{ type: string; url: string; description: string }>>([]);

  useEffect(() => {
    if (id) {
      loadProject();
    }
  }, [id]);

  const loadProject = async () => {
    try {
      const token = await getAccessToken();
      const data = await apiRequest<Project>(`/api/projects/${id}`, { method: 'GET' }, token);
      setProject(data);
    } catch (error) {
      console.error('Error loading project:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateScript = async () => {
    if (!project) return;
    
    setGenerating(true);
    setGenerationStep('script');
    
    try {
      const token = await getAccessToken();
      
      // Generate script using chat API
      const response = await apiRequest<{ response: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: `Generate a detailed video script for this project: ${project.prompt}. Include scene descriptions, timing, and visual elements. Format it as a structured script with scene numbers.`,
          projectId: id,
          model: 'openai/gpt-4o-mini',
        }),
      }, token);

      setScript(response.response);
      setGenerationStep('assets');
      
      // Auto-generate assets after script
      setTimeout(() => {
        handleGenerateAssets(response.response);
      }, 1000);
    } catch (error) {
      console.error('Error generating script:', error);
      alert('Failed to generate script. Please try again.');
      setGenerating(false);
    }
  };

  const handleGenerateAssets = async (scriptContent?: string) => {
    if (!project) return;
    
    setGenerating(true);
    setGenerationStep('assets');
    
    try {
      const token = await getAccessToken();
      const scriptToUse = scriptContent || script;
      
      // Generate asset suggestions using chat API
      const response = await apiRequest<{ response: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: `Based on this video script: ${scriptToUse}, suggest 5-10 assets (images, videos, or audio) that would be useful for this project. List them with descriptions.`,
          projectId: id,
          model: 'openai/gpt-4o-mini',
        }),
      }, token);

      // Parse asset suggestions (simplified - in production, you'd parse this better)
      const assetDescriptions = response.response.split('\n').filter(line => 
        line.trim() && (line.includes('image') || line.includes('video') || line.includes('audio') || line.includes('asset'))
      );

      setGeneratedAssets(assetDescriptions.map((desc, idx) => ({
        type: desc.toLowerCase().includes('audio') ? 'audio' : desc.toLowerCase().includes('video') ? 'video' : 'image',
        url: '', // Would be generated or uploaded
        description: desc.trim(),
      })));

      setGenerationStep('complete');
    } catch (error) {
      console.error('Error generating assets:', error);
      alert('Failed to generate assets. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleContinueToEditor = () => {
    navigate(`/project/${id}/edit`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900">
        <Header />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-4" />
            <p className="text-white/60">Loading project...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900">
        <Header />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <p className="text-white/60 mb-4">Project not found</p>
            <Link to="/dashboard" className="text-blue-400 hover:underline">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900">
      <Header />
      
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link to="/dashboard" className="text-white/60 hover:text-white inline-block mb-4">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">
            Generate Script & Assets
          </h1>
          <p className="text-white/60">{project.name || project.prompt}</p>
        </div>

        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-between max-w-2xl">
          {[
            { key: 'script', label: 'Script', icon: FileText },
            { key: 'assets', label: 'Assets', icon: Image },
            { key: 'complete', label: 'Ready', icon: CheckCircle2 },
          ].map((step, idx) => {
            const Icon = step.icon;
            const isActive = generationStep === step.key;
            const isCompleted = 
              (step.key === 'script' && script) ||
              (step.key === 'assets' && generatedAssets.length > 0) ||
              (step.key === 'complete' && generationStep === 'complete');
            
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                      isCompleted
                        ? "bg-green-500 text-white"
                        : isActive
                        ? "bg-blue-500 text-white"
                        : "bg-white/10 text-white/40"
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : generating && isActive ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (
                      <Icon className="w-6 h-6" />
                    )}
                  </div>
                  <span className={`mt-2 text-sm ${isActive || isCompleted ? "text-white" : "text-white/40"}`}>
                    {step.label}
                  </span>
                </div>
                {idx < 2 && (
                  <div
                    className={`h-1 flex-1 mx-2 transition-all ${
                      isCompleted ? "bg-green-500" : "bg-white/10"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Script Generation Section */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <FileText className="w-6 h-6 text-blue-400" />
              <h2 className="text-xl font-semibold text-white">Video Script</h2>
            </div>
            {!script && (
              <button
                onClick={handleGenerateScript}
                disabled={generating}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Generate Script
              </button>
            )}
          </div>

          {script ? (
            <div className="bg-black/20 rounded-lg p-4 max-h-96 overflow-y-auto">
              <pre className="text-white/80 text-sm whitespace-pre-wrap font-mono">
                {script}
              </pre>
            </div>
          ) : (
            <div className="text-center py-12 text-white/40">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Click "Generate Script" to create a video script based on your project description</p>
            </div>
          )}
        </div>

        {/* Asset Generation Section */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Image className="w-6 h-6 text-purple-400" />
              <h2 className="text-xl font-semibold text-white">Suggested Assets</h2>
            </div>
            {script && !generatedAssets.length && generationStep !== 'assets' && (
              <button
                onClick={() => handleGenerateAssets()}
                disabled={generating}
                className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Generate Assets
              </button>
            )}
          </div>

          {generatedAssets.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {generatedAssets.map((asset, idx) => {
                const Icon = asset.type === 'audio' ? Music : asset.type === 'video' ? Video : Image;
                return (
                  <div
                    key={idx}
                    className="bg-black/20 rounded-lg p-4 border border-white/10"
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-white/10">
                        <Icon className="w-5 h-5 text-white/70" />
                      </div>
                      <div className="flex-1">
                        <p className="text-white/80 text-sm">{asset.description}</p>
                        <span className="text-xs text-white/40 mt-1 inline-block capitalize">
                          {asset.type}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : generationStep === 'assets' ? (
            <div className="text-center py-12 text-white/40">
              <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin opacity-50" />
              <p>Generating asset suggestions...</p>
            </div>
          ) : (
            <div className="text-center py-12 text-white/40">
              <Image className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Generate a script first, then we'll suggest assets for your video</p>
            </div>
          )}
        </div>

        {/* Continue Button */}
        {generationStep === 'complete' && (
          <div className="flex justify-end">
            <button
              onClick={handleContinueToEditor}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:shadow-lg hover:shadow-blue-500/30 transition-all flex items-center gap-2 font-semibold"
            >
              Continue to Editor
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScriptAssetGenerationPage() {
  return (
    <ProtectedRoute>
      <ScriptAssetGenerationContent />
    </ProtectedRoute>
  );
}

