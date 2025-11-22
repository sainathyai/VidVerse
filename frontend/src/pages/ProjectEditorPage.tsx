import { useState, useRef, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { uploadFile } from "../lib/upload";
import { 
  Upload, 
  Image as ImageIcon, 
  Video, 
  Music, 
  X, 
  Play, 
  Pause, 
  Edit3,
  Send,
  FileText,
  Loader2,
  CheckCircle2,
  Scissors,
  Sparkles,
  Layers,
  Download,
  Check
} from "lucide-react";
import { ScriptPreview } from "../components/ScriptPreview";
import { Header } from "../components/Header";
import { PreviewModal } from "../components/PreviewModal";
import { VideoEditor } from "../components/VideoEditor";
import { VideoTimeline } from "../components/VideoTimeline";
import { VideoEditPanel } from "../components/VideoEditPanel";

interface Asset {
  id: string;
  type: 'audio' | 'image' | 'video' | 'brand_kit';
  url: string;
  filename: string;
  thumbnail?: string;
}

interface Frame {
  id: string;
  sceneNumber: number;
  type: 'first' | 'last' | 'user_upload' | 'generated';
  url: string;
  thumbnail?: string;
}

interface Scene {
  id: string;
  sceneNumber: number;
  videoUrl?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  duration: number;
  prompt: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: { type: string; url: string; filename: string }[];
}

function ProjectEditorContent() {
  const { id } = useParams<{ id: string }>();
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  
  // State
  const [userAssets, setUserAssets] = useState<Asset[]>([]);
  const [generatedAssets, setGeneratedAssets] = useState<Asset[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [stitchedVideo, setStitchedVideo] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [scriptPreview, setScriptPreview] = useState<string>("");
  const [showScriptPreview, setShowScriptPreview] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("openai/gpt-4o-mini");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<Array<{ id: string; type: 'image' | 'video' | 'audio' | 'scene'; url: string; thumbnail?: string; title?: string; description?: string }>>([]);
  const [previewInitialIndex, setPreviewInitialIndex] = useState(0);
  const [isStitching, setIsStitching] = useState(false);
  const [showVideoEditor, setShowVideoEditor] = useState(false);
  const [showAddMusicModal, setShowAddMusicModal] = useState(false);
  const [showEditMusicModal, setShowEditMusicModal] = useState(false);
  const [editingTrack, setEditingTrack] = useState<{ id: string; url: string; startTime: number; duration: number; volume: number; name?: string } | null>(null);
  const [isAddingAudio, setIsAddingAudio] = useState(false);
  const [isSavingToS3, setIsSavingToS3] = useState(false);
  const [videoSavedToS3, setVideoSavedToS3] = useState(false);
  const [projectName, setProjectName] = useState<string>('');
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [selectedScenesForEditor, setSelectedScenesForEditor] = useState<Scene[]>([]);
  const [editorVideoUrl, setEditorVideoUrl] = useState<string | null>(null);
  const [isConcatenating, setIsConcatenating] = useState(false);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editMode, setEditMode] = useState<'trim' | 'effects' | 'transitions' | 'music' | null>(null);
  const [audioTracks, setAudioTracks] = useState<Array<{ id: string; url: string; startTime: number; duration: number; volume: number; name?: string }>>([]);

  // Concatenate selected scenes when they change
  useEffect(() => {
    const concatenateScenes = async () => {
      if (selectedScenesForEditor.length === 0) {
        setEditorVideoUrl(null);
        return;
      }

      // If only one scene, just use its URL
      if (selectedScenesForEditor.length === 1) {
        setEditorVideoUrl(selectedScenesForEditor[0].videoUrl || null);
        return;
      }

      // Multiple scenes - concatenate them
      try {
        setIsConcatenating(true);
        const token = await getAccessToken();
        if (!token || !id) return;

        // Call backend to concatenate
        const sceneUrls = selectedScenesForEditor
          .filter(s => s.videoUrl)
          .map(s => s.videoUrl!)
          .sort((a, b) => {
            const sceneA = selectedScenesForEditor.find(s => s.videoUrl === a);
            const sceneB = selectedScenesForEditor.find(s => s.videoUrl === b);
            return (sceneA?.sceneNumber || 0) - (sceneB?.sceneNumber || 0);
          });

        if (sceneUrls.length > 0) {
          // Use the stitch-scenes endpoint but with specific scene URLs
          // For now, we'll create a temporary concatenated video
          // In a real implementation, you might want a dedicated endpoint
          const result = await apiRequest<{ success: boolean; videoUrl: string }>(
            `/api/projects/${id}/stitch-scenes`,
            {
              method: 'POST',
              body: JSON.stringify({ sceneUrls }),
            },
            token
          );

          if (result.success && result.videoUrl) {
            setEditorVideoUrl(result.videoUrl);
          }
        }
      } catch (error) {
        console.error('Error concatenating scenes:', error);
        // Fallback: use first scene URL
        if (selectedScenesForEditor[0]?.videoUrl) {
          setEditorVideoUrl(selectedScenesForEditor[0].videoUrl);
        }
      } finally {
        setIsConcatenating(false);
      }
    };

    concatenateScenes();
  }, [selectedScenesForEditor, id, getAccessToken]);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  
  // Load assets and frames on mount
  useEffect(() => {
    if (!id) return;

    const loadProjectData = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        // Fetch project to get final video URL
        try {
          const project = await apiRequest<{ 
            name?: string;
            status?: string;
            config?: { 
              videoUrl?: string; 
              finalVideoUrl?: string;
              sceneUrls?: string[];
              audioTracks?: Array<{ id?: string; url: string; startTime: number; duration: number; volume: number; name?: string }>;
            } 
          }>(`/api/projects/${id}`, { method: 'GET' }, token);
          
          console.log('Project loaded:', { 
            status: project.status,
            hasConfig: !!project.config, 
            configType: typeof project.config,
            configKeys: project.config ? Object.keys(project.config) : [],
            videoUrl: project.config?.videoUrl,
            finalVideoUrl: project.config?.finalVideoUrl,
            audioTracks: project.config?.audioTracks,
            sceneUrls: project.config?.sceneUrls,
            fullConfig: project.config
          });
          
          // Store project name
          if (project.name) {
            setProjectName(project.name);
          }
          
          // Load audio tracks from config if they exist
          if (project.config?.audioTracks && Array.isArray(project.config.audioTracks)) {
            // Ensure each track has an id
            const tracksWithIds = project.config.audioTracks.map((track, index) => ({
              ...track,
              id: track.id || `audio-${Date.now()}-${index}`,
            }));
            setAudioTracks(tracksWithIds);
            console.log('Loaded audio tracks from config:', tracksWithIds.length);
          }
          
          // Load final video - prefer finalVideoUrl (merged with audio) over videoUrl
          const videoUrlToUse = project.config?.finalVideoUrl || project.config?.videoUrl;
          if (videoUrlToUse) {
            console.log('Setting final video URL from config:', videoUrlToUse);
            setStitchedVideo(videoUrlToUse);
            // If project is completed, assume video is already saved
            // Otherwise, show save button
            setVideoSavedToS3(project.status === 'completed');
          } else {
            console.warn('No videoUrl found in project config. Status:', project.status, 'Config:', project.config);
            setStitchedVideo(null);
            setVideoSavedToS3(false);
          }
        } catch (error) {
          console.error('Error loading project:', error);
          setStitchedVideo(null);
        }

        // Fetch scenes from API
        try {
          const scenesData = await apiRequest<Scene[]>(`/api/projects/${id}/scenes`, { method: 'GET' }, token);
          if (scenesData && scenesData.length > 0) {
            // Sort by scene number and set scenes
            const sortedScenes = scenesData.sort((a, b) => a.sceneNumber - b.sceneNumber);
            setScenes(sortedScenes);
          } else {
            // Initialize empty scenes if none exist
            const initialScenes: Scene[] = Array.from({ length: 5 }, (_, i) => ({
              id: `scene-${i + 1}`,
              sceneNumber: i + 1,
              duration: 0,
              prompt: `Scene ${i + 1} description...`,
            }));
            setScenes(initialScenes);
          }
        } catch (error) {
          console.error('Error loading scenes:', error);
          // Initialize empty scenes on error
          const initialScenes: Scene[] = Array.from({ length: 5 }, (_, i) => ({
            id: `scene-${i + 1}`,
            sceneNumber: i + 1,
            duration: 0,
            prompt: `Scene ${i + 1} description...`,
          }));
          setScenes(initialScenes);
        }

        // Fetch saved assets (exclude final videos - they're shown in Final Video section)
        try {
          const assets = await apiRequest<Asset[]>(`/api/projects/${id}/assets`, { method: 'GET' }, token);
          // Filter out final videos (they have metadata.isFinal === true)
          const filteredAssets = assets.filter(asset => 
            !(asset.type === 'video' && (asset as any).metadata?.isFinal === true)
          );
          setUserAssets(filteredAssets);
        } catch (error) {
          console.error('Error loading assets:', error);
        }

        // Fetch saved frames - only load frames that actually exist
        try {
          const savedFrames = await apiRequest<Frame[]>(`/api/projects/${id}/frames`, { method: 'GET' }, token);
          // Only set frames that have URLs (actual frames, no placeholders)
          const existingFrames = savedFrames.filter(f => f.url && f.url.trim() !== '');
          setFrames(existingFrames);
        } catch (error) {
          console.error('Error loading frames:', error);
          setFrames([]); // Start with empty array, no placeholders
        }
      } catch (error) {
        console.error('Error loading project data:', error);
      }
    };

    loadProjectData();
  }, [id, getAccessToken]);

  // Reload video when URL changes to ensure audio plays
  useEffect(() => {
    if (videoRef.current && (stitchedVideo || editorVideoUrl)) {
      const video = videoRef.current;
      const currentSrc = video.src;
      const newSrc = editorVideoUrl || stitchedVideo || '';
      
      // Only reload if the source actually changed
      if (currentSrc !== newSrc && newSrc) {
        console.log('Reloading video with new source:', newSrc);
        video.load(); // Force reload to ensure audio is included
      }
    }
  }, [stitchedVideo, editorVideoUrl]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Preview modal handlers
  const openAssetPreview = (asset: Asset, allAssets: Asset[]) => {
    const items = allAssets.map(a => ({
      id: a.id,
      type: a.type === 'brand_kit' ? 'image' : a.type as 'image' | 'video' | 'audio',
      url: a.url,
      thumbnail: a.thumbnail,
      title: a.filename,
    }));
    const index = items.findIndex(item => item.id === asset.id);
    setPreviewItems(items);
    setPreviewInitialIndex(index >= 0 ? index : 0);
    setPreviewModalOpen(true);
  };

  const openFramePreview = (frame: Frame, allFrames: Frame[]) => {
    const items = allFrames
      .filter(f => f.url)
      .map(f => ({
        id: f.id,
        type: 'image' as const,
        url: f.url,
        thumbnail: f.thumbnail,
        title: `Scene ${f.sceneNumber} - ${f.type === 'first' ? 'First Frame' : f.type === 'last' ? 'Last Frame' : 'Frame'}`,
      }));
    const index = items.findIndex(item => item.id === frame.id);
    setPreviewItems(items);
    setPreviewInitialIndex(index >= 0 ? index : 0);
    setPreviewModalOpen(true);
  };

  const openScenePreview = (scene: Scene, allScenes: Scene[]) => {
    const items = allScenes
      .filter(s => s.videoUrl)
      .map(s => ({
        id: s.id,
        type: 'scene' as const,
        url: s.videoUrl || '',
        thumbnail: s.thumbnail,
        title: `Scene ${s.sceneNumber}`,
        description: s.prompt,
      }));
    const index = items.findIndex(item => item.id === scene.id);
    setPreviewItems(items);
    setPreviewInitialIndex(index >= 0 ? index : 0);
    setPreviewModalOpen(true);
  };

  const handleFileUpload = async (files: FileList, type: 'asset' | 'frame') => {
    try {
      const token = await getAccessToken();
      
      if (!token) {
        navigate('/login');
        return;
      }
    
      Array.from(files).forEach(async (file) => {
        try {
          // Show local preview immediately for images
          const localPreviewUrl = file.type.startsWith('image') ? URL.createObjectURL(file) : undefined;

          if (type === 'asset') {
            // Use uploadFile helper which handles presigned URLs
            const { url, key } = await uploadFile(
              file,
              file.type.startsWith('image') ? 'image' : 
              file.type.startsWith('video') ? 'video' : 'audio',
              token,
              undefined,
              id
            );

            // Save asset to database
            const savedAsset = await apiRequest<Asset>(
              `/api/projects/${id}/assets`,
              {
                method: 'POST',
                body: JSON.stringify({
                  type: file.type.startsWith('image') ? 'image' : 
                        file.type.startsWith('video') ? 'video' : 'audio',
                  url: url,
                  filename: file.name,
                }),
              },
              token
            );

            setUserAssets(prev => [...prev, savedAsset]);
            
            // Clean up local preview after a delay
            if (localPreviewUrl) {
              setTimeout(() => URL.revokeObjectURL(localPreviewUrl), 1000);
            }
          } else {
            // Upload frame and add to frames list
            // Show local preview immediately
            const tempFrameId = `frame-${Date.now()}`;
            const newFrame: Frame = {
              id: tempFrameId,
              sceneNumber: 1, // Default to scene 1, can be updated later
              type: 'user_upload',
              url: localPreviewUrl || '',
              thumbnail: localPreviewUrl,
            };
            
            setFrames(prev => [...prev, newFrame]);

            // Upload to S3 and get presigned URL
            const { url, key } = await uploadFile(
              file,
              'image',
              token,
              undefined,
              id
            );

            // Update with actual S3 URL
            setFrames(prevFrames => {
              const updatedFrames = prevFrames.map(f => 
                f.id === tempFrameId 
                  ? { ...f, url: url, thumbnail: url }
                  : f
              );
              
              // Save frames to database
              const framesToSave = updatedFrames
                .filter(f => f.url && f.url.trim() !== '')
                .map(f => ({
                  sceneNumber: f.sceneNumber,
                  type: f.type,
                  url: f.url,
                }));
              
              if (framesToSave.length > 0) {
                apiRequest(
                  `/api/projects/${id}/frames`,
                  {
                    method: 'POST',
                    body: JSON.stringify({ frames: framesToSave }),
                  },
                  token
                ).catch(error => console.error('Error saving frames:', error));
              }
              
              return updatedFrames;
            });

            // Clean up local preview
            if (localPreviewUrl) {
              URL.revokeObjectURL(localPreviewUrl);
            }
          }
        } catch (error: any) {
          console.error('Upload error:', error);
          const errorMessage = error.message || 'Failed to upload file';
          const statusCode = (error as any)?.statusCode;
          
          // If authentication failed, redirect to login
          if (statusCode === 401 || errorMessage.includes('Authentication') || errorMessage.includes('401')) {
            if (type === 'frame') {
              const localPreviewUrl = file.type.startsWith('image') ? URL.createObjectURL(file) : undefined;
              if (localPreviewUrl) {
                setFrames(prev => prev.map(f => 
                  f.thumbnail === localPreviewUrl ? { ...f, url: '', thumbnail: undefined } : f
                ));
                URL.revokeObjectURL(localPreviewUrl);
              }
            }
            navigate('/login');
            return;
          }
          
          alert(errorMessage);
        }
      });
    } catch (error: any) {
      console.error('Token retrieval error:', error);
      navigate('/login');
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() && !fileInputRef.current?.files?.length) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: chatInput,
      timestamp: new Date(),
    };
    
    setChatMessages([...chatMessages, userMessage]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const token = await getAccessToken();
      
      // Send message to OpenRouter via backend API
      const response = await apiRequest<{ response: string; conversationId?: string }>(
        '/api/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            message: chatInput,
            projectId: id,
            model: selectedModel,
            attachments: fileInputRef.current?.files ? Array.from(fileInputRef.current.files).map(file => ({
              type: file.type,
              filename: file.name,
              url: URL.createObjectURL(file), // Temporary URL for now
            })) : undefined,
          }),
        },
        token
      );

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
      };

      setChatMessages(prev => [...prev, userMessage, assistantMessage]);
      
      // Check if response contains script content and update preview
      if (response.response.toLowerCase().includes('script') || response.response.includes('```')) {
        // Extract script if present in response
        const scriptMatch = response.response.match(/```[\s\S]*?```/);
        if (scriptMatch) {
          setScriptPreview(scriptMatch[0].replace(/```/g, ''));
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      const statusCode = (error as any)?.statusCode;
      
      // If authentication failed, redirect to login
      if (statusCode === 401) {
        navigate('/login');
        return;
      }
      
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: error.message || 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setChatMessages(prev => [...prev, userMessage, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col relative overflow-hidden">
      {/* Animated Textured Background */}
      <div className="fixed inset-0 z-0">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950" />
        
        {/* Animated gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/20 via-purple-950/20 to-pink-950/20 animate-gradient-shift" />
        
        {/* Texture pattern */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
        
        {/* Animated orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float-delayed" />
        <div className="absolute top-1/2 right-1/3 w-72 h-72 bg-pink-500/10 rounded-full blur-3xl animate-float-slow" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <Header 
          showProjectEditor={true}
          onSaveProject={async () => {
            try {
              const token = await getAccessToken();
              if (!token || !id) return;

              // Prepare update data
              const updateData: any = {};
              
              // Save project name if changed
              if (projectName) {
                updateData.name = projectName;
              }

              // Save config with current state (audio tracks, scenes, etc.)
              const currentConfig: any = {};
              
              // Save audio tracks if any
              if (audioTracks.length > 0) {
                currentConfig.audioTracks = audioTracks;
              }

              // Save scene URLs if available
              if (scenes.length > 0) {
                const sceneUrls = scenes
                  .filter(s => s.videoUrl)
                  .map(s => s.videoUrl!)
                  .sort((a, b) => {
                    const sceneA = scenes.find(s => s.videoUrl === a);
                    const sceneB = scenes.find(s => s.videoUrl === b);
                    return (sceneA?.sceneNumber || 0) - (sceneB?.sceneNumber || 0);
                  });
                if (sceneUrls.length > 0) {
                  currentConfig.sceneUrls = sceneUrls;
                }
              }

              // Save final video URL if available
              if (stitchedVideo) {
                currentConfig.finalVideoUrl = stitchedVideo;
                currentConfig.videoUrl = stitchedVideo;
              }

              if (Object.keys(currentConfig).length > 0) {
                updateData.config = currentConfig;
              }

              // Only make API call if there's something to update
              if (Object.keys(updateData).length > 0) {
                await apiRequest(`/api/projects/${id}`, {
                  method: 'PATCH',
                  body: JSON.stringify(updateData),
                }, token);
                
                console.log('Project saved successfully');
                // You could add a toast notification here
              }
            } catch (error) {
              console.error('Error saving project:', error);
              // You could add error toast notification here
            }
          }}
        />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Bottom Content Area - Left, Center, Right Panels */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Assets & Frames */}
          <div 
            ref={leftPanelRef}
            className="w-80 border-r border-white/10 bg-black/20 backdrop-blur-xl overflow-y-auto flex flex-col"
          >
          {/* User Assets Section */}
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Upload Assets</h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 hover:bg-white/10 rounded transition-colors"
              >
                <Upload className="w-4 h-4 text-white/70" />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="hidden"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files, 'asset')}
            />
            
            <div className="grid grid-cols-2 gap-2">
              {userAssets.map((asset) => (
                <div key={asset.id} className="relative group">
                  <div 
                    className="aspect-square rounded-lg overflow-hidden bg-white/5 border border-white/10 cursor-pointer hover:opacity-80 hover:border-white/20 transition-all"
                    onClick={() => openAssetPreview(asset, userAssets)}
                  >
                    {asset.thumbnail ? (
                      <img src={asset.thumbnail} alt={asset.filename} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {asset.type === 'audio' && <Music className="w-8 h-8 text-white/50" />}
                        {asset.type === 'video' && <Video className="w-8 h-8 text-white/50" />}
                        {asset.type === 'image' && <ImageIcon className="w-8 h-8 text-white/50" />}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const token = await getAccessToken();
                        // Try to delete from database if it's a UUID (database ID)
                        // Temporary IDs start with "asset-" followed by timestamp
                        if (token && asset.id && !asset.id.match(/^asset-\d+$/)) {
                          await apiRequest(`/api/assets/${asset.id}`, { method: 'DELETE' }, token);
                        }
                        setUserAssets(userAssets.filter(a => a.id !== asset.id));
                      } catch (error) {
                        console.error('Error deleting asset:', error);
                        // Still remove from UI even if delete fails
                        setUserAssets(userAssets.filter(a => a.id !== asset.id));
                      }
                    }}
                    className="absolute top-1 right-1 p-1 bg-red-500/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {userAssets.length === 0 && (
                <div className="col-span-2 text-center py-8 text-white/50 text-sm">
                  No assets uploaded yet
                </div>
              )}
            </div>
          </div>

          {/* Generated Assets Section */}
          <div className="p-4 border-b border-white/10">
            <h2 className="text-sm font-semibold mb-3 text-white">Generated Assets</h2>
            <div className="grid grid-cols-2 gap-2">
              {generatedAssets.map((asset) => (
                <div 
                  key={asset.id} 
                  className="relative group cursor-pointer"
                  onClick={() => openAssetPreview(asset, generatedAssets)}
                >
                  <div className="aspect-square rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:opacity-80 hover:border-white/20 transition-all">
                    {asset.thumbnail && (
                      <img src={asset.thumbnail} alt={asset.filename} className="w-full h-full object-cover" />
                    )}
                  </div>
                </div>
              ))}
              {generatedAssets.length === 0 && (
                <div className="col-span-2 text-center py-8 text-white/50 text-sm">
                  No generated assets yet
                </div>
              )}
            </div>
          </div>

          {/* Frames Section */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">
                Frames {frames.length > 0 && `(${frames.length})`}
              </h2>
              <button
                onClick={() => frameInputRef.current?.click()}
                className="p-1.5 hover:bg-white/10 rounded transition-colors"
                title="Upload frame"
              >
                <Upload className="w-4 h-4 text-white/70" />
              </button>
            </div>
            <input
              ref={frameInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files && handleFileUpload(e.target.files, 'frame')}
            />
            
            {frames.length > 0 ? (
              <div className="space-y-3">
                {/* Group frames by scene number */}
                {Array.from(new Set(frames.map(f => f.sceneNumber))).sort((a, b) => a - b).map((sceneNum) => {
                  const sceneFrames = frames.filter(f => f.sceneNumber === sceneNum);
                  return (
                    <div key={sceneNum}>
                      <div className="text-xs font-medium text-white/60 mb-2">
                        Scene {sceneNum}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {sceneFrames.map((frame) => (
                          <div
                            key={frame.id}
                            onClick={() => openFramePreview(frame, frames)}
                            className="aspect-square rounded border-2 border-blue-500/50 cursor-pointer hover:opacity-80 transition-opacity overflow-hidden bg-white/5 relative group"
                          >
                            <img 
                              src={frame.thumbnail || frame.url} 
                              alt={`Scene ${frame.sceneNumber} - ${frame.type === 'first' ? 'First' : frame.type === 'last' ? 'Last' : 'Frame'}`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                console.error('Failed to load frame image:', frame.url);
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const updatedFrames = frames.filter(f => f.id !== frame.id);
                                setFrames(updatedFrames);
                                
                                // Save frames to database
                                try {
                                  const token = await getAccessToken();
                                  if (token) {
                                    const framesToSave = updatedFrames
                                      .filter(f => f.url && f.url.trim() !== '')
                                      .map(f => ({
                                        sceneNumber: f.sceneNumber,
                                        type: f.type,
                                        url: f.url,
                                      }));
                                    
                                    await apiRequest(
                                      `/api/projects/${id}/frames`,
                                      {
                                        method: 'POST',
                                        body: JSON.stringify({ frames: framesToSave }),
                                      },
                                      token
                                    );
                                  }
                                } catch (error) {
                                  console.error('Error saving frames:', error);
                                }
                              }}
                              className="absolute top-0.5 right-0.5 p-0.5 bg-red-500/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 hover:bg-red-500"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                              <div className="text-[9px] text-white/80 font-medium">
                                {frame.type === 'first' ? 'First' : frame.type === 'last' ? 'Last' : 'Frame'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-16 h-16 rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center mb-3 cursor-pointer hover:border-blue-500/50 transition-colors"
                  onClick={() => frameInputRef.current?.click()}
                >
                  <Upload className="w-6 h-6 text-white/40" />
                </div>
                <p className="text-sm text-white/60 mb-1">No frames uploaded</p>
                <p className="text-xs text-white/40">Click to upload frames</p>
              </div>
            )}
          </div>
          </div>

        {/* Center Panel - Video Preview */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* Scene Clips and Final Video Selection */}
          <div className="h-32 border-b border-white/10 bg-black/10 backdrop-blur-sm shrink-0">
            <div className="flex gap-4 h-full px-3 py-1">
              {/* Scene Clips Section */}
              <div className="flex-1 flex flex-col min-w-0">
                <h3 className="text-xs font-semibold text-white/70 mb-2">Scene Clips</h3>
                <div className="flex items-center gap-2 h-full overflow-x-auto flex-1 pl-4">
              {scenes.map((scene) => {
                const isSelected = selectedScenesForEditor.some(s => s.id === scene.id);
                return (
                  <div 
                    key={scene.id} 
                    className="flex-shrink-0 w-36 h-full cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (scene.videoUrl) {
                        // Toggle selection
                        if (isSelected) {
                          setSelectedScenesForEditor(prev => prev.filter(s => s.id !== scene.id));
                        } else {
                          setSelectedScenesForEditor(prev => [...prev, scene]);
                        }
                      } else {
                        openScenePreview(scene, scenes);
                      }
                    }}
                  >
                    <div className={`h-full rounded-lg border-2 overflow-hidden relative group hover:opacity-80 transition-opacity ${
                      isSelected 
                        ? 'border-blue-500 bg-blue-500/20 ring-2 ring-blue-500/50' 
                        : 'border-white/10 bg-white/5'
                    }`}>
                      {scene.videoUrl ? (
                        <video 
                          src={scene.videoUrl} 
                          className="w-full h-full object-cover"
                          muted
                          onMouseEnter={(e) => e.currentTarget.play()}
                          onMouseLeave={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0;
                          }}
                          onError={(e) => {
                            console.error('Failed to load scene video:', scene.videoUrl);
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : scene.firstFrameUrl ? (
                        <img 
                          src={scene.firstFrameUrl} 
                          alt={`Scene ${scene.sceneNumber}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            console.error('Failed to load scene thumbnail:', scene.firstFrameUrl);
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-white/50">
                          <Video className="w-6 h-6 mb-0.5" />
                          <span className="text-[10px]">Scene {scene.sceneNumber}</span>
                        </div>
                      )}
                      <div className="absolute bottom-0.5 left-0.5 right-0.5">
                        <div className="text-[9px] bg-black/80 text-white px-1 py-0.5 rounded truncate">
                          {scene.prompt}
                        </div>
                      </div>
                      {scene.videoUrl && (
                        <div className="absolute top-0.5 right-0.5">
                          {isSelected ? (
                            <div className="p-0.5 bg-blue-500 rounded-full">
                              <CheckCircle2 className="w-2.5 h-2.5 text-white" fill="currentColor" />
                            </div>
                          ) : (
                            <div className="p-0.5 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute top-0.5 left-0.5">
                          <div className="px-1 py-0.5 bg-blue-500 text-white text-[9px] font-medium rounded">
                            Selected
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )})}
                {/* Stitch Scenes Button - Inside scene clips section */}
                {scenes.filter(s => s.videoUrl).length > 0 && !stitchedVideo && (
                  <button
                    onClick={async () => {
                      try {
                        setIsStitching(true);
                        const token = await getAccessToken();
                        const result = await apiRequest<{ success: boolean; videoUrl: string; sceneCount: number }>(
                          `/api/projects/${id}/stitch-scenes`,
                          { 
                            method: 'POST',
                            body: JSON.stringify({}) // Send empty object to satisfy Fastify
                          },
                          token
                        );
                        
                        if (result.success && result.videoUrl) {
                          // Backend already saved the stitched video to config.videoUrl
                          // Update local state immediately with the returned URL
                          setStitchedVideo(result.videoUrl);
                          // Reset save state - user can now save to S3
                          setVideoSavedToS3(false);
                          // Silently update - no popup needed
                          // Video will automatically appear in the player
                        }
                      } catch (error: any) {
                        console.error('Error stitching scenes:', error);
                        alert(`Failed to stitch scenes: ${error.message || 'Unknown error'}`);
                      } finally {
                        setIsStitching(false);
                      }
                    }}
                    disabled={isStitching}
                    className="flex-shrink-0 w-36 h-full rounded-lg border-2 border-green-500/50 bg-gradient-to-br from-green-500/20 via-emerald-500/20 to-green-600/20 backdrop-blur-sm hover:from-green-500/30 hover:via-emerald-500/30 hover:to-green-600/30 hover:border-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-500/20 hover:shadow-green-500/40 relative overflow-hidden group"
                  >
                    {/* Animated background gradient */}
                    <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    {/* Content */}
                    <div className="relative h-full flex flex-col items-center justify-between p-2">
                      {isStitching ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin text-green-400 mt-2" />
                          <div className="text-left w-full">
                            <span className="text-[9px] font-semibold text-white/90 leading-tight">Stitching Clips...</span>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Center icon - Layers icon to represent combining/stitching */}
                          <div className="flex-1 flex items-center justify-center">
                            <div className="relative">
                              {/* Multiple layers effect to show combining */}
                              <div className="absolute inset-0 flex items-center justify-center">
                                <Layers className="w-6 h-6 text-green-300/80" strokeWidth={2} />
                              </div>
                              <div className="absolute inset-0 flex items-center justify-center translate-x-0.5 translate-y-0.5">
                                <Layers className="w-6 h-6 text-green-400/60" strokeWidth={2} />
                              </div>
                              <Layers className="w-6 h-6 text-green-400 relative z-10 group-hover:scale-110 transition-transform" strokeWidth={2.5} />
                            </div>
                          </div>
                          
                          {/* Text at bottom left */}
                          <div className="text-left w-full">
                            <span className="text-[9px] font-semibold text-white/90 leading-tight">Stitch Clips</span>
                          </div>
                        </>
                      )}
                    </div>
                    
                    {/* Shine effect on hover */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  </button>
                )}
                </div>
              </div>
              
              {/* Final Video Section */}
              {stitchedVideo && (
                <div className="flex-1 flex flex-col min-w-0 border-l border-white/10 pl-4">
                  <h3 className="text-xs font-semibold text-white/70 mb-2">Final Video</h3>
                  <div className="flex items-center gap-2 h-full overflow-x-auto flex-1 pl-4">
                    <div className="flex-shrink-0 w-36 h-full cursor-pointer">
                      <div className="h-full rounded-lg border-2 border-green-500/50 bg-green-500/10 overflow-hidden relative group hover:opacity-80 transition-opacity">
                        <video 
                          src={stitchedVideo} 
                          className="w-full h-full object-cover"
                          muted
                          onMouseEnter={(e) => e.currentTarget.play()}
                          onMouseLeave={(e) => {
                            e.currentTarget.pause();
                            e.currentTarget.currentTime = 0;
                          }}
                        />
                        <div className="absolute bottom-0.5 left-0.5 right-0.5">
                          <div className="text-[9px] bg-black/80 text-white px-1 py-0.5 rounded truncate">
                            Final Video
                          </div>
                        </div>
                        <div className="absolute top-0.5 right-0.5">
                          <div className="p-0.5 bg-green-500 rounded-full">
                            <CheckCircle2 className="w-2.5 h-2.5 text-white" fill="currentColor" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Edit Options Toolbar - Two rows */}
              {(editorVideoUrl || stitchedVideo) && (
                <div className="flex-shrink-0 border-l border-white/10 pl-2">
                  <div className="grid grid-cols-2 gap-1.5 h-full">
                    {/* Row 1 */}
                    <button
                      onClick={() => {
                        setEditMode('trim');
                        setShowEditPanel(true);
                      }}
                      className="px-2 py-1.5 text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded transition-all flex items-center justify-center gap-1"
                      title="Trim video"
                    >
                      <Scissors className="w-3 h-3" />
                      <span className="hidden sm:inline">Trim</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditMode('effects');
                        setShowEditPanel(true);
                      }}
                      className="px-2 py-1.5 text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded transition-all flex items-center justify-center gap-1"
                      title="Add effects"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span className="hidden sm:inline">Effects</span>
                    </button>
                    {/* Row 2 */}
                    <button
                      onClick={() => {
                        setEditMode('transitions');
                        setShowEditPanel(true);
                      }}
                      className="px-2 py-1.5 text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded transition-all flex items-center justify-center gap-1"
                      title="Add transitions"
                    >
                      <Layers className="w-3 h-3" />
                      <span className="hidden sm:inline">Transitions</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditMode('music');
                        setShowEditPanel(true);
                      }}
                      className="px-2 py-1.5 text-xs bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded transition-all flex items-center justify-center gap-1"
                      title="Add music"
                    >
                      <Music className="w-3 h-3" />
                      <span className="hidden sm:inline">Music</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stitched Video */}
          <div className="flex-1 p-4 flex flex-col min-h-0">
            <div className="flex-1 rounded-lg border border-white/10 bg-black/20 backdrop-blur-xl overflow-hidden flex flex-col min-h-0">
              {/* Use editor video if scenes are selected, otherwise use stitched video */}
              {(editorVideoUrl || stitchedVideo) ? (
                <>
                  <div className="relative w-full flex-1 bg-black min-h-0 flex items-center justify-center">
                    {/* Save Button - Appears when video is available */}
                    {stitchedVideo && (
                      <div className="absolute top-4 right-4 z-20 flex gap-2">
                        {!videoSavedToS3 ? (
                          <button
                            onClick={async () => {
                              try {
                                setIsSavingToS3(true);
                                const token = await getAccessToken();
                                if (!token || !id || !stitchedVideo) return;

                                // 1. Merge audio tracks with video and save to S3
                                let finalVideoUrl = stitchedVideo;
                                
                                if (audioTracks.length > 0) {
                                  try {
                                    const mergeResult = await apiRequest<{ success: boolean; videoUrl: string }>(
                                      `/api/projects/${id}/merge-audio-and-save`,
                                      {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          audioTracks: audioTracks,
                                        }),
                                      },
                                      token
                                    );

                                    if (mergeResult.success && mergeResult.videoUrl) {
                                      finalVideoUrl = mergeResult.videoUrl;
                                      // Update local state with merged video
                                      setStitchedVideo(finalVideoUrl);
                                    }
                                  } catch (mergeError: any) {
                                    console.error('Error merging audio:', mergeError);
                                    // Continue with save even if merge fails
                                  }
                                } else {
                                  // No audio tracks, just update config
                                  const project = await apiRequest<{ config?: any }>(
                                    `/api/projects/${id}`,
                                    { method: 'GET' },
                                    token
                                  );

                                  const updatedConfig = {
                                    ...(project.config || {}),
                                    videoUrl: stitchedVideo,
                                    finalVideoUrl: stitchedVideo,
                                    videoCompleted: true,
                                    savedAt: new Date().toISOString(),
                                  };

                                  await apiRequest(
                                    `/api/projects/${id}`,
                                    {
                                      method: 'PATCH',
                                      body: JSON.stringify({
                                        config: updatedConfig,
                                      }),
                                    },
                                    token
                                  );
                                }

                                // 2. Download merged video locally immediately
                                try {
                                  const response = await fetch(finalVideoUrl);
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  const fileName = projectName 
                                    ? `${projectName}-final-video-${Date.now()}.mp4`
                                    : `project-${id}-final-video-${Date.now()}.mp4`;
                                  a.download = fileName;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                } catch (downloadError) {
                                  console.warn('Failed to download video locally:', downloadError);
                                  // Continue even if download fails
                                }

                                // 3. Save as asset in background
                                (async () => {
                                  try {
                                    await apiRequest(
                                      `/api/projects/${id}/assets`,
                                      {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          type: 'video',
                                          url: finalVideoUrl,
                                          filename: 'final-video.mp4',
                                          metadata: {
                                            source: 'stitched',
                                            hasAudio: audioTracks.length > 0,
                                            audioTrackCount: audioTracks.length,
                                            isFinal: true,
                                            savedAt: new Date().toISOString(),
                                          },
                                        }),
                                      },
                                      token
                                    );
                                  } catch (assetError) {
                                    console.warn('Could not save as asset:', assetError);
                                  }
                                })();

                                setVideoSavedToS3(true);
                              } catch (error: any) {
                                console.error('Error saving video:', error);
                                alert(`Failed to save video: ${error.message || 'Unknown error'}`);
                                setVideoSavedToS3(false);
                              } finally {
                                setIsSavingToS3(false);
                              }
                            }}
                            disabled={isSavingToS3}
                            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg shadow-lg shadow-blue-500/30 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSavingToS3 ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm font-medium">Saving...</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                <span className="text-sm font-medium">Save</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              try {
                                setIsSavingToS3(true);
                                const token = await getAccessToken();
                                if (!token || !id || !stitchedVideo) return;

                                // 1. Merge audio tracks with video and save to S3 (replaces previous version)
                                let finalVideoUrl = stitchedVideo;
                                
                                if (audioTracks.length > 0) {
                                  try {
                                    const mergeResult = await apiRequest<{ success: boolean; videoUrl: string }>(
                                      `/api/projects/${id}/merge-audio-and-save`,
                                      {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          audioTracks: audioTracks,
                                        }),
                                      },
                                      token
                                    );

                                    if (mergeResult.success && mergeResult.videoUrl) {
                                      finalVideoUrl = mergeResult.videoUrl;
                                      // Update local state with merged video
                                      setStitchedVideo(finalVideoUrl);
                                    }
                                  } catch (mergeError: any) {
                                    console.error('Error merging audio:', mergeError);
                                    // Continue with save even if merge fails
                                  }
                                } else {
                                  // No audio tracks, just update config
                                  const project = await apiRequest<{ config?: any }>(
                                    `/api/projects/${id}`,
                                    { method: 'GET' },
                                    token
                                  );

                                  const updatedConfig = {
                                    ...(project.config || {}),
                                    videoUrl: stitchedVideo,
                                    finalVideoUrl: stitchedVideo,
                                    videoCompleted: true,
                                    savedAt: new Date().toISOString(),
                                  };

                                  await apiRequest(
                                    `/api/projects/${id}`,
                                    {
                                      method: 'PATCH',
                                      body: JSON.stringify({
                                        config: updatedConfig,
                                      }),
                                    },
                                    token
                                  );
                                }

                                // 2. Download merged video locally immediately
                                try {
                                  const response = await fetch(finalVideoUrl);
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  const fileName = projectName 
                                    ? `${projectName}-final-video-${Date.now()}.mp4`
                                    : `project-${id}-final-video-${Date.now()}.mp4`;
                                  a.download = fileName;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                } catch (downloadError) {
                                  console.warn('Failed to download video locally:', downloadError);
                                  // Continue even if download fails
                                }

                                // 3. Save as asset in background (replaces previous version)
                                (async () => {
                                  try {
                                    await apiRequest(
                                      `/api/projects/${id}/assets`,
                                      {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          type: 'video',
                                          url: finalVideoUrl,
                                          filename: 'final-video.mp4',
                                          metadata: {
                                            source: 'stitched',
                                            hasAudio: audioTracks.length > 0,
                                            audioTrackCount: audioTracks.length,
                                            isFinal: true,
                                            savedAt: new Date().toISOString(),
                                          },
                                        }),
                                      },
                                      token
                                    );
                                  } catch (assetError) {
                                    console.warn('Could not save as asset:', assetError);
                                  }
                                })();

                                setVideoSavedToS3(true);
                              } catch (error: any) {
                                console.error('Error resaving video:', error);
                                alert(`Failed to resave video: ${error.message || 'Unknown error'}`);
                              } finally {
                                setIsSavingToS3(false);
                              }
                            }}
                            disabled={isSavingToS3}
                            className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white rounded-lg shadow-lg shadow-green-500/30 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSavingToS3 ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm font-medium">Resaving...</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-4 h-4" />
                                <span className="text-sm font-medium">Resave</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {isConcatenating ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-center">
                          <Loader2 className="w-8 h-8 animate-spin text-white mx-auto mb-2" />
                          <p className="text-white/70 text-sm">Concatenating scenes...</p>
                        </div>
                      </div>
                    ) : (
                      <video 
                        ref={videoRef}
                        src={editorVideoUrl || stitchedVideo || undefined} 
                        controls 
                        className="w-full h-full"
                        key={editorVideoUrl || stitchedVideo}
                        preload="metadata"
                        muted={false}
                        onTimeUpdate={(e) => {
                          const video = e.currentTarget;
                          setVideoCurrentTime(video.currentTime);
                        }}
                        onLoadedMetadata={(e) => {
                          const video = e.currentTarget;
                          setVideoDuration(video.duration);
                          console.log('Video metadata loaded successfully');
                        }}
                        onError={(e) => {
                          console.error('Failed to load video:', editorVideoUrl || stitchedVideo);
                          const target = e.currentTarget;
                          const error = target.error;
                          if (error) {
                            console.error('Video error code:', error.code, 'Message:', error.message);
                          }
                        }}
                        onLoadStart={() => {
                          console.log('Loading video from:', editorVideoUrl || stitchedVideo);
                        }}
                        onCanPlay={() => {
                          console.log('Video can play');
                        }}
                      />
                    )}
                  </div>
                  
                  {/* Timeline - Below video player */}
                  {(selectedScenesForEditor.length > 0 || stitchedVideo) && (
                    <div className="p-2 border-t border-white/10 bg-black/30 shrink-0">
                      <VideoTimeline
                        scenes={selectedScenesForEditor.length > 0 ? selectedScenesForEditor : scenes}
                        videoUrl={editorVideoUrl || stitchedVideo || undefined}
                        currentTime={videoCurrentTime}
                        duration={videoDuration}
                        audioTracks={audioTracks}
                        onAddMusic={() => {
                          setShowAddMusicModal(true);
                        }}
                        onEditMusic={(track) => {
                          setEditingTrack(track);
                          setShowEditMusicModal(true);
                        }}
                        onRemoveMusic={(trackId) => {
                          setAudioTracks(prev => prev.filter(t => t.id !== trackId));
                        }}
                        onMusicVolumeChange={(trackId, volume) => {
                          setAudioTracks(prev => prev.map(t => 
                            t.id === trackId ? { ...t, volume } : t
                          ));
                        }}
                        onSeek={(time) => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = time;
                            setVideoCurrentTime(time);
                          }
                        }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Empty Video Player with Overlay */}
                  <div className="relative w-full flex-1 bg-black/50 min-h-0 flex items-center justify-center">
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                      <div className="bg-black/60 backdrop-blur-sm rounded-lg p-8 border border-white/10">
                        <Video className="w-16 h-16 mx-auto mb-4 text-white/40" />
                        <h3 className="text-lg font-semibold text-white mb-2">No Video Found</h3>
                        <p className="text-sm text-white/60 mb-1">Final stitched video will appear here</p>
                        <p className="text-xs text-white/50 mb-4">Stitch scenes together to create your final video</p>
                        <button
                          onClick={async () => {
                            try {
                              const token = await getAccessToken();
                              if (token && id) {
                                console.log('Refreshing final video...');
                                const project = await apiRequest<{ 
                                  status?: string;
                                  config?: { 
                                    videoUrl?: string;
                                    finalVideoUrl?: string;
                                  } 
                                }>(`/api/projects/${id}`, { method: 'GET' }, token);
                                console.log('Refreshed project:', { 
                                  status: project.status, 
                                  videoUrl: project.config?.videoUrl,
                                  finalVideoUrl: project.config?.finalVideoUrl
                                });
                                // Prefer finalVideoUrl over videoUrl (matching initial load logic)
                                const videoUrlToUse = project.config?.finalVideoUrl || project.config?.videoUrl;
                                if (videoUrlToUse) {
                                  console.log('Setting final video URL from refresh:', videoUrlToUse);
                                  setStitchedVideo(videoUrlToUse);
                                  setVideoSavedToS3(project.status === 'completed');
                                } else {
                                  console.warn('No video URL found after refresh');
                                }
                              }
                            } catch (error) {
                              console.error('Error refreshing video:', error);
                            }
                          }}
                          className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all border border-white/20"
                        >
                          Refresh Video
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Timeline - Show empty when no video */}
                  <div className="p-2 border-t border-white/10 bg-black/30 shrink-0">
                    <VideoTimeline
                      scenes={scenes}
                      videoUrl={stitchedVideo || editorVideoUrl || undefined}
                      currentTime={videoCurrentTime}
                      duration={videoDuration}
                      audioTracks={audioTracks}
                      onAddMusic={() => {
                        setShowAddMusicModal(true);
                      }}
                      onEditMusic={(track) => {
                        setEditingTrack(track);
                        setShowEditMusicModal(true);
                      }}
                      onRemoveMusic={(trackId) => {
                        setAudioTracks(prev => prev.filter(t => t.id !== trackId));
                      }}
                      onMusicVolumeChange={(trackId, volume) => {
                        setAudioTracks(prev => prev.map(t => 
                          t.id === trackId ? { ...t, volume } : t
                        ));
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Chat */}
        <div className="w-96 border-l border-white/10 bg-black/20 backdrop-blur-xl flex flex-col">
          {/* Chat Header */}
          <div className="p-4 border-b border-white/10">
            <h2 className="text-sm font-semibold mb-2 text-white">AI Assistant</h2>
            {scriptPreview && (
              <button
                onClick={() => setShowScriptPreview(true)}
                className="text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 transition-colors"
              >
                <FileText className="w-3 h-3" />
                View Script
              </button>
            )}
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white'
                      : 'bg-white/10 text-white border border-white/10'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.attachments.map((att, idx) => (
                        <div key={idx} className="text-xs opacity-75">
                          📎 {att.filename}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="bg-white/10 border border-white/10 rounded-lg px-3 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="p-4 border-t border-white/10">
            <form onSubmit={handleChatSubmit} className="space-y-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about your project, upload assets, or request changes..."
                className="w-full rounded-lg border border-white/10 bg-black/30 backdrop-blur-sm px-3 py-2 text-sm text-white placeholder-white/40 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                rows={3}
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="text-xs px-2 py-1.5 rounded border border-white/10 bg-black/30 backdrop-blur-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50 appearance-none cursor-pointer hover:bg-white/10 transition-colors"
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 0.5rem center',
                      backgroundSize: '12px 8px',
                      paddingRight: '1.75rem',
                    }}
                  >
                    <optgroup label="OpenAI">
                      <option value="openai/gpt-4o-mini">GPT-4o Mini (Base)</option>
                      <option value="openai/gpt-4o">GPT-4o (Pro)</option>
                      <option value="openai/o3-mini">O3 Mini (Base)</option>
                      <option value="openai/o3">O3 (Pro)</option>
                    </optgroup>
                    <optgroup label="Anthropic">
                      <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku (Base)</option>
                      <option value="anthropic/claude-3.7-sonnet">Claude 3.7 Sonnet (Pro)</option>
                    </optgroup>
                    <optgroup label="Google">
                      <option value="google/gemini-2.0-flash">Gemini 2.0 Flash (Base)</option>
                      <option value="google/gemini-2.5-pro">Gemini 2.5 Pro (Pro)</option>
                    </optgroup>
                    <optgroup label="DeepSeek">
                      <option value="deepseek/deepseek-r1">DeepSeek R1 (Base)</option>
                      <option value="deepseek/deepseek-v3">DeepSeek V3 (Pro)</option>
                    </optgroup>
                    <optgroup label="Other">
                      <option value="x-ai/grok-3">Grok 3</option>
                      <option value="meta-llama/llama-4-scout">Llama 4 Scout</option>
                    </optgroup>
                  </select>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 hover:bg-white/10 rounded transition-colors"
                    title="Upload files"
                  >
                    <Upload className="w-4 h-4 text-white/70" />
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isChatLoading}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all shadow-lg shadow-blue-500/30"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
        </div>
      </div>

      {/* Script Preview Modal */}
      {showScriptPreview && scriptPreview && (
        <ScriptPreview
          script={scriptPreview}
          onClose={() => setShowScriptPreview(false)}
        />
      )}

      {/* Preview Modal */}
      <PreviewModal
        items={previewItems}
        initialIndex={previewInitialIndex}
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
      />

      {/* Video Editor */}
      {showVideoEditor && stitchedVideo && (
        <VideoEditor
          videoUrl={stitchedVideo}
          scenes={scenes}
          projectId={id}
          onSave={async (editedVideoUrl) => {
            setStitchedVideo(editedVideoUrl);
            setShowVideoEditor(false);
          }}
          onClose={() => setShowVideoEditor(false)}
        />
      )}

      {/* Edit Music Modal */}
      {showEditMusicModal && editingTrack && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-black/90 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Edit Audio Track</h3>
              <button
                onClick={() => {
                  setShowEditMusicModal(false);
                  setEditingTrack(null);
                }}
                className="p-1 hover:bg-white/10 rounded transition-colors text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Track Name
                </label>
                <input
                  type="text"
                  value={editingTrack.name || ''}
                  onChange={(e) => {
                    setEditingTrack({ ...editingTrack, name: e.target.value });
                  }}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter track name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Start Time (seconds)
                </label>
                <input
                  type="number"
                  min="0"
                  max={videoDuration}
                  step="0.1"
                  value={editingTrack.startTime}
                  onChange={(e) => {
                    const startTime = Math.max(0, Math.min(videoDuration, parseFloat(e.target.value) || 0));
                    setEditingTrack({ ...editingTrack, startTime });
                  }}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Duration (seconds)
                </label>
                <input
                  type="number"
                  min="0.1"
                  max={videoDuration - editingTrack.startTime}
                  step="0.1"
                  value={editingTrack.duration}
                  onChange={(e) => {
                    const maxDuration = videoDuration - editingTrack.startTime;
                    const duration = Math.max(0.1, Math.min(maxDuration, parseFloat(e.target.value) || 0.1));
                    setEditingTrack({ ...editingTrack, duration });
                  }}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Volume: {Math.round(editingTrack.volume * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={editingTrack.volume}
                  onChange={(e) => {
                    setEditingTrack({ ...editingTrack, volume: parseFloat(e.target.value) });
                  }}
                  className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-xs text-white/50 mt-1">
                  <span>0%</span>
                  <span>100%</span>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowEditMusicModal(false);
                    setEditingTrack(null);
                  }}
                  className="flex-1 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (editingTrack) {
                      setAudioTracks(prev => prev.map(t => 
                        t.id === editingTrack.id ? editingTrack : t
                      ));
                      setShowEditMusicModal(false);
                      setEditingTrack(null);
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Music Modal */}
      {showAddMusicModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-black/90 border border-white/10 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Add Music</h3>
              <button
                onClick={() => setShowAddMusicModal(false)}
                className="p-1 hover:bg-white/10 rounded transition-colors text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Upload Audio File
                </label>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    try {
                      setIsAddingAudio(true);
                      const token = await getAccessToken();
                      
                      // Upload audio file
                      const { url: audioUrl } = await uploadFile(
                        file,
                        'audio',
                        token,
                        undefined,
                        id
                      );

                      // Apply audio to video immediately
                      if (stitchedVideo || editorVideoUrl) {
                        try {
                          const videoToUse = stitchedVideo || editorVideoUrl;
                          const result = await apiRequest<{ success: boolean; videoUrl: string }>(
                            `/api/projects/${id}/add-audio`,
                            {
                              method: 'POST',
                              body: JSON.stringify({ 
                                audioUrl: audioUrl,
                                volume: 0.5 // Default volume
                              }),
                            },
                            token
                          );

                          if (result.success && result.videoUrl) {
                            // Update the video URL with the one that has audio
                            if (stitchedVideo) {
                              setStitchedVideo(result.videoUrl);
                            } else if (editorVideoUrl) {
                              setEditorVideoUrl(result.videoUrl);
                            }
                            
                            // Add audio track to timeline
                            setAudioTracks(prev => [...prev, {
                              id: `audio-${Date.now()}`,
                              url: audioUrl,
                              startTime: 0,
                              duration: videoDuration || 0,
                              volume: 0.5,
                              name: file.name
                            }]);
                          }
                        } catch (audioError: any) {
                          console.error('Error applying audio to video:', audioError);
                          // Still add to timeline even if application fails
                          setAudioTracks(prev => [...prev, {
                            id: `audio-${Date.now()}`,
                            url: audioUrl,
                            startTime: 0,
                            duration: videoDuration || 0,
                            volume: 0.5,
                            name: file.name
                          }]);
                          alert(`Audio added to timeline but failed to apply to video: ${audioError.message || 'Unknown error'}`);
                        }
                      } else {
                        // No video yet, just add to timeline
                        setAudioTracks(prev => [...prev, {
                          id: `audio-${Date.now()}`,
                          url: audioUrl,
                          startTime: 0,
                          duration: videoDuration || 0,
                          volume: 0.5,
                          name: file.name
                        }]);
                      }
                      
                      setShowAddMusicModal(false);
                      // Reset file input
                      if (audioInputRef.current) {
                        audioInputRef.current.value = '';
                      }
                    } catch (error: any) {
                      console.error('Error adding music:', error);
                      alert(`Failed to add music: ${error.message || 'Unknown error'}`);
                    } finally {
                      setIsAddingAudio(false);
                    }
                  }}
                />
                <button
                  onClick={() => audioInputRef.current?.click()}
                  disabled={isAddingAudio}
                  className="w-full px-4 py-3 border-2 border-dashed border-white/20 hover:border-white/40 rounded-lg text-white/70 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isAddingAudio ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Adding music...
                    </>
                  ) : (
                    <>
                      <Music className="w-5 h-5" />
                      Choose Audio File
                    </>
                  )}
                </button>
              </div>

              <div className="text-xs text-white/50">
                Supported formats: MP3, WAV, AAC, OGG
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Edit Panel */}
      {showEditPanel && (editorVideoUrl || stitchedVideo) && (
        <VideoEditPanel
          videoUrl={editorVideoUrl || stitchedVideo || ''}
          projectId={id || ''}
          initialMode={editMode || undefined}
          onSave={(editedUrl) => {
            if (editorVideoUrl) {
              setEditorVideoUrl(editedUrl);
            } else {
              setStitchedVideo(editedUrl);
            }
            setShowEditPanel(false);
            setEditMode(null);
          }}
          onClose={() => {
            setShowEditPanel(false);
            setEditMode(null);
          }}
        />
      )}
      </div>
    </div>
  );
}

export default function ProjectEditorPage() {
  return (
    <ProtectedRoute>
      <ProjectEditorContent />
    </ProtectedRoute>
  );
}

