import { X, CheckCircle2, AlertCircle, Sparkles, Loader2, ArrowLeft, FileText, Pencil, Check } from 'lucide-react';
import { useState, useEffect } from 'react';

interface ProjectConfirmationModalProps {
  isOpen: boolean;
  projectData: {
    name: string;
    category: string;
    prompt: string;
    duration: number;
    style: string;
    mood: string;
    aspectRatio: string;
    colorPalette: string;
    pacing: string;
    costPerSecond: number;
  };
  onGenerateScript: () => Promise<void>;
  onConfirmScript: () => Promise<void>;
  onCancel: () => void;
  onBack?: () => void;
  modalStep?: 'confirm' | 'script' | 'generating' | 'completed';
  isGeneratingScript?: boolean;
  isProcessing?: boolean;
  progress?: number;
  currentStage?: string;
  generatedScript?: string;
  editedScript?: string;
  onScriptChange?: (script: string) => void;
  onPromptChange?: (prompt: string) => void;
  expectedSceneCount,
  generationResult?: {
    videoUrl: string;
    sceneUrls: string[];
    frameUrls: Array<{ first: string; last: string }>;
  } | null;
  error?: string | null;
}

export function ProjectConfirmationModal({
  isOpen,
  projectData,
  onGenerateScript,
  onConfirmScript,
  onCancel,
  onBack,
  modalStep = 'confirm',
  isGeneratingScript = false,
  isProcessing = false,
  progress = 0,
  currentStage = '',
  generatedScript = '',
  editedScript = '',
  onScriptChange,
  onPromptChange,
  expectedSceneCount = undefined,
  generationResult = null,
  error = null,
}: ProjectConfirmationModalProps) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(projectData.prompt);
  const [promptError, setPromptError] = useState<string | null>(null);

  // Update editedPrompt when projectData.prompt changes
  useEffect(() => {
    if (!isEditingPrompt) {
      setEditedPrompt(projectData.prompt);
    }
  }, [projectData.prompt, isEditingPrompt]);

  if (!isOpen) return null;

  const handleStartEditPrompt = () => {
    setEditedPrompt(projectData.prompt);
    setIsEditingPrompt(true);
    setPromptError(null);
  };

  const handleSavePrompt = () => {
    if (editedPrompt.trim().length < 10) {
      setPromptError('Prompt must be at least 10 characters long. Please add more details to your prompt.');
      return;
    }
    onPromptChange?.(editedPrompt);
    setIsEditingPrompt(false);
    setPromptError(null);
  };

  const handleCancelEditPrompt = () => {
    setEditedPrompt(projectData.prompt);
    setIsEditingPrompt(false);
    setPromptError(null);
  };

  // Format script JSON into human-readable format
  const formatScriptForDisplay = (scriptText: string): string => {
    if (!scriptText) return '';
    
    try {
      const script = JSON.parse(scriptText);
      let formatted = '';
      
      // Overall Prompt
      if (script.overallPrompt) {
        formatted += `📝 OVERALL PROMPT\n`;
        formatted += `${script.overallPrompt}\n\n`;
      }
      
      // Parsed Prompt Details
      if (script.parsedPrompt) {
        formatted += `🎨 STYLE & MOOD\n`;
        if (script.parsedPrompt.style) {
          formatted += `Style: ${script.parsedPrompt.style}\n`;
        }
        if (script.parsedPrompt.mood) {
          formatted += `Mood: ${script.parsedPrompt.mood}\n`;
        }
        if (script.parsedPrompt.duration) {
          formatted += `Duration: ${script.parsedPrompt.duration} seconds\n`;
        }
        if (script.parsedPrompt.keywords && script.parsedPrompt.keywords.length > 0) {
          formatted += `Keywords: ${script.parsedPrompt.keywords.join(', ')}\n`;
        }
        formatted += `\n`;
      }
      
      // Scenes
      if (script.scenes && Array.isArray(script.scenes)) {
        formatted += `🎬 SCENES (${script.scenes.length} total)\n\n`;
        script.scenes.forEach((scene: any, index: number) => {
          formatted += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          formatted += `SCENE ${scene.sceneNumber || index + 1}\n`;
          formatted += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          formatted += `⏱️  Duration: ${scene.duration?.toFixed(1) || 'N/A'} seconds\n`;
          if (scene.startTime !== undefined && scene.endTime !== undefined) {
            formatted += `⏰ Time: ${scene.startTime.toFixed(1)}s - ${scene.endTime.toFixed(1)}s\n`;
          }
          formatted += `\n📋 Prompt:\n${scene.prompt || 'N/A'}\n\n`;
        });
      }
      
      return formatted.trim();
    } catch (e) {
      // If not valid JSON, return as-is
      return scriptText;
    }
  };

  // Intelligent detection: Check if prompt is already a script (JSON format with scenes)
  const isScriptFormat = (text: string): boolean => {
    if (!text || text.trim().length === 0) return false;
    try {
      const parsed = JSON.parse(text);
      // Check if it has script-like structure (scenes array, overallPrompt, etc.)
      return (
        (parsed.scenes && Array.isArray(parsed.scenes)) ||
        (parsed.overallPrompt && parsed.parsedPrompt) ||
        (parsed.sceneNumber !== undefined)
      );
    } catch {
      // Not JSON, check for script-like patterns
      return /"sceneNumber"|"scenes"\s*:|"overallPrompt"|"parsedPrompt"/.test(text);
    }
  };

  const hasScript = isScriptFormat(projectData.prompt) || isScriptFormat(generatedScript) || isScriptFormat(editedScript);
  const hasPrompt = projectData.prompt && projectData.prompt.trim().length > 0 && !hasScript;

  const estimatedCost = (projectData.costPerSecond * projectData.duration).toFixed(2);
  const isCompleted = generationResult !== null && generationResult.videoUrl;
  const isFailed = error !== null && modalStep !== 'confirm';
  const canClose = isCompleted || (isFailed && modalStep !== 'confirm') || (modalStep === 'confirm' && !isGeneratingScript);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && canClose) {
          onCancel();
        }
      }}
    >
      {/* Animated background overlay */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-purple-950/20 to-pink-950/20 animate-gradient-shift" />
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
      }} />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float-delayed" />

      <div className="relative bg-black/20 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-8 pb-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-white/10 ${isProcessing || isGeneratingScript ? 'animate-pulse' : 'animate-pulse-slow'}`}>
              {isProcessing || isGeneratingScript ? (
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              ) : isCompleted ? (
                <CheckCircle2 className="w-6 h-6 text-green-400" />
              ) : isFailed ? (
                <AlertCircle className="w-6 h-6 text-red-400" />
              ) : modalStep === 'script' ? (
                <FileText className="w-6 h-6 text-blue-400" />
              ) : (
                <Sparkles className="w-6 h-6 text-blue-400" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-white">
              {modalStep === 'generating' ? 'Generating Your Video...' : 
               modalStep === 'script' ? 'Review & Edit Script' :
               isCompleted ? 'Video Created Successfully!' : 
               isFailed ? 'Creation Failed' : 
               'Confirm Project Creation'}
            </h2>
          </div>
          {canClose && (
            <button
              onClick={onCancel}
              className="text-white/70 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Progress Bar */}
        {(isProcessing || isGeneratingScript) && (
          <div className="mb-8 space-y-3">
            <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            {currentStage && (
              <p className="text-sm text-white/70 text-center">{currentStage}</p>
            )}
            {isGeneratingScript && !currentStage && (
              <p className="text-sm text-white/70 text-center">Generating script and scene breakdown...</p>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && modalStep === 'confirm' && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-red-400 mb-2">
              <AlertCircle className="w-5 h-5" />
              <p className="font-semibold">Error</p>
            </div>
            <p className="text-sm text-white/80">{error}</p>
          </div>
        )}
        {isFailed && modalStep !== 'confirm' && error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-red-400 mb-2">
              <AlertCircle className="w-5 h-5" />
              <p className="font-semibold">Error</p>
            </div>
            <p className="text-sm text-white/80">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {isCompleted && (
          <div className="mb-8 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
            <div className="flex items-center gap-2 text-green-400 mb-2">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-semibold">Video Generated Successfully!</p>
            </div>
            {generationResult?.videoUrl && (
              <div className="mt-4">
                <video
                  src={generationResult.videoUrl}
                  controls
                  className="w-full rounded-lg border border-white/10"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 1: Confirm Project Details */}
        {modalStep === 'confirm' && (
          <div className="space-y-6 mb-8">
            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-5 border border-white/10">
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-white/50 mb-1 uppercase tracking-wide">Project Name</p>
                  <p className="text-lg font-semibold text-white">{projectData.name}</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-white/50 mb-1 uppercase tracking-wide">Category</p>
                    <p className="text-white/90 font-medium capitalize">{projectData.category.replace('_', ' ')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/50 mb-1 uppercase tracking-wide">Duration</p>
                    <p className="text-white/90 font-medium">{projectData.duration} seconds</p>
                  </div>
                </div>

                {expectedSceneCount && (
                  <div className="pt-4 border-t border-white/10">
                    <p className="text-xs text-white/50 mb-1 uppercase tracking-wide">Expected Scenes</p>
                    <p className="text-lg font-semibold text-white">
                      {expectedSceneCount.min === expectedSceneCount.max 
                        ? `${expectedSceneCount.min} scene${expectedSceneCount.min !== 1 ? 's' : ''}`
                        : `${expectedSceneCount.min}-${expectedSceneCount.max} scenes`}
                    </p>
                    <p className="text-xs text-white/50 mt-1">
                      Based on duration and content complexity
                    </p>
                  </div>
                )}

                {projectData.costPerSecond !== undefined && (
                  <div className="pt-4 border-t border-white/10">
                    <p className="text-xs text-white/50 mb-1 uppercase tracking-wide">Estimated Cost</p>
                    <p className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                      ${estimatedCost}
                    </p>
                    <p className="text-xs text-white/50 mt-1">
                      ${projectData.costPerSecond} per second × {projectData.duration} seconds
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-5 border border-white/10">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-white/50 uppercase tracking-wide">Prompt</p>
                {!isEditingPrompt && (
                  <button
                    onClick={handleStartEditPrompt}
                    className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Edit prompt"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
              {isEditingPrompt ? (
                <div className="space-y-3">
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => {
                      setEditedPrompt(e.target.value);
                      if (e.target.value.trim().length < 10) {
                        setPromptError('Prompt must be at least 10 characters long. Please add more details to your prompt.');
                      } else {
                        setPromptError(null);
                      }
                    }}
                    className="w-full h-48 px-4 py-3 rounded-lg border border-white/20 bg-black/40 backdrop-blur-sm text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                    placeholder="Enter your prompt..."
                  />
                  {promptError && (
                    <div className="flex items-start gap-2 text-red-400 text-sm p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>{promptError}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">
                      {editedPrompt.length} character{editedPrompt.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={handleCancelEditPrompt}
                        className="px-3 py-1.5 text-sm rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSavePrompt}
                        disabled={!!promptError || editedPrompt.trim().length < 10}
                        className="px-3 py-1.5 text-sm rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        title={editedPrompt.trim().length < 10 ? 'Prompt must be at least 10 characters' : ''}
                      >
                        <Check className="w-4 h-4" />
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-white/80 leading-relaxed whitespace-pre-wrap">{projectData.prompt}</p>
                  <p className="text-xs text-white/40 mt-2 text-right">
                    {projectData.prompt.length} character{projectData.prompt.length !== 1 ? 's' : ''}
                  </p>
                </div>
              )}
            </div>

            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-5 border border-white/10">
              <p className="text-xs text-white/50 mb-4 uppercase tracking-wide">Settings</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-white/50 mb-1">Style</p>
                  <p className="text-white/90 font-medium capitalize">{projectData.style}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50 mb-1">Mood</p>
                  <p className="text-white/90 font-medium capitalize">{projectData.mood}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50 mb-1">Aspect Ratio</p>
                  <p className="text-white/90 font-medium">{projectData.aspectRatio}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50 mb-1">Color Palette</p>
                  <p className="text-white/90 font-medium capitalize">{projectData.colorPalette}</p>
                </div>
                <div>
                  <p className="text-xs text-white/50 mb-1">Pacing</p>
                  <p className="text-white/90 font-medium capitalize">{projectData.pacing}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Script Review & Edit */}
        {modalStep === 'script' && generatedScript && (
          <div className="space-y-6 mb-8">
            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-5 border border-white/10">
              <p className="text-xs text-white/50 mb-3 uppercase tracking-wide">Generated Script & Scene Breakdown</p>
              <p className="text-sm text-white/60 mb-4">Review and edit the script below. Your changes will be used for video generation.</p>
              <div className="relative">
                <textarea
                  value={editedScript}
                  onChange={(e) => onScriptChange?.(e.target.value)}
                  className="w-full h-96 px-4 py-3 rounded-lg border border-white/20 bg-black/40 backdrop-blur-sm text-white text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  placeholder="Script will appear here..."
                />
                <div className="absolute top-2 right-2 flex gap-2">
                  <button
                    onClick={() => {
                      const formatted = formatScriptForDisplay(editedScript);
                      onScriptChange?.(formatted);
                    }}
                    className="px-2 py-1 text-xs rounded border border-white/20 bg-black/60 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/80 transition-colors"
                    title="Format as readable text"
                  >
                    Format
                  </button>
                  <button
                    onClick={() => {
                      // If we have the original generatedScript (JSON), show that
                      // Otherwise try to parse current editedScript
                      if (generatedScript) {
                        try {
                          const parsed = JSON.parse(generatedScript);
                          onScriptChange?.(JSON.stringify(parsed, null, 2));
                        } catch {
                          onScriptChange?.(generatedScript);
                        }
                      } else {
                        try {
                          const parsed = JSON.parse(editedScript);
                          onScriptChange?.(JSON.stringify(parsed, null, 2));
                        } catch {
                          // If not JSON, show formatted version
                          const formatted = formatScriptForDisplay(editedScript);
                          onScriptChange?.(formatted);
                        }
                      }
                    }}
                    className="px-2 py-1 text-xs rounded border border-white/20 bg-black/60 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/80 transition-colors"
                    title="Show as JSON"
                  >
                    JSON
                  </button>
                </div>
              </div>
              <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-xs text-blue-300 mb-2 font-medium">💡 Tip:</p>
                <p className="text-xs text-blue-200/80">
                  The script is shown in a readable format. You can edit it directly. Click "Format" to convert to readable text or "JSON" to view/edit as JSON.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Video Generation Progress */}
        {modalStep === 'generating' && isProcessing && (
          <div className="space-y-6 mb-8">
            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-5 border border-white/10 text-center">
              <p className="text-white/80 text-lg mb-2">Video generation in progress...</p>
              <p className="text-white/60 text-sm">This may take a few minutes. Please don't close this window.</p>
            </div>
          </div>
        )}

        {/* Footer Buttons */}
        {modalStep === 'confirm' && (
          <div className="flex justify-end gap-4 pt-6 border-t border-white/10">
            <button
              onClick={onCancel}
              className="px-6 py-3 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors font-medium backdrop-blur-sm"
            >
              Cancel
            </button>
            {/* Always show both options - user's choice */}
            <div className="flex gap-3">
              {error ? (
                <button
                  onClick={onGenerateScript}
                  disabled={isGeneratingScript}
                  className="px-6 py-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold hover:from-orange-600 hover:to-red-600 transition-all shadow-lg shadow-orange-500/30 flex items-center gap-2 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-5 h-5" />
                  Retry Generate Script
                </button>
              ) : (
                <button
                  onClick={onGenerateScript}
                  disabled={isGeneratingScript}
                  className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white font-semibold hover:from-blue-600 hover:via-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-5 h-5" />
                  Generate Script
                </button>
              )}
              
              {/* Always show Generate Video button - can generate from prompt or script */}
              <button
                onClick={onConfirmScript}
                disabled={isProcessing || (!hasScript && !hasPrompt)}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold hover:from-green-600 hover:to-emerald-600 transition-all shadow-lg shadow-green-500/30 flex items-center gap-2 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
                title={!hasScript && !hasPrompt ? "Enter a prompt to generate video" : hasScript ? "Generate video from script" : "Generate video directly from prompt"}
              >
                <CheckCircle2 className="w-5 h-5" />
                Generate Video
              </button>
            </div>
          </div>
        )}

        {modalStep === 'script' && (
          <div className="flex justify-between gap-4 pt-6 border-t border-white/10">
            <button
              onClick={onBack}
              className="px-6 py-3 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors font-medium backdrop-blur-sm flex items-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Back
            </button>
            <div className="flex gap-4">
              <button
                onClick={onCancel}
                className="px-6 py-3 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors font-medium backdrop-blur-sm"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmScript}
                disabled={isProcessing}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white font-semibold hover:from-blue-600 hover:via-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-5 h-5" />
                Confirm & Generate Video
              </button>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="flex justify-end gap-4 pt-6 border-t border-white/10">
            <button
              onClick={onCancel}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white font-semibold hover:from-blue-600 hover:via-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-blue-500/30"
            >
              Close & Go to Dashboard
            </button>
          </div>
        )}

        {isFailed && modalStep !== 'confirm' && (
          <div className="flex justify-end gap-4 pt-6 border-t border-white/10">
            <button
              onClick={onCancel}
              className="px-6 py-3 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors font-medium backdrop-blur-sm"
            >
              Close
            </button>
            <button
              onClick={onConfirmScript}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white font-semibold hover:from-blue-600 hover:via-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-blue-500/30 flex items-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
