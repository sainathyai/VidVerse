import { useState, useRef, useEffect } from 'react';
import { X, Send, Loader2, Sparkles, CheckCircle2, FileText, Image as ImageIcon, Video as VideoIcon, Music, Clock } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from './auth/AuthProvider';
import { extractProjectJSON, normalizeProjectData, validateProjectData } from '../lib/projectImport';

interface QuickCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportProject: (projectData: {
    script?: string;
    assets?: Array<{ name: string; prompt: string }>;
    scenes?: Array<{ sceneNumber: number; prompt: string; assetIds: string[] }>;
    music?: { lyrics?: string; prompt?: string; bitrate?: string; sample_rate?: string; audio_format?: string };
  }) => void;
  onNavigateToCreate: () => void;
}

export function QuickCreateModal({ isOpen, onClose, onImportProject, onNavigateToCreate }: QuickCreateModalProps) {
  const [concept, setConcept] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiResponse, setAiResponse] = useState<string>('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [projectData, setProjectData] = useState<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { getAccessToken } = useAuth();

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const handleProceed = async () => {
    if (!concept.trim()) {
      alert('Please enter a concept for your video');
      return;
    }

    setIsGenerating(true);
    setAiResponse('');
    setShowReview(false);
    setProjectData(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      // Create a message that triggers concept generation
      const message = `Generate a complete script for this concept: ${concept.trim()}`;

      const response = await apiRequest<{ response: string; conversationId: string }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          model: 'anthropic/claude-4.5-sonnet',
          conversationId: conversationId || undefined,
        }),
      }, token);

      if (response.response) {
        setAiResponse(response.response);
        setConversationId(response.conversationId || null);
        
        // Try to extract project JSON from the response
        try {
          const extracted = extractProjectJSON(response.response);
          if (extracted) {
            const normalized = normalizeProjectData(extracted);
            if (validateProjectData(normalized)) {
              setProjectData(normalized);
              setShowReview(true);
            }
          }
        } catch (error) {
          console.error('Error parsing project data:', error);
          // Still show the response even if JSON parsing fails
          setShowReview(true);
        }
      }
    } catch (error: any) {
      console.error('Error generating project:', error);
      alert(`Failed to generate project: ${error.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleImport = () => {
    if (projectData) {
      onImportProject(projectData);
      // Close modal and navigate to create page
      onClose();
      onNavigateToCreate();
    } else {
      alert('No project data to import. Please try generating again.');
    }
  };

  const handleClose = () => {
    setConcept('');
    setAiResponse('');
    setShowReview(false);
    setProjectData(null);
    setConversationId(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl rounded-2xl border border-white/20 shadow-2xl shadow-purple-500/30 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-black/20 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Quick Create</h2>
              <p className="text-sm text-white/60">Describe your video concept</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {!showReview ? (
            /* Input Phase */
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/90 mb-2">
                  Video Concept
                </label>
                <textarea
                  ref={textareaRef}
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="E.g., A cinematic advertisement for luxury sunglasses featuring urban landscapes, modern aesthetics, and dynamic camera movements..."
                  className="w-full h-32 px-4 py-3 bg-black/40 backdrop-blur-sm border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 focus:shadow-lg focus:shadow-blue-500/20 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleProceed();
                    }
                  }}
                />
                <p className="mt-2 text-xs text-white/50">
                  Press Cmd/Ctrl + Enter to proceed
                </p>
                {concept.trim() && (
                  <div className="mt-3 flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <Clock className="w-4 h-4 text-blue-400" />
                    <p className="text-xs text-blue-300">
                      This will take up to 2 minutes to generate your script
                    </p>
                  </div>
                )}
              </div>

              {isGenerating && (
                <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                  <span className="text-sm text-white/80">Generating script...</span>
                </div>
              )}

              {aiResponse && !showReview && (
                <div className="p-4 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 backdrop-blur-sm border border-white/10 rounded-lg">
                  <p className="text-sm text-white/80 whitespace-pre-wrap">{aiResponse}</p>
                </div>
              )}
            </div>
          ) : (
            /* Review Phase */
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span className="text-sm font-medium text-green-400">Project Generated Successfully!</span>
              </div>

              {projectData && (
                <div className="space-y-3">
                  {/* Script Preview */}
                  {projectData.script && (
                    <div className="p-4 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 backdrop-blur-sm border border-white/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-4 h-4 text-blue-400" />
                        <span className="text-sm font-medium text-white">Script</span>
                      </div>
                      <p className="text-xs text-white/60 line-clamp-3">{projectData.script.substring(0, 200)}...</p>
                    </div>
                  )}

                  {/* Assets Preview */}
                  {projectData.assets && projectData.assets.length > 0 && (
                    <div className="p-4 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 backdrop-blur-sm border border-white/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <ImageIcon className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-medium text-white">
                          {projectData.assets.length} Asset{projectData.assets.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {projectData.assets.slice(0, 3).map((asset: any, idx: number) => (
                          <div key={idx} className="text-xs text-white/60">• {asset.name}</div>
                        ))}
                        {projectData.assets.length > 3 && (
                          <div className="text-xs text-white/40">+ {projectData.assets.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Scenes Preview */}
                  {projectData.scenes && projectData.scenes.length > 0 && (
                    <div className="p-4 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 backdrop-blur-sm border border-white/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <VideoIcon className="w-4 h-4 text-pink-400" />
                        <span className="text-sm font-medium text-white">
                          {projectData.scenes.length} Scene{projectData.scenes.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {projectData.scenes.slice(0, 3).map((scene: any, idx: number) => (
                          <div key={idx} className="text-xs text-white/60">
                            Scene {scene.sceneNumber}: {scene.prompt?.substring(0, 60)}...
                          </div>
                        ))}
                        {projectData.scenes.length > 3 && (
                          <div className="text-xs text-white/40">+ {projectData.scenes.length - 3} more scenes</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Music Preview */}
                  {projectData.music && (
                    <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <Music className="w-4 h-4 text-yellow-400" />
                        <span className="text-sm font-medium text-white">Music</span>
                      </div>
                      <p className="text-xs text-white/60">{projectData.music.prompt || 'Music included'}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Full Response (if JSON parsing failed) */}
              {!projectData && aiResponse && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <p className="text-sm text-white/80 whitespace-pre-wrap">{aiResponse}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10 bg-black/20">
          {!showReview ? (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-white/70 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleProceed}
                disabled={!concept.trim() || isGenerating}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Proceed
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  handleClose();
                  onNavigateToCreate();
                }}
                className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium text-sm transition-all flex items-center gap-2 border border-white/20"
              >
                Skip
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setShowReview(false);
                  setProjectData(null);
                }}
                className="px-4 py-2 text-sm text-white/70 hover:text-white transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-lg font-medium text-sm flex items-center gap-2 transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                Import & Continue
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuickCreateModal;

