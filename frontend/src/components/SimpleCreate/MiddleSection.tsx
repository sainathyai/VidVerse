import React from "react";
import { Pencil, Check, X, Image as ImageIcon, Loader2, Plus, Play, Video as VideoIcon, Music, Upload, FileText, Download, Edit3 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { useNavigate } from "react-router-dom";

const MAX_ANCHOR_ASSETS = 5;

type AnchorImage = {
  id: string;
  assetId?: string;
  url: string;
  prompt: string;
  assetNumber: number;
  isTemporary?: boolean;
};

interface Scene {
  id: string;
  prompt: string;
  videoUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  extendPrevious: boolean;
  selectedAssetIds: string[];
  isGenerating: boolean;
}

interface MiddleSectionProps {
  projectName: string;
  isEditingProjectName: boolean;
  tempProjectName: string;
  onProjectNameChange: (name: string) => void;
  onStartEditingProjectName: () => void;
  onSaveProjectName: () => void;
  onCancelEditingProjectName: () => void;
  anchorImagePrompts: string[];
  onAnchorImagePromptChange: (index: number, prompt: string) => void;
  expandedAssetIndex: number | null;
  onExpandedAssetIndexChange: (index: number | null) => void;
  generatedAnchorImages: AnchorImage[];
  isGeneratingAssets: boolean[];
  onGenerateAnchorImage: (assetIndex: number) => Promise<void>;
  onGenerateAllAssets: () => Promise<void>;
  onAddAssetSlot: () => void;
  onRemoveAnchorImage: (image: AnchorImage) => Promise<void>;
  onAnchorImageClick: (index: number) => void;
  scenes: Scene[];
  onScenesChange: (scenes: Scene[]) => void;
  onScenePromptChange: (sceneId: string, prompt: string) => void;
  onSceneExtendPreviousChange: (sceneId: string, extend: boolean) => void;
  onSceneSelectedAssetIdsChange: (sceneId: string, assetIds: string[]) => void;
  onSceneGenerate: (sceneIndex: number, scene: Scene) => Promise<void>;
  onAddScene: () => void;
  onRemoveScene: (sceneId: string) => void;
  onSceneVideoClick: (sceneId: string) => void;
  imageModelId: string;
  aspectRatio: string;
  glassTextareaStyle: React.CSSProperties;
  continuous: boolean;
  onContinuousChange: (continuous: boolean) => void;
  parallel: boolean;
  onParallelChange: (parallel: boolean) => void;
  isGeneratingAll: boolean;
  onGenerateAll: () => Promise<void>;
  onGenerateAllParallel: () => Promise<void>;
  onStitchScenes: () => Promise<void>;
  isStitching: boolean;
  generationProgress?: {
    progress: number;
    currentStage: string;
    jobId: string | null;
    cost: number | null;
  };
  onReorderAssets: (fromIndex: number, toIndex: number) => void;
  musicPrompt: string;
  onMusicPromptChange: (prompt: string) => void;
  generatedMusicUrl: string | null;
  isGeneratingMusic: boolean;
  onGenerateMusic: () => Promise<void>;
  finalVideoUrl: string | null;
  onUploadAsset?: (assetIndex: number, file: File) => Promise<void>;
  onPopulateScenes?: () => void;
  projectId?: string | null;
}

export function MiddleSection({
  projectName,
  isEditingProjectName,
  tempProjectName,
  onProjectNameChange,
  onStartEditingProjectName,
  onSaveProjectName,
  onCancelEditingProjectName,
  anchorImagePrompts,
  onAnchorImagePromptChange,
  expandedAssetIndex,
  onExpandedAssetIndexChange,
  generatedAnchorImages,
  isGeneratingAssets,
  onGenerateAnchorImage,
  onGenerateAllAssets,
  onAddAssetSlot,
  onRemoveAnchorImage,
  onAnchorImageClick,
  scenes,
  onScenesChange,
  onScenePromptChange,
  onSceneExtendPreviousChange,
  onSceneSelectedAssetIdsChange,
  onSceneGenerate,
  onAddScene,
  onRemoveScene,
  onSceneVideoClick,
  imageModelId,
  aspectRatio,
  glassTextareaStyle,
  continuous,
  onContinuousChange,
  parallel,
  onParallelChange,
  isGeneratingAll,
  onGenerateAll,
  onGenerateAllParallel,
  onStitchScenes,
  isStitching,
  generationProgress,
  onReorderAssets,
  musicPrompt,
  onMusicPromptChange,
  generatedMusicUrl,
  isGeneratingMusic,
  onGenerateMusic,
  finalVideoUrl,
  onUploadAsset,
  onPopulateScenes,
  projectId,
}: MiddleSectionProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [assetBlobUrls, setAssetBlobUrls] = React.useState<Map<string, string>>(new Map());
  const fetchedAssetIdsRef = React.useRef<Set<string>>(new Set());

  // Fetch asset images with credentials and convert to blob URLs
  React.useEffect(() => {
    const fetchAssetImages = async () => {
      const newBlobUrls = new Map<string, string>();
      const assetIdsToFetch = generatedAnchorImages
        .filter(asset => asset.assetId)
        .map(asset => asset.assetId!);
      
      if (assetIdsToFetch.length === 0) {
        return;
      }
      
      const token = await getAccessToken();
      if (!token) {
        return;
      }
      
      // Filter out assets we've already fetched
      const idsToFetch = assetIdsToFetch.filter(assetId => !fetchedAssetIdsRef.current.has(assetId));
      
      if (idsToFetch.length === 0) {
        return;
      }
      
      for (const assetId of idsToFetch) {
        try {
          const response = await fetch(`/api/assets/${assetId}/proxy`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            newBlobUrls.set(assetId, blobUrl);
            fetchedAssetIdsRef.current.add(assetId);
          } else {
            console.error(`[MIDDLE_SECTION] Failed to fetch asset ${assetId}: ${response.status} ${response.statusText}`);
          }
        } catch (error) {
          console.error(`[MIDDLE_SECTION] Failed to fetch asset ${assetId}:`, error);
        }
      }
      
      if (newBlobUrls.size > 0) {
        setAssetBlobUrls(prev => {
          const merged = new Map(prev);
          newBlobUrls.forEach((url, id) => merged.set(id, url));
          return merged;
        });
      }
    };

    fetchAssetImages();

    // Cleanup blob URLs on unmount or when assets change
    return () => {
      // Only revoke URLs that are no longer needed
      setAssetBlobUrls(prev => {
        const currentAssetIds = new Set(generatedAnchorImages
          .filter(asset => asset.assetId)
          .map(asset => asset.assetId!));
        
        const toRevoke: string[] = [];
        prev.forEach((url, id) => {
          if (!currentAssetIds.has(id)) {
            toRevoke.push(url);
            fetchedAssetIdsRef.current.delete(id);
          }
        });
        
        toRevoke.forEach(url => URL.revokeObjectURL(url));
        
        // Return only URLs for current assets
        const kept = new Map<string, string>();
        prev.forEach((url, id) => {
          if (currentAssetIds.has(id)) {
            kept.set(id, url);
          }
        });
        return kept;
      });
    };
  }, [generatedAnchorImages.map(a => a.assetId).filter(Boolean).join(','), getAccessToken]);

  // Helper to get image URL (blob URL if available, otherwise fallback to direct URL)
  const getAssetImageUrl = (asset: AnchorImage): string => {
    if (asset.assetId && assetBlobUrls.has(asset.assetId)) {
      return assetBlobUrls.get(asset.assetId)!;
    }
    return asset.url;
  };
  
  return (
    <div className="flex-1 flex flex-col p-8 animate-fade-in relative" style={{ marginLeft: '2%', marginRight: '10%' }}>
      <div className="w-full">
        {/* Project Name - Top */}
        <div className="flex items-center gap-3 mb-6 animate-slide-in-up">
          {isEditingProjectName ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                type="text"
                value={tempProjectName}
                onChange={(e) => onProjectNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSaveProjectName();
                  } else if (e.key === 'Escape') {
                    onCancelEditingProjectName();
                  }
                }}
                autoFocus
                className="flex-1 px-4 py-2 rounded-lg border border-blue-500/50 bg-black/30 backdrop-blur-sm text-white text-lg font-semibold focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                onClick={onSaveProjectName}
                className="p-2 text-green-400 hover:text-green-300 hover:bg-white/10 rounded-lg transition-colors"
              >
                <Check className="w-5 h-5" />
              </button>
              <button
                onClick={onCancelEditingProjectName}
                className="p-2 text-red-400 hover:text-red-300 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white">
                {projectName || 'Project 1'}
              </h2>
              <button
                onClick={onStartEditingProjectName}
                className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                title="Edit project name"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto max-h-[calc(100vh-200px)] space-y-8 pr-4">
          {/* Assets Section */}
          <div className="bg-gradient-to-br from-black/30 to-black/20 backdrop-blur-xl rounded-xl border border-white/20 shadow-xl shadow-black/20 p-6 space-y-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white">
                Assets {generatedAnchorImages.length > 0 && `(${generatedAnchorImages.length}/${MAX_ANCHOR_ASSETS})`}
              </h3>
            </div>
            
            <div className="grid grid-cols-5 gap-4">
              {/* Asset Display - Show current expanded asset */}
              <div className="space-y-2 col-span-2">
                {(() => {
                  // Find asset by assetNumber (1-based) instead of array index
                  // expandedAssetIndex is 0-based (0, 1, 2, 3, 4), assetNumber is 1-based (1, 2, 3, 4, 5)
                  const assetNumber = expandedAssetIndex !== null ? expandedAssetIndex + 1 : null;
                  const expandedAsset = assetNumber ? generatedAnchorImages.find(img => img.assetNumber === assetNumber) : null;
                  
                  if (!expandedAsset) {
                    return (
                      <div className="aspect-video rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center">
                        <div className="text-center text-white/40">
                          <ImageIcon className="w-8 h-8 mx-auto mb-2" />
                          <p className="text-xs">
                            {expandedAssetIndex !== null ? `Asset ${expandedAssetIndex + 1}` : 'Select an asset to view'}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  
                  return (
                    <div 
                      className="relative aspect-video rounded-lg border border-white/20 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm overflow-hidden hover:border-blue-500/60 hover:shadow-lg hover:shadow-blue-500/20 transition-all cursor-pointer group"
                      style={{ minHeight: '200px', backgroundColor: 'rgba(0,0,0,0.3)' }}
                      data-asset-id={expandedAsset.id}
                      data-asset-number={expandedAsset.assetNumber}
                    >
                      <button
                        type="button"
                        onClick={() => onAnchorImageClick(expandedAssetIndex)}
                        className="w-full h-full relative"
                      >
                        {expandedAsset.url ? (
                          <img
                            key={`asset-img-${expandedAsset.id}-${expandedAsset.url.length}`}
                            src={getAssetImageUrl(expandedAsset)}
                            alt={expandedAsset.prompt || `Asset ${expandedAsset.assetNumber}`}
                            className="w-full h-full object-cover"
                            style={{ display: 'block', minHeight: '200px' }}
                            onError={(e) => {
                              const img = e.currentTarget;
                              console.error(`[MIDDLE_SECTION] ✗ Asset image failed to load:`, {
                                url: expandedAsset.url,
                                assetId: expandedAsset.assetId,
                                src: img.src.substring(0, 100),
                              });
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-red-500/20">
                            <span className="text-white">No URL</span>
                          </div>
                        )}
                      </button>
                      <div className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-xs text-white/90 border border-white/10">
                        <span>Asset {expandedAsset.assetNumber}</span>
                      </div>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await onRemoveAnchorImage(expandedAsset);
                        }}
                        className="absolute top-2 right-2 p-1.5 bg-gradient-to-br from-red-500/90 to-red-600/90 hover:from-red-500 hover:to-red-600 text-white rounded-full text-xs opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm border border-white/20 shadow-lg hover:shadow-xl hover:scale-110 z-20"
                        title="Remove image"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })()}
              </div>
              
              {/* Text Box and Collapsed Assets */}
              <div className="col-span-3 space-y-3">
                {/* Text Box for Expanded Asset - Always at top */}
                {expandedAssetIndex !== null && anchorImagePrompts[expandedAssetIndex] !== undefined ? (
                  <div className="relative">
                    <textarea
                      value={anchorImagePrompts[expandedAssetIndex] || ''}
                      onChange={(e) => {
                        onAnchorImagePromptChange(expandedAssetIndex, e.target.value);
                      }}
                      onBlur={() => {
                        // Don't auto-collapse on blur - let user manually collapse
                      }}
                      placeholder={`Describe Asset ${expandedAssetIndex + 1}...`}
                      rows={3}
                      className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-4 py-3 text-sm text-white placeholder-white/50 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all resize-none shadow-inner"
                      style={glassTextareaStyle}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[100px]">
                    <button
                      type="button"
                      onClick={() => {
                        if (anchorImagePrompts.length === 0) {
                          onAddAssetSlot();
                        }
                        onExpandedAssetIndexChange(0);
                      }}
                      className="px-6 py-3 bg-gradient-to-r from-purple-500/90 to-pink-500/90 text-white rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/50 hover:scale-[1.02] transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      Add First Asset
                    </button>
                  </div>
                )}

                {/* Collapsed Asset Slots - Five columns below text box */}
                <div className="border-t border-white/10 pt-3">
                  <div className="grid grid-cols-5 gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                    {/* Show Assets 1-4 in grid, or all assets if less than 5 */}
                    {anchorImagePrompts.slice(0, anchorImagePrompts.length === MAX_ANCHOR_ASSETS ? MAX_ANCHOR_ASSETS - 1 : anchorImagePrompts.length).map((prompt, index) => {
                      const existingAsset = generatedAnchorImages.find(img => img.assetNumber === index + 1);
                      const isExpanded = expandedAssetIndex === index;
                      const isGenerating = isGeneratingAssets[index] || false;
                      const isDragging = draggedIndex === index;

                      const assetInputId = `asset-upload-${index}`;
                      return (
                        <div key={index} className="relative group">
                          <input
                            id={assetInputId}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0 && onUploadAsset) {
                                onUploadAsset(index, e.target.files[0]);
                                e.target.value = '';
                              }
                            }}
                          />
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setDraggedIndex(index);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', index.toString());
                            }}
                            onDragEnd={() => {
                              setDraggedIndex(null);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                              if (fromIndex !== index && !isNaN(fromIndex)) {
                                onReorderAssets(fromIndex, index);
                              }
                              setDraggedIndex(null);
                            }}
                            onClick={() => {
                              // Collapse previous and expand this one
                              onExpandedAssetIndexChange(index);
                            }}
                            className={`rounded border text-left px-2 py-1.5 text-xs transition-all cursor-move w-full ${
                              isDragging ? 'opacity-50' : ''
                            } ${
                              isExpanded
                                ? 'border-blue-500/60 bg-blue-500/20 text-white'
                                : 'border-white/20 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 text-white/70 hover:text-white hover:border-white/40'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {existingAsset ? (
                                <img
                                  src={getAssetImageUrl(existingAsset)}
                                  alt={`Asset ${index + 1}`}
                                  className="w-6 h-6 rounded object-cover flex-shrink-0"
                                  onError={(e) => {
                                    const img = e.currentTarget;
                                    console.error(`[MIDDLE_SECTION] ✗ Thumbnail image failed to load:`, {
                                      assetId: existingAsset.assetId,
                                      url: existingAsset.url,
                                    });
                                  }}
                                />
                              ) : (
                                <div className="w-6 h-6 rounded border border-white/20 bg-white/5 flex items-center justify-center flex-shrink-0">
                                  <ImageIcon className="w-3 h-3 text-white/40" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">Asset {index + 1}</span>
                                  {isGenerating && (
                                    <Loader2 className="w-2.5 h-2.5 animate-spin text-purple-400 flex-shrink-0" />
                                  )}
                                </div>
                                {prompt.trim() && (
                                  <span className="block truncate text-white/50 text-[10px]">{prompt}</span>
                                )}
                              </div>
                            </div>
                          </button>
                          {/* Upload Icon - Top Right */}
                          {onUploadAsset && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                document.getElementById(assetInputId)?.click();
                              }}
                              className="absolute top-0.5 right-0.5 p-0.5 bg-blue-500/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-blue-500"
                              title="Upload asset"
                            >
                              <Upload className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    
                    {/* Asset 5 - Show in grid if we have 5 assets */}
                    {anchorImagePrompts.length === MAX_ANCHOR_ASSETS && (() => {
                      const index = MAX_ANCHOR_ASSETS - 1;
                      const isDragging = draggedIndex === index;
                      const assetInputId = `asset-upload-${index}`;
                      return (
                        <div key={index} className="relative group">
                          <input
                            id={assetInputId}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0 && onUploadAsset) {
                                onUploadAsset(index, e.target.files[0]);
                                e.target.value = '';
                              }
                            }}
                          />
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              setDraggedIndex(index);
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', index.toString());
                            }}
                            onDragEnd={() => {
                              setDraggedIndex(null);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                              if (fromIndex !== index && !isNaN(fromIndex)) {
                                onReorderAssets(fromIndex, index);
                              }
                              setDraggedIndex(null);
                            }}
                            onClick={() => {
                              onExpandedAssetIndexChange(MAX_ANCHOR_ASSETS - 1);
                            }}
                            className={`rounded border text-left px-2 py-1.5 text-xs transition-all cursor-move w-full ${
                              isDragging ? 'opacity-50' : ''
                            } ${
                              expandedAssetIndex === MAX_ANCHOR_ASSETS - 1
                                ? 'border-blue-500/60 bg-blue-500/20 text-white'
                                : 'border-white/20 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 text-white/70 hover:text-white hover:border-white/40'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {generatedAnchorImages.find(img => img.assetNumber === MAX_ANCHOR_ASSETS) ? (
                                <img
                                  src={generatedAnchorImages.find(img => img.assetNumber === MAX_ANCHOR_ASSETS)!.url}
                                  alt={`Asset ${MAX_ANCHOR_ASSETS}`}
                                  className="w-6 h-6 rounded object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded border border-white/20 bg-white/5 flex items-center justify-center flex-shrink-0">
                                  <ImageIcon className="w-3 h-3 text-white/40" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">Asset {MAX_ANCHOR_ASSETS}</span>
                                  {isGeneratingAssets[MAX_ANCHOR_ASSETS - 1] && (
                                    <Loader2 className="w-2.5 h-2.5 animate-spin text-purple-400 flex-shrink-0" />
                                  )}
                                </div>
                                {anchorImagePrompts[MAX_ANCHOR_ASSETS - 1]?.trim() && (
                                  <span className="block truncate text-white/50 text-[10px]">{anchorImagePrompts[MAX_ANCHOR_ASSETS - 1]}</span>
                                )}
                              </div>
                            </div>
                          </button>
                          {/* Upload Icon - Top Right */}
                          {onUploadAsset && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                document.getElementById(assetInputId)?.click();
                              }}
                              className="absolute top-0.5 right-0.5 p-0.5 bg-blue-500/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-blue-500"
                              title="Upload asset"
                            >
                              <Upload className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      );
                    })()}
                    
                    {/* Plus Button to Add New Asset - Only show if less than max, in grid where Generate All was */}
                    {anchorImagePrompts.length < MAX_ANCHOR_ASSETS && (
                      <button
                        type="button"
                        onClick={() => {
                          onAddAssetSlot();
                        }}
                        className="rounded border border-dashed border-white/30 bg-gradient-to-br from-purple-500/10 to-pink-500/10 text-white/70 hover:text-white hover:border-purple-500/50 px-2 py-1.5 text-xs transition-all text-left flex items-center gap-1.5"
                      >
                        <div className="w-6 h-6 rounded border border-white/20 bg-white/5 flex items-center justify-center flex-shrink-0">
                          <Plus className="w-3 h-3 text-white/40" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">Add {anchorImagePrompts.length + 1}</span>
                        </div>
                      </button>
                    )}
                  </div>
                  
                  {/* Generate All Assets Button - Below asset tiles row */}
                  {anchorImagePrompts.length > 0 && (
                    <div className="pt-3 flex justify-end gap-2">
                      {onPopulateScenes && (
                        <button
                          type="button"
                          onClick={() => {
                            onPopulateScenes();
                          }}
                          className="w-auto px-6 bg-gradient-to-r from-green-500/90 to-emerald-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/50 hover:scale-[1.03] hover:from-green-500 hover:to-emerald-500 transition-all duration-300 flex items-center justify-center gap-2"
                        >
                          <FileText className="w-4 h-4" />
                          Populate Scenes
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          await onGenerateAllAssets();
                        }}
                        disabled={anchorImagePrompts.every(p => !p.trim()) || isGeneratingAssets.some(g => g)}
                        className="w-auto px-6 bg-gradient-to-r from-blue-500/90 to-purple-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/50 hover:scale-[1.03] hover:from-blue-500 hover:to-purple-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
                      >
                        {isGeneratingAssets.some(g => g) ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <ImageIcon className="w-4 h-4" />
                            Generate All
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>

          {/* Scene Sections */}
          {scenes.map((scene, sceneIndex) => {
            // Find assets for checkboxes
            const asset1 = generatedAnchorImages.find(img => img.assetNumber === 1);
            const asset2 = generatedAnchorImages.find(img => img.assetNumber === 2);
            const asset3 = generatedAnchorImages.find(img => img.assetNumber === 3);

            return (
              <div key={scene.id} className="bg-gradient-to-br from-black/30 to-black/20 backdrop-blur-xl rounded-xl border border-white/20 shadow-xl shadow-black/20 p-6 space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white">Scene {sceneIndex + 1}</h3>
                  {sceneIndex > 0 && (
                    <button
                      type="button"
                      onClick={() => onRemoveScene(scene.id)}
                      className="p-1.5 text-red-400 hover:text-red-300 hover:bg-white/10 rounded-lg transition-colors"
                      title="Remove scene"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-5 gap-4">
                  {/* Video Thumbnail and Frame Slideshow */}
                  <div className="space-y-2 col-span-2">
                    {scene.videoUrl ? (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => onSceneVideoClick(scene.id)}
                          className="w-full aspect-video rounded-lg border border-white/20 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm overflow-hidden hover:border-blue-500/60 hover:shadow-lg hover:shadow-blue-500/20 transition-all cursor-pointer relative group"
                        >
                          <video
                            src={scene.videoUrl}
                            className="w-full h-full object-cover"
                            muted
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Play className="w-6 h-6 text-white" />
                          </div>
                        </button>
                        {(scene.firstFrameUrl || scene.lastFrameUrl) && (
                          <div className="flex gap-2">
                            {scene.firstFrameUrl && (
                              <img
                                src={scene.firstFrameUrl}
                                alt="First frame"
                                className="w-1/2 h-16 object-cover rounded border border-white/10"
                              />
                            )}
                            {scene.lastFrameUrl && (
                              <img
                                src={scene.lastFrameUrl}
                                alt="Last frame"
                                className="w-1/2 h-16 object-cover rounded border border-white/10"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="aspect-video rounded-lg border-2 border-dashed border-white/30 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm flex items-center justify-center">
                        <div className="text-center text-white/40">
                          <VideoIcon className="w-6 h-6 mx-auto mb-2" />
                          <p className="text-xs">No video yet</p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Text Box, Extend Checkbox, and Generate Button */}
                  <div className="space-y-3 col-span-3">
                    <textarea
                      value={scene.prompt}
                      onChange={(e) => onScenePromptChange(scene.id, e.target.value)}
                      placeholder={`Enter prompt for Scene ${sceneIndex + 1}...`}
                      rows={scene.videoUrl && (scene.firstFrameUrl || scene.lastFrameUrl) ? 9 : 6}
                      className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-4 py-3 text-white placeholder-white/50 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all resize-none shadow-inner"
                      style={glassTextareaStyle}
                    />
                    <div className="flex items-center justify-between gap-3">
                      {/* Asset Selection Checkboxes and Continuous */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white/70">Assets:</span>
                        {generatedAnchorImages.map((asset) => {
                          // Check if selected by ID (for generated assets) or by asset number (for imported projects before assets are generated)
                          const isSelectedById = scene.selectedAssetIds.includes(asset.id);
                          const isSelectedByNumber = scene.selectedAssetNumbers?.includes(asset.assetNumber) ?? false;
                          const isSelected = isSelectedById || isSelectedByNumber;
                          
                          return (
                            <label
                              key={`${scene.id}-${asset.id}`}
                              className="flex items-center gap-1 text-white/70 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const newSelectedIds = e.target.checked
                                    ? [...scene.selectedAssetIds.filter(id => id !== asset.id), asset.id]
                                    : scene.selectedAssetIds.filter(id => id !== asset.id);
                                  onSceneSelectedAssetIdsChange(scene.id, newSelectedIds);
                                }}
                                className="w-3 h-3 rounded border-white/30 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm text-blue-500 focus:ring-1 focus:ring-blue-500/50 shadow-inner transition-all duration-200 hover:border-white/40 hover:shadow-md hover:shadow-blue-500/20"
                              />
                              <span className="text-xs font-medium">{asset.assetNumber}</span>
                            </label>
                          );
                        })}
                        {/* Continuous Checkbox - only show from scene 2 onwards */}
                        {sceneIndex > 0 && (
                          <label className="flex items-center gap-1 text-white/70 cursor-pointer ml-1">
                            <input
                              type="checkbox"
                              checked={continuous}
                              onChange={(e) => onContinuousChange(e.target.checked)}
                              className="w-3 h-3 rounded border-white/30 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm text-blue-500 focus:ring-1 focus:ring-blue-500/50 shadow-inner transition-all duration-200 hover:border-white/40 hover:shadow-md hover:shadow-blue-500/20"
                            />
                            <span className="text-xs font-medium">Continuous</span>
                          </label>
                        )}
                      </div>
                      
                      {/* Right side: Extend previous and Generate button */}
                      <div className="flex items-center gap-3">
                        {sceneIndex > 0 && (
                          <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={scene.extendPrevious}
                              onChange={(e) => onSceneExtendPreviousChange(scene.id, e.target.checked)}
                              className="w-4 h-4 rounded border-white/30 bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm text-blue-500 focus:ring-2 focus:ring-blue-500/50 shadow-inner transition-all duration-200 hover:border-white/40 hover:shadow-md hover:shadow-blue-500/20"
                            />
                            <span>Extend previous</span>
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => onSceneGenerate(sceneIndex, scene)}
                          disabled={!scene.prompt.trim() || scene.isGenerating}
                          className="w-auto px-6 bg-gradient-to-r from-blue-500/90 to-purple-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/50 hover:scale-[1.03] hover:from-blue-500 hover:to-purple-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
                        >
                          {scene.isGenerating ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <VideoIcon className="w-4 h-4" />
                              Generate
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add Scene Button */}
          <button
            type="button"
            onClick={onAddScene}
            className="w-full py-4 rounded-xl border-2 border-dashed border-white/20 bg-black/10 hover:border-blue-500/50 hover:bg-blue-500/10 transition-all flex items-center justify-center gap-2 text-white/60 hover:text-white"
          >
            <Plus className="w-5 h-5" />
            <span>Add Scene</span>
          </button>

          {/* Music Section */}
          <div className="bg-gradient-to-br from-black/30 to-black/20 backdrop-blur-xl rounded-xl border border-white/20 shadow-xl shadow-black/20 p-6 space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <Music className="w-5 h-5" />
                Music
              </h3>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Music Input (JSON format)
                </label>
                <textarea
                  value={musicPrompt}
                  onChange={(e) => onMusicPromptChange(e.target.value)}
                  placeholder='Paste JSON format:\n{\n  "lyrics": "[Verse]\\nYour lyrics here...",\n  "prompt": "Jazz, Smooth Jazz, Romantic, Dreamy",\n  "bitrate": 256000,\n  "sample_rate": 44100,\n  "audio_format": "mp3"\n}'
                  rows={6}
                  className="w-full rounded-lg border border-white/20 bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/10 backdrop-blur-xl px-4 py-3 text-sm text-white placeholder-white/50 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:shadow-lg focus:shadow-blue-500/20 transition-all resize-none shadow-inner font-mono"
                  style={glassTextareaStyle}
                />
                <p className="text-xs text-white/50 mt-1">
                  Paste JSON with "lyrics" field (required). Optional: "prompt" (defaults to "Jazz, Smooth Jazz, Romantic, Dreamy"), "bitrate", "sample_rate", "audio_format".
                </p>
              </div>

              {generatedMusicUrl && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-white/70">
                    Generated Music
                  </label>
                  <div className="relative rounded-lg border border-white/20 bg-gradient-to-br from-white/5 to-transparent backdrop-blur-sm overflow-hidden">
                    <audio
                      src={generatedMusicUrl}
                      controls
                      className="w-full"
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={async () => {
                    await onGenerateMusic();
                  }}
                  disabled={!musicPrompt.trim() || isGeneratingMusic}
                  className="w-auto px-6 bg-gradient-to-r from-green-500/90 to-emerald-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/50 hover:scale-[1.03] hover:from-green-500 hover:to-emerald-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
                >
                  {isGeneratingMusic ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Music...
                    </>
                  ) : (
                    <>
                      <Music className="w-4 h-4" />
                      Generate Music
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          {isGeneratingAll && generationProgress && generationProgress.progress > 0 && (
            <div className="pt-4 pb-2">
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-white/80 font-medium">
                    {generationProgress.currentStage || 'Generating...'}
                  </span>
                  <span className="text-sm text-white/60">
                    {generationProgress.progress}%
                  </span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                    style={{ width: `${generationProgress.progress}%` }}
                  />
                </div>
                {generationProgress.cost !== null && (
                  <div className="mt-2 text-xs text-white/60">
                    Estimated cost: ${generationProgress.cost.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Generate All Scenes Buttons */}
          {scenes.length > 0 && (
            <div className="pt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  await onGenerateAll();
                }}
                disabled={scenes.every(s => !s.prompt.trim()) || isGeneratingAll || scenes.some(s => s.isGenerating)}
                className="w-auto px-6 bg-gradient-to-r from-blue-500/90 to-purple-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/50 hover:scale-[1.03] hover:from-blue-500 hover:to-purple-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
              >
                {isGeneratingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating All Scenes...
                  </>
                ) : (
                  <>
                    <VideoIcon className="w-4 h-4" />
                    Generate All Scenes
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onGenerateAllParallel();
                }}
                disabled={scenes.every(s => !s.prompt.trim()) || isGeneratingAll || scenes.some(s => s.isGenerating)}
                className="w-auto px-6 bg-gradient-to-r from-purple-500/90 to-pink-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/50 hover:scale-[1.03] hover:from-purple-500 hover:to-pink-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
              >
                {isGeneratingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating in Parallel...
                  </>
                ) : (
                  <>
                    <VideoIcon className="w-4 h-4" />
                    Generate All in Parallel
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onStitchScenes();
                }}
                disabled={isStitching || scenes.every(s => !s.videoUrl)}
                className="w-auto px-6 bg-gradient-to-r from-green-500/90 to-emerald-500/90 text-white py-1.5 rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/50 hover:scale-[1.03] hover:from-green-500 hover:to-emerald-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg flex items-center justify-center gap-2"
              >
                {isStitching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Stitching...
                  </>
                ) : (
                  <>
                    <VideoIcon className="w-4 h-4" />
                    Stitch Scenes
                  </>
                )}
              </button>
            </div>
          )}

          {/* Final Stitched Video Section */}
          {finalVideoUrl && (
            <div className="mt-6 pt-6 border-t border-white/10">
              <h3 className="text-sm font-semibold text-white/90 mb-3 flex items-center gap-2">
                <VideoIcon className="w-4 h-4" />
                Final Stitched Video
              </h3>
              <div className="relative rounded-lg overflow-hidden border-2 border-green-500/50 bg-gradient-to-br from-green-500/10 to-transparent backdrop-blur-sm">
                <video
                  src={finalVideoUrl}
                  controls
                  className="w-full aspect-video object-cover"
                />
                <div className="absolute top-2 right-2">
                  <div className="px-2 py-1 bg-green-500/90 text-white text-xs font-medium rounded backdrop-blur-sm">
                    Final Video
                  </div>
                </div>
              </div>
              
              {/* Action Buttons Below Video */}
              <div className="mt-4 flex items-center justify-end gap-3">
                {/* Advanced Edit Button */}
                {projectId && (
                  <button
                    onClick={() => navigate(`/project/${projectId}/edit`)}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/90 to-pink-500/90 text-white rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/50 hover:scale-[1.03] hover:from-purple-500 hover:to-pink-500 transition-all duration-300"
                  >
                    <Edit3 className="w-4 h-4" />
                    Advanced Edit
                  </button>
                )}
                
                {/* Download Options */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!finalVideoUrl) return;
                      try {
                        const response = await fetch(finalVideoUrl);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `final-video-${Date.now()}.mp4`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                      } catch (error) {
                        console.error('Failed to download MP4:', error);
                        alert('Failed to download video. Please try again.');
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500/90 to-cyan-500/90 text-white rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/50 hover:scale-[1.03] hover:from-blue-500 hover:to-cyan-500 transition-all duration-300"
                  >
                    <Download className="w-4 h-4" />
                    Download MP4
                  </button>
                  
                  <button
                    onClick={async () => {
                      if (!finalVideoUrl) return;
                      try {
                        // For MOV, we need to convert or serve as MOV
                        // Since we're serving MP4, we'll download as MOV by changing the extension
                        // Note: This is a client-side conversion - the actual format is still MP4
                        // For true MOV conversion, you'd need backend processing
                        const response = await fetch(finalVideoUrl);
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `final-video-${Date.now()}.mov`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                      } catch (error) {
                        console.error('Failed to download MOV:', error);
                        alert('Failed to download video. Please try again.');
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500/90 to-teal-500/90 text-white rounded-lg font-medium text-sm backdrop-blur-md border border-white/20 shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/50 hover:scale-[1.03] hover:from-emerald-500 hover:to-teal-500 transition-all duration-300"
                  >
                    <Download className="w-4 h-4" />
                    Download MOV
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

