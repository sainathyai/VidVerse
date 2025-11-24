import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { uploadFile } from "../lib/upload";
import { Header } from "../components/Header";
import { VideoGenerationProgressModal } from "../components/VideoGenerationProgressModal";
import { SynchronousVideoProgressModal } from "../components/SynchronousVideoProgressModal";
import { ProjectConfirmationModal } from "../components/ProjectConfirmationModal";
import { PreviewModal } from "../components/PreviewModal";
import { Sparkles, ArrowRight, Settings, ArrowLeft, Pencil, Check, X, RotateCcw, Bot, Image as ImageIcon, FileText, ChevronRight, Loader2, Plus, Play, Video as VideoIcon, Upload } from "lucide-react";
import { AIChatPanel } from "../components/AIChatPanel";
import { LeftPanel } from "../components/SimpleCreate/LeftPanel";
import { MiddleSection } from "../components/SimpleCreate/MiddleSection";
import { extractProjectJSON, validateProjectData, normalizeProjectData } from "../lib/projectImport";

const MAX_ANCHOR_ASSETS = 5;

type AnchorImage = {
  id: string;
  assetId?: string;
  url: string;
  prompt: string;
  assetNumber: number;
  isTemporary?: boolean;
};

/**
 * Renumbers anchor images while preserving slot-based numbering when possible.
 * Asset numbers should always correspond to slot positions (slot 0 = asset 1, slot 1 = asset 2, etc.)
 * 
 * Strategy:
 * 1. If assets already have correct slot-based numbering (assetNumber matches their intended slot), preserve it
 * 2. If there are gaps (e.g., assets 1, 3, 5), fill them by shifting forward
 * 3. Always ensure final array is sorted by assetNumber
 */
const renumberAnchorImages = (images: AnchorImage[]): AnchorImage[] => {
  if (images.length === 0) return [];
  
  // Sort by current assetNumber to maintain order
  const sorted = [...images].sort((a, b) => a.assetNumber - b.assetNumber);
  
  // Check if assets are already in correct sequential order without gaps
  let hasGaps = false;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].assetNumber !== i + 1) {
      hasGaps = true;
      break;
    }
  }
  
  // If no gaps and numbers are sequential starting from 1, return as-is
  if (!hasGaps && sorted.length > 0 && sorted[0].assetNumber === 1) {
    return sorted.slice(0, MAX_ANCHOR_ASSETS);
  }
  
  // Otherwise, renumber sequentially to fill gaps
  // This preserves the relative order but ensures sequential numbering
  return sorted
    .slice(0, MAX_ANCHOR_ASSETS)
    .map((image, index) => ({
      ...image,
      assetNumber: index + 1, // Sequential numbering starting from 1
    }));
};

function SimpleCreateContent() {
  const [category, setCategory] = useState<"music_video" | "ad_creative" | "explainer">("ad_creative");
  const [lastCategory, setLastCategory] = useState<string | null>(null);
  
  // Category-specific prompts (matching NewProjectPage)
  const categoryPrompts = {
    music_video: "A cinematic music video with dynamic camera movements, vibrant colors, and smooth transitions between scenes. Include elements of modern urban landscapes and artistic visual effects.",
    ad_creative: "Create an elegant and sophisticated advertisement for luxury watches. Showcase the timepiece with close-up shots highlighting craftsmanship, premium materials, and timeless design. Include scenes of luxury lifestyle, refined settings, and emphasize the prestige and quality of the brand.",
    explainer: "An engaging explainer video that breaks down complex concepts into simple, visual narratives. Use clear animations, step-by-step demonstrations, and friendly narration. Include visual metaphors, diagrams, and real-world examples to make the information accessible and memorable.",
  };

  const [projectName, setProjectName] = useState("");
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [tempProjectName, setTempProjectName] = useState("");
  const [prompt, setPrompt] = useState(categoryPrompts.ad_creative);
  const [style, setStyle] = useState("realistic");
  const [mood, setMood] = useState("serious");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState(30); // Default to 30 seconds (will be split into max 4 scenes of ~8s each)
  const [colorPalette, setColorPalette] = useState("warm");
  const [pacing, setPacing] = useState("medium");
  const [videoModelId, setVideoModelId] = useState('google/veo-3.1');
  const [imageModelId, setImageModelId] = useState('google/imagen-4-ultra');
  const [useReferenceFrame, setUseReferenceFrame] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(false); // Default to false - user opts in
  const [continuous, setContinuous] = useState(false);
  const [parallel, setParallel] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectNamePreview, setProjectNamePreview] = useState<string>('');
  const [generationResult, setGenerationResult] = useState<{
    videoUrl: string;
    sceneUrls: string[];
    frameUrls: Array<{ first: string; last: string }>;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [modalStep, setModalStep] = useState<'confirm' | 'script' | 'generating' | 'completed'>('confirm');
  const [generatedScript, setGeneratedScript] = useState<string>('');
  const [editedScript, setEditedScript] = useState<string>('');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [anchorImagePrompts, setAnchorImagePrompts] = useState<string[]>(['']);
  const [expandedAssetIndex, setExpandedAssetIndex] = useState<number | null>(0); // Default to asset 1 (index 0)
  const [isGeneratingAssets, setIsGeneratingAssets] = useState<boolean[]>([]);
  const [generatedAnchorImages, setGeneratedAnchorImages] = useState<AnchorImage[]>([]);
  const [showAnchorImageModal, setShowAnchorImageModal] = useState(false);
  const [selectedAnchorImageIndex, setSelectedAnchorImageIndex] = useState(0);
  
  // Scene management
  interface Scene {
    id: string;
    prompt: string;
    videoUrl?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    extendPrevious: boolean;
    selectedAssetIds: string[];
    selectedAssetNumbers?: number[]; // Store asset numbers for checkbox checking before assets are generated
    isGenerating: boolean;
  }
  const [scenes, setScenes] = useState<Scene[]>([
    { id: 'scene-1', prompt: '', extendPrevious: false, selectedAssetIds: [], isGenerating: false },
  ]);
  const [showSceneModal, setShowSceneModal] = useState<{ sceneId: string; isOpen: boolean; currentIndex: number }>({ sceneId: '', isOpen: false, currentIndex: 0 });
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [musicPrompt, setMusicPrompt] = useState<string>('');
  const [generatedMusicUrl, setGeneratedMusicUrl] = useState<string | null>(null);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
  const [isStitching, setIsStitching] = useState(false);
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectIdFromUrl = searchParams.get('projectId');
  
  // Auto-save debounce timers
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const isLoadingProjectRef = useRef<string | null>(null);

  const loadProjectAssets = useCallback(async (projectId: string): Promise<string[] | null> => {
    try {
      const token = await getAccessToken();
      if (!token) {
        return null;
      }

      const assets = await apiRequest<Array<{ id: string; type: string; url: string; filename: string; metadata?: Record<string, any> }>>(
        `/api/projects/${projectId}/assets`,
        { method: 'GET' },
        token
      );

      if (!assets || assets.length === 0) {
        setGeneratedAnchorImages([]);
        return null;
      }

      // Sort assets by saved assetNumber from metadata, then by array index as fallback
      const imageAssets: AnchorImage[] = assets
        .filter(asset => asset.type === 'image')
        .slice(0, MAX_ANCHOR_ASSETS)
        .map((asset, index) => ({
          id: asset.id,
          assetId: asset.id,
          url: asset.url,
          prompt: (asset.metadata?.prompt as string) || asset.filename || `Asset ${index + 1}`,
          assetNumber: (asset.metadata?.assetNumber as number) || (index + 1), // Use saved assetNumber if available
          isTemporary: false,
        }))
        .sort((a, b) => a.assetNumber - b.assetNumber); // Sort by assetNumber to preserve order

      const renumberedAssets = renumberAnchorImages(imageAssets);
      setGeneratedAnchorImages(renumberedAssets);

      // Extract prompts from assets for use in text boxes
      const assetPrompts = imageAssets.map(asset => asset.prompt || '');
      while (assetPrompts.length < MAX_ANCHOR_ASSETS) {
        assetPrompts.push('');
      }
      return assetPrompts.slice(0, MAX_ANCHOR_ASSETS);
    } catch (error) {
      console.error('Failed to load project assets:', error);
      return null;
    }
  }, [getAccessToken]);

  // Prebuilt options
  const styleOptions = [
    { value: "cinematic", label: "Cinematic" },
    { value: "animated", label: "Animated" },
    { value: "realistic", label: "Realistic" },
    { value: "abstract", label: "Abstract" },
    { value: "minimalist", label: "Minimalist" },
    { value: "vibrant", label: "Vibrant" },
    { value: "documentary", label: "Documentary" },
  ];

  const moodOptions = [
    { value: "energetic", label: "Energetic" },
    { value: "calm", label: "Calm" },
    { value: "mysterious", label: "Mysterious" },
    { value: "joyful", label: "Joyful" },
    { value: "dramatic", label: "Dramatic" },
    { value: "uplifting", label: "Uplifting" },
    { value: "serious", label: "Serious" },
    { value: "playful", label: "Playful" },
  ];

  const aspectRatioOptions = [
    { value: "16:9", label: "16:9 (Landscape)", description: "YouTube, TV" },
    { value: "9:16", label: "9:16 (Vertical)", description: "TikTok, Reels" },
    { value: "1:1", label: "1:1 (Square)", description: "Instagram" },
    { value: "4:5", label: "4:5 (Portrait)", description: "Instagram Posts" },
  ];

  const durationOptions = [
    { value: 30, label: "30 seconds", description: "Default - 4 scenes" },
    { value: 60, label: "60 seconds", description: "8 scenes" },
    { value: 90, label: "90 seconds", description: "12 scenes" },
    { value: 120, label: "120 seconds", description: "15 scenes" },
    { value: 240, label: "240 seconds", description: "30 scenes" },
  ];

  const colorPaletteOptions = [
    { value: "vibrant", label: "Vibrant", description: "Bold & colorful" },
    { value: "muted", label: "Muted", description: "Soft & subtle" },
    { value: "monochrome", label: "Monochrome", description: "Black & white" },
    { value: "warm", label: "Warm", description: "Oranges & reds" },
    { value: "cool", label: "Cool", description: "Blues & greens" },
  ];

  const pacingOptions = [
    { value: "fast", label: "Fast", description: "Quick cuts" },
    { value: "medium", label: "Medium", description: "Balanced" },
    { value: "slow", label: "Slow", description: "Cinematic" },
  ];

  const videoModelOptions = [
    { value: 'openai/sora-2-pro', label: 'Sora 2 Pro' },
    { value: 'google/veo-3', label: 'Veo 3' },
    { value: 'google/veo-3.1', label: 'Veo 3.1' },
    { value: 'google/veo-3-fast', label: 'Veo 3 Fast' },
    { value: 'openai/sora-2', label: 'Sora 2' },
    { value: 'kwaivgi/kling-v2.5-turbo-pro', label: 'Kling 2.5 Turbo Pro' },
  ];

  const imageModelOptions = [
    { value: 'openai/dall-e-3', label: 'DALL-E 3' },
    { value: 'google/nano-banana', label: 'Nano Banana' },
    { value: 'google/imagen-4-ultra', label: 'Imagen 4 Ultra' },
    { value: 'google/imagen-4', label: 'Imagen 4' },
  ];

  const glassSelectStyle = {
    paddingRight: '2.75rem',
    backgroundImage: 'linear-gradient(135deg, rgba(24,48,84,0.85), rgba(40,24,80,0.85), rgba(62,20,66,0.75))',
    backgroundColor: 'rgba(5, 8, 18, 0.95)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  };

  const glassTextareaStyle = {
    backgroundImage: 'linear-gradient(135deg, rgba(24,48,84,0.8), rgba(40,24,80,0.78), rgba(62,20,66,0.72))',
    backgroundColor: 'rgba(6, 8, 20, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
  };

  // Update prompt when category changes
  const handleCategoryChange = (newCategory: typeof category) => {
    setCategory(newCategory);
    if (categoryPrompts[newCategory] && newCategory !== lastCategory) {
      setPrompt(categoryPrompts[newCategory]);
      setLastCategory(newCategory);
    }
  };

  // Generate a better project name from prompt
  const generateProjectName = async (prompt: string, category: string, token: string): Promise<string> => {
    const promptLower = prompt.toLowerCase();
    
    // Try to extract product type first (before brand)
    const productTypes = [
      { pattern: /(?:smartphone|phone|mobile)/i, name: 'Smartphone' },
      { pattern: /(?:watch|timepiece)/i, name: 'Watch' },
      { pattern: /(?:laptop|computer)/i, name: 'Laptop' },
      { pattern: /(?:car|vehicle|automobile)/i, name: 'Car' },
      { pattern: /(?:headphones|earbuds)/i, name: 'Headphones' },
      { pattern: /(?:camera)/i, name: 'Camera' },
      { pattern: /(?:shoes|sneakers)/i, name: 'Shoes' },
      { pattern: /(?:perfume|fragrance)/i, name: 'Perfume' },
      { pattern: /(?:jewelry|jewellery)/i, name: 'Jewelry' },
      { pattern: /(?:sunglasses)/i, name: 'Sunglasses' },
    ];
    
    let productType: string | null = null;
    for (const { pattern, name } of productTypes) {
      if (pattern.test(prompt)) {
        productType = name;
        break;
      }
    }
    
    // Try to extract descriptors/adjectives (luxury, premium, etc.)
    const descriptors = [];
    if (/\bluxury\b/i.test(prompt)) descriptors.push('Luxury');
    if (/\bpremium\b/i.test(prompt)) descriptors.push('Premium');
    if (/\bnew\b/i.test(prompt)) descriptors.push('New');
    if (/\blatest\b/i.test(prompt)) descriptors.push('Latest');
    if (/\belegant\b/i.test(prompt)) descriptors.push('Elegant');
    if (/\bsophisticated\b/i.test(prompt)) descriptors.push('Sophisticated');
    
    // Try to extract brand name (common patterns)
    const brandPatterns = [
      /(?:for|about|advertisement for|ad for|commercial for)\s+([A-Z][a-zA-Z0-9\s&]+?)(?:\s+(?:watches?|products?|brand|company|service|app|software|game|restaurant|hotel|cafe|store|shop|business))?/i,
      /([A-Z][a-zA-Z0-9\s&]{2,30}?)\s+(?:watches?|products?|brand|company|service|app|software|game|restaurant|hotel|cafe|store|shop|business)/i,
    ];
    
    let brandName: string | null = null;
    for (const pattern of brandPatterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        let extracted = match[1].trim();
        // Clean up common words
        extracted = extracted.replace(/\b(an|a|the|for|about|advertisement|ad|commercial|luxury|premium|new|latest|elegant|sophisticated)\b/gi, '').trim();
        // Only use if it's a proper brand name (starts with capital, reasonable length)
        if (extracted.length >= 2 && extracted.length < 30 && /^[A-Z]/.test(extracted)) {
          brandName = extracted;
          break;
        }
      }
    }
    
    // Build name with descriptors, product type, and category suffix
    const categorySuffix = category === 'ad_creative' ? 'Ad' : category === 'music_video' ? 'Video' : 'Video';
    
    // If we have descriptors and product type, use them
    if (descriptors.length > 0 && productType) {
      const descriptorStr = descriptors[0]; // Use first descriptor
      // Check for existing projects with same base name to get number
      try {
        const existingProjects = await apiRequest<Array<{ name?: string }>>('/api/projects', { method: 'GET' }, token);
        const projectNames = existingProjects.map(p => p.name || '').filter(Boolean);
        
        const baseName = `${descriptorStr} ${productType} ${categorySuffix}`;
        let maxNumber = 0;
        
        // Find existing projects with same base name
        for (const name of projectNames) {
          const match = name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`));
          if (match) {
            if (match[1]) {
              const num = parseInt(match[1], 10);
              if (num > maxNumber) maxNumber = num;
            } else {
              // No number means it's the first one
              if (maxNumber === 0) maxNumber = 1;
            }
          }
        }
        
        return maxNumber > 0 ? `${baseName} ${maxNumber + 1}` : baseName;
      } catch (error) {
        return `${descriptorStr} ${productType} ${categorySuffix} 1`;
      }
    }
    
    // Build name from brand and product type
    if (brandName && productType) {
      return `${brandName} ${productType} ${categorySuffix}`;
    } else if (brandName) {
      return `${brandName} ${categorySuffix}`;
    } else if (productType) {
      // Just product type - check for existing to get number
      try {
        const existingProjects = await apiRequest<Array<{ name?: string }>>('/api/projects', { method: 'GET' }, token);
        const projectNames = existingProjects.map(p => p.name || '').filter(Boolean);
        
        const baseName = `${productType} ${categorySuffix}`;
        let maxNumber = 0;
        
        for (const name of projectNames) {
          const match = name.match(new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`));
          if (match) {
            if (match[1]) {
              const num = parseInt(match[1], 10);
              if (num > maxNumber) maxNumber = num;
            } else {
              if (maxNumber === 0) maxNumber = 1;
            }
          }
        }
        
        return maxNumber > 0 ? `${baseName} ${maxNumber + 1}` : baseName;
      } catch (error) {
        return `${productType} ${categorySuffix} 1`;
      }
    }
    
    // Fallback: Get existing projects to determine next number
    try {
      const existingProjects = await apiRequest<Array<{ name?: string }>>('/api/projects', { method: 'GET' }, token);
      const projectNames = existingProjects.map(p => p.name || '').filter(Boolean);
      
      // Find the highest "My Project X" number
      let maxNumber = 0;
      for (const name of projectNames) {
        const match = name.match(/^My Project (\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) {
            maxNumber = num;
          }
        }
      }
      
      return `My Project ${maxNumber + 1}`;
    } catch (error) {
      // If we can't fetch projects, just use "My Project 1"
      return 'My Project 1';
    }
  };

  // Auto-populate project name with sequential number
  const getAutoProjectName = async () => {
    try {
      const token = await getAccessToken();
      const existingProjects = await apiRequest<Array<{ name?: string }>>('/api/projects', { method: 'GET' }, token);
      const projectNames = existingProjects.map(p => p.name || '').filter(Boolean);
      
      // Find the highest "Project X" number
      let maxNumber = 0;
      for (const name of projectNames) {
        const match = name.match(/^Project (\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) {
            maxNumber = num;
          }
        }
      }
      
      return `Project ${maxNumber + 1}`;
    } catch (error) {
      return 'Project 1';
    }
  };

  // Initialize project name on mount
  // Load project data when projectId is provided in URL
  useEffect(() => {
    if (projectIdFromUrl) {
      // Prevent duplicate loading
      if (isLoadingProjectRef.current === projectIdFromUrl) {
        return; // Already loading this project
      }
      
      // Set current project ID immediately to prevent ensureProjectExists from creating a new project
      setCurrentProjectId(projectIdFromUrl);
      // Clear assets when switching projects
      setGeneratedAnchorImages([]);
      // Mark as loading
      isLoadingProjectRef.current = projectIdFromUrl;
      
      // Load project data (only once per projectId change)
      let cancelled = false;
      loadProjectData(projectIdFromUrl)
        .then(() => {
          if (!cancelled) {
            isLoadingProjectRef.current = null;
          }
        })
        .catch(err => {
          if (!cancelled) {
            console.error('Error loading project data:', err);
            isLoadingProjectRef.current = null;
          }
        });
      
      return () => {
        cancelled = true;
        // Only clear the ref if we're cancelling the same project
        if (isLoadingProjectRef.current === projectIdFromUrl) {
          isLoadingProjectRef.current = null;
        }
      };
    } else {
      // Clear assets when starting new project (no projectId in URL)
      setGeneratedAnchorImages([]);
      setCurrentProjectId(null);
      isLoadingProjectRef.current = null;
    }
  }, [projectIdFromUrl]); // Only depend on projectIdFromUrl to prevent duplicate calls

  const loadProjectData = async (projectId: string) => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      // Set current project ID FIRST to prevent ensureProjectExists from creating a new project
      setCurrentProjectId(projectId);

      const project = await apiRequest<any>(`/api/projects/${projectId}`, { method: 'GET' }, token);
      
      // Log the entire project object to see what fields are available
      console.log('[SimpleCreate] Project loaded from database:', {
        projectId: project.id,
        projectKeys: Object.keys(project),
        fullProject: project, // Log entire object to see all fields
        name: project.name,
        Name: project.Name, // Check for capitalized version
        projectName: project.projectName,
        displayName: project.displayName,
        // Check for lowercase PostgreSQL column names
        name_lower: (project as any).name,
        // Check if name is in a nested object
        configName: project.config?.name
      });
      
      // Load final video URL from database (preferred) or config
      if (project.final_video_url) {
        setFinalVideoUrl(project.final_video_url);
      } else if (project.config?.finalVideoUrl) {
        setFinalVideoUrl(project.config.finalVideoUrl);
      } else if (project.config?.videoUrl) {
        setFinalVideoUrl(project.config.videoUrl);
      } else {
        setFinalVideoUrl(null);
      }
      
      // Load project data into form
      // Use the actual saved name from database - only generate display name if empty or generic
      // Check multiple possible name fields (case variations and nested locations)
      // PostgreSQL returns column names in lowercase, so check both cases
      let loadedProjectName = (
        project.name || 
        (project as any).Name || 
        (project as any).NAME ||
        project.projectName || 
        project.displayName ||
        project.config?.name ||
        (project as any)['name'] // Check with bracket notation
      );
      loadedProjectName = loadedProjectName !== undefined && loadedProjectName !== null 
        ? String(loadedProjectName).trim() 
        : '';
      
      console.log('[SimpleCreate] Loading project name from database:', {
        projectId: project.id,
        nameFromDB: project.name,
        trimmedName: loadedProjectName,
        isEmpty: !loadedProjectName,
        matchesGenericPattern: loadedProjectName ? /^project\s+\d+$/i.test(loadedProjectName) : false
      });
      
      // If project name is empty or matches generic pattern (like "project 1", "Project 1", etc.), 
      // generate a display name consistent with dashboard
      // But if it has a custom saved name, use that instead
      if (!loadedProjectName || /^project\s+\d+$/i.test(loadedProjectName)) {
        console.log('[SimpleCreate] Generating display name for project (empty or generic)');
        try {
          // Fetch all projects to determine the correct display name
          const allProjects = await apiRequest<any[]>('/api/projects', { method: 'GET' }, token);
          // Sort by creation date ascending to match dashboard logic (oldest = Project 1)
          const sortedProjects = [...allProjects].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          const projectIndex = sortedProjects.findIndex(p => p.id === project.id);
          if (projectIndex >= 0) {
            loadedProjectName = `Project ${projectIndex + 1}`;
            console.log('[SimpleCreate] Generated display name:', loadedProjectName);
          } else {
            // Fallback if project not found in list
            loadedProjectName = loadedProjectName || 'Project';
          }
        } catch (error) {
          console.error('Failed to fetch projects for display name:', error);
          // Fallback to original name or default
          loadedProjectName = loadedProjectName || 'Project';
        }
      } else {
        console.log('[SimpleCreate] Using saved custom name:', loadedProjectName);
      }
      // If loadedProjectName has a custom name (not empty, not generic), use it as-is
      // This preserves user-edited names
      
      setProjectName(loadedProjectName);
      if (project.prompt) setPrompt(project.prompt);
      if (project.category) setCategory(project.category as "music_video" | "ad_creative" | "explainer");
      
      // Load assets from database first (preferred method)
      const assetPromptsFromMetadata = await loadProjectAssets(projectId);
      
      // Load config
      if (project.config) {
        const config = project.config;
        if (config.style) setStyle(config.style);
        if (config.mood) setMood(config.mood);
        if (config.aspectRatio) setAspectRatio(config.aspectRatio);
        if (config.duration) setDuration(config.duration);
        if (config.colorPalette) setColorPalette(config.colorPalette);
        if (config.pacing) setPacing(config.pacing);
        if (config.videoModelId) setVideoModelId(config.videoModelId);
        if (config.imageModelId) setImageModelId(config.imageModelId);
        if (config.useReferenceFrame !== undefined) setUseReferenceFrame(config.useReferenceFrame);
        if (config.continuous !== undefined) setContinuous(config.continuous);
        
        // Load music prompt from config
        if (config.musicPrompt) setMusicPrompt(config.musicPrompt);
        if (config.musicUrl) setGeneratedMusicUrl(config.musicUrl);
        
        // Load saved asset prompts from config (similar to scene prompts)
        // Priority: config prompts > asset metadata prompts > empty
        if (config.anchorImagePrompts && Array.isArray(config.anchorImagePrompts) && config.anchorImagePrompts.length > 0) {
          // Always use saved prompts from config (user's latest input) - highest priority
          const savedPrompts = [...config.anchorImagePrompts];
          // Ensure we have enough slots (pad with empty strings if needed)
          while (savedPrompts.length < MAX_ANCHOR_ASSETS) {
            savedPrompts.push('');
          }
          // Set the prompts, prioritizing saved ones
          setAnchorImagePrompts(savedPrompts.slice(0, MAX_ANCHOR_ASSETS));
          const nonEmptyCount = savedPrompts.filter(p => p && p.trim()).length;
          // Ensure asset 1 (index 0) is expanded by default
          setExpandedAssetIndex(0);
        } else if (assetPromptsFromMetadata && assetPromptsFromMetadata.some(p => p && p.trim())) {
          // If no saved prompts in config, use prompts from asset metadata
          setAnchorImagePrompts(assetPromptsFromMetadata);
          const nonEmptyCount = assetPromptsFromMetadata.filter(p => p && p.trim()).length;
          // Ensure asset 1 (index 0) is expanded by default
          setExpandedAssetIndex(0);
        } else {
          // If no prompts anywhere, ensure we have at least one empty slot
          setAnchorImagePrompts(['']);
          // Ensure asset 1 (index 0) is expanded by default
          setExpandedAssetIndex(0);
        }
        
        // Note: Scene prompts from config will be merged AFTER loading scenes from database
        // This is handled in the scenes loading section below
        
        // Fallback: Load anchor images from config if no assets in database
        // (for backward compatibility with old projects)
        const currentAssets = generatedAnchorImages;
        if (currentAssets.length === 0) {
        if (config.reference_images && Array.isArray(config.reference_images)) {
            const anchorImages: AnchorImage[] = config.reference_images.slice(0, MAX_ANCHOR_ASSETS).map((url: string, index: number) => ({
              id: `legacy-anchor-${Date.now()}-${index}`,
              url,
            prompt: `Reference image ${index + 1}`,
              assetNumber: index + 1,
              isTemporary: true,
          }));
            setGeneratedAnchorImages(renumberAnchorImages(anchorImages));
        } else if (config.referenceImages && Array.isArray(config.referenceImages)) {
          // Try alternative key name
            const anchorImages: AnchorImage[] = config.referenceImages.slice(0, MAX_ANCHOR_ASSETS).map((url: string, index: number) => ({
              id: `legacy-anchor-${Date.now()}-${index}`,
              url,
            prompt: `Reference image ${index + 1}`,
              assetNumber: index + 1,
              isTemporary: true,
          }));
            setGeneratedAnchorImages(renumberAnchorImages(anchorImages));
          }
        }
        
        // Load scenes from database (URLs from PostgreSQL, prompts from config)
        try {
          const scenesData = await apiRequest<any[]>(`/api/projects/${projectId}/scenes`, { method: 'GET' }, token);
          
          if (scenesData && scenesData.length > 0) {
            // Sort scenes by sceneNumber to ensure correct order (handle cases where scene_number might start from 2)
            const sortedScenesData = [...scenesData].sort((a: any, b: any) => {
              const aNum = a.sceneNumber || a.scene_number || 0;
              const bNum = b.sceneNumber || b.scene_number || 0;
              return aNum - bNum;
            });
            
            // Map database scenes to frontend Scene format
            // Backend already merges prompts from config, so we use what's returned
            const loadedScenes: Scene[] = sortedScenesData.map((scene: any, arrayIndex: number) => {
              const displayNumber = arrayIndex + 1; // Frontend display number (1-based, starting from 1)
              const backendSceneNumber = scene.sceneNumber || scene.scene_number || displayNumber;
              
              
              return {
                id: scene.id || `scene-${displayNumber}`,
                prompt: scene.prompt || '', // Prompt comes from config (merged by backend)
                videoUrl: scene.videoUrl, // Video URL always from database (PostgreSQL)
                firstFrameUrl: scene.firstFrameUrl, // Always from database
                lastFrameUrl: scene.lastFrameUrl, // Always from database
                extendPrevious: false, // Default to false - user can change it via checkbox
                selectedAssetIds: [],
                isGenerating: false,
              };
            });
            
            // Merge additional config data (selectedAssetIds, extendPrevious) if available
            if (config.scenePrompts && Array.isArray(config.scenePrompts)) {
              const mergedScenes = loadedScenes.map((scene, index) => {
                const savedPrompt = config.scenePrompts.find((sp: { id?: string; prompt?: string }) => sp.id === scene.id) || config.scenePrompts[index];
                if (savedPrompt) {
                  return {
                    ...scene,
                    // Keep prompt from backend (already merged from config)
                    // But update other properties from config
                    selectedAssetIds: savedPrompt.selectedAssetIds ? [...savedPrompt.selectedAssetIds] : (scene.selectedAssetIds ? [...scene.selectedAssetIds] : []), // Create new array copy to avoid reference sharing
                    extendPrevious: savedPrompt.extendPrevious !== undefined ? savedPrompt.extendPrevious : scene.extendPrevious,
                  };
                }
                return scene;
              });
              setScenes(mergedScenes);
            } else {
              setScenes(loadedScenes);
            }
          } else {
            // If no scenes in database, create empty scenes from config prompts only (no video URLs)
            if (config.scenePrompts && Array.isArray(config.scenePrompts) && config.scenePrompts.length > 0) {
              const loadedScenes: Scene[] = config.scenePrompts.map((sp: { id?: string; prompt?: string; selectedAssetIds?: string[]; extendPrevious?: boolean }) => ({
                id: sp.id || `scene-${Date.now()}-${Math.random()}`,
                prompt: sp.prompt || '',
                extendPrevious: sp.extendPrevious || false,
                selectedAssetIds: sp.selectedAssetIds ? [...sp.selectedAssetIds] : [], // Create new array copy to avoid reference sharing
                isGenerating: false,
                // No video URLs - they must come from database
              }));
              setScenes(loadedScenes);
            } else if (config.script?.scenes && Array.isArray(config.script.scenes)) {
              // Load scenes from script (prompts only, no video URLs)
              const loadedScenes: Scene[] = config.script.scenes.map((scene: any, index: number) => ({
                id: `scene-${index + 1}`,
                prompt: scene.prompt || '',
                extendPrevious: index === 0 ? false : (index > 0), // First scene always false
                selectedAssetIds: [],
                isGenerating: false,
                // No video URLs - they must come from database
              }));
              setScenes(loadedScenes);
            }
          }
        } catch (scenesError) {
          console.error('Error loading scenes from database:', scenesError);
          // On error, only load prompts from config (no video URLs)
          if (config.scenePrompts && Array.isArray(config.scenePrompts) && config.scenePrompts.length > 0) {
            const loadedScenes: Scene[] = config.scenePrompts.map((sp: { id?: string; prompt?: string; selectedAssetIds?: string[]; extendPrevious?: boolean }) => ({
              id: sp.id || `scene-${Date.now()}-${Math.random()}`,
              prompt: sp.prompt || '',
              extendPrevious: sp.extendPrevious || false,
              selectedAssetIds: sp.selectedAssetIds ? [...sp.selectedAssetIds] : [], // Create new array copy to avoid reference sharing
              isGenerating: false,
              // No video URLs - they must come from database
            }));
            setScenes(loadedScenes);
          }
        }
      }
    } catch (error: any) {
      console.error('Error loading project data:', error);
      alert(`Failed to load project: ${error.message || 'Unknown error'}`);
    }
  };

  useEffect(() => {
    // IMPORTANT: Never auto-generate name if we have a projectIdFromUrl (loading existing project)
    // The project name will be loaded from the database in loadProjectData
    // Only auto-generate project name for NEW projects (no projectIdFromUrl)
    
    // Early return: NEVER auto-generate for existing projects
    if (projectIdFromUrl) {
      return;
    }
    
    // Only auto-generate for NEW projects (no projectIdFromUrl)
    // Only auto-generate if we don't already have a project name set
    if (!projectName.trim()) {
      getAutoProjectName().then(name => {
        // Double-check: only set if still no name and still no projectIdFromUrl
        // (user might have navigated to a project while this was running)
        if (!projectIdFromUrl && !projectName.trim()) {
          setProjectName(name);
        }
      });
    }
    
    // Clear assets when starting a new project (no projectId in URL)
    // Assets should only be loaded from project config, not localStorage
    setGeneratedAnchorImages([]);
  }, [projectIdFromUrl]); // Only depend on projectIdFromUrl - don't re-run when projectName changes

  // Ensure expandedAssetIndex is set if we have assets but it's null
  useEffect(() => {
    if (generatedAnchorImages.length > 0 && expandedAssetIndex === null) {
      setExpandedAssetIndex(0);
    }
  }, [generatedAnchorImages, expandedAssetIndex]);

  // Note: Assets are loaded in loadProjectData, so we don't need a separate useEffect here
  // This was causing double-loading and potential race conditions
  // useEffect(() => {
  //   if (currentProjectId) {
  //     loadProjectAssets(currentProjectId);
  //   }
  // }, [currentProjectId, loadProjectAssets]);

  // Auto-save function to save prompts and settings to project config
  const autoSaveProject = useCallback(async () => {
    if (!currentProjectId) {
      return; // No project to save to yet
    }

    try {
      setIsAutoSaving(true);
      const token = await getAccessToken();
      if (!token) {
        return;
      }

      // Prepare config with asset prompts and scene prompts
      const configToSave: any = {
        anchorImagePrompts: anchorImagePrompts.filter(p => p.trim().length > 0),
        scenePrompts: scenes.map(scene => ({
          id: scene.id,
          prompt: scene.prompt,
          selectedAssetIds: scene.selectedAssetIds,
          extendPrevious: scene.extendPrevious,
        })),
        // Also save current settings
        style,
        mood,
        aspectRatio,
        duration,
        colorPalette,
        pacing,
        videoModelId,
        imageModelId,
        useReferenceFrame,
        continuous,
        musicPrompt,
      };

      // Update project config via PATCH
      await apiRequest(`/api/projects/${currentProjectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          config: configToSave,
        }),
      }, token);

    } catch (error) {
      console.error('[AUTO-SAVE] Failed to save project:', error);
      // Don't show error to user - auto-save should be silent
    } finally {
      setIsAutoSaving(false);
    }
  }, [currentProjectId, anchorImagePrompts, scenes, style, mood, aspectRatio, duration, colorPalette, pacing, videoModelId, imageModelId, useReferenceFrame, continuous, musicPrompt, getAccessToken]);

  // Auto-save asset prompts after 2 seconds of inactivity
  useEffect(() => {
    if (!currentProjectId) {
      return;
    }

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveProject();
    }, 5000); // 5 seconds debounce (reduced from 2 seconds)

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [anchorImagePrompts, scenes, currentProjectId, autoSaveProject]);

  // Auto-save project settings after 2 seconds of inactivity
  useEffect(() => {
    if (!currentProjectId) {
      return;
    }

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveProject();
    }, 5000); // 5 seconds debounce (reduced from 2 seconds)

    // Cleanup on unmount or when dependencies change
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [style, mood, aspectRatio, duration, colorPalette, pacing, videoModelId, imageModelId, useReferenceFrame, continuous, currentProjectId, autoSaveProject]);

  // Ensure a project exists - create one if needed
  const ensureProjectExists = useCallback(async (): Promise<string | null> => {
    // If we have a project ID from URL, ALWAYS use it (don't create a new project)
    // This prevents creating duplicate projects when opening from drafts
    if (projectIdFromUrl) {
      setCurrentProjectId(projectIdFromUrl);
      return projectIdFromUrl;
    }

    // If we already have a current project ID, use it
    if (currentProjectId) {
      return currentProjectId;
    }

    try {
      const token = await getAccessToken();
      if (!token) {
        return null;
      }

      // Generate project name if needed
      let finalProjectName = projectName.trim();
      if (!finalProjectName) {
        finalProjectName = await generateProjectName((prompt || '').trim(), category, token);
      }

      // Create project
      const project = await apiRequest<{ id: string; name?: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: finalProjectName,
          category,
          prompt: prompt.trim() || 'New project',
          duration,
          style,
          mood,
          aspectRatio,
          colorPalette,
          pacing,
          videoModelId,
          imageModelId,
          useReferenceFrame,
          continuous,
          mode: 'classic',
        }),
      }, token);

      setCurrentProjectId(project.id);
      if (project.name) {
        setProjectName(project.name);
      } else if (!projectName.trim()) {
        setProjectName(finalProjectName);
      }

      // Update URL to include project ID so it persists on refresh
      navigate(`/create?projectId=${project.id}`, { replace: true });

      return project.id;
    } catch (error) {
      console.error('Failed to create project:', error);
      return null;
    }
  }, [currentProjectId, projectName, prompt, category, duration, style, mood, aspectRatio, colorPalette, pacing, videoModelId, imageModelId, useReferenceFrame, continuous, getAccessToken]);

  const handleReorderAssets = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    
    // Reorder both prompts and images
    setAnchorImagePrompts(prev => {
      const newPrompts = [...prev];
      const [movedPrompt] = newPrompts.splice(fromIndex, 1);
      newPrompts.splice(toIndex, 0, movedPrompt);
      return newPrompts;
    });
    
    setGeneratedAnchorImages(prev => {
      const newImages = [...prev];
      // Find assets by their position (assetNumber - 1)
      const fromAsset = newImages.find(img => img.assetNumber === fromIndex + 1);
      const toAsset = newImages.find(img => img.assetNumber === toIndex + 1);
      
      if (fromAsset && toAsset) {
        // Swap asset numbers
        const tempNumber = fromAsset.assetNumber;
        fromAsset.assetNumber = toAsset.assetNumber;
        toAsset.assetNumber = tempNumber;
      } else if (fromAsset) {
        // Move fromAsset to toIndex position
        fromAsset.assetNumber = toIndex + 1;
      } else if (toAsset) {
        // Move toAsset to fromIndex position
        toAsset.assetNumber = fromIndex + 1;
      }
      
      // Renumber all assets to ensure sequential order
      return renumberAnchorImages(newImages);
    });
    
    // Update expanded index if needed
    if (expandedAssetIndex === fromIndex) {
      setExpandedAssetIndex(toIndex);
    } else if (expandedAssetIndex === toIndex) {
      setExpandedAssetIndex(fromIndex);
    }
  }, [expandedAssetIndex]);

  const handleRemoveAnchorImage = useCallback(async (image: AnchorImage) => {
    // Remove deleted asset ID from all scene selections
    setScenes(prev => prev.map(scene => ({
      ...scene,
      selectedAssetIds: scene.selectedAssetIds.filter(id => id !== image.id),
    })));

    // Optimistically update UI - filter out deleted asset
    const filteredImages = generatedAnchorImages.filter(img => img.id !== image.id);
    // Renumber remaining assets sequentially (Asset 2 becomes Asset 1, Asset 3 becomes Asset 2, etc.)
    const updatedImages = renumberAnchorImages(filteredImages);
    setGeneratedAnchorImages(updatedImages);

    if (!currentProjectId || !image.assetId) {
      // If no project or assetId, just update UI (temporary asset)
      return;
    }

    try {
      const token = await getAccessToken();
      if (!token) {
        return;
      }
      
      // Delete from database and S3
      await apiRequest(`/api/assets/${image.assetId}`, { method: 'DELETE' }, token);
      
      // Reload assets from database to ensure proper renumbering and sync with database
      // This ensures Asset 2 becomes Asset 1, Asset 3 becomes Asset 2, etc. based on created_at order
      await loadProjectAssets(currentProjectId);
    } catch (error) {
      console.error('Failed to delete asset:', error);
      // Reload assets even on error to sync with database state
      if (currentProjectId) {
        await loadProjectAssets(currentProjectId);
      }
    }
  }, [currentProjectId, getAccessToken, loadProjectAssets, generatedAnchorImages]);

  // Handle project name editing
  const startEditingProjectName = () => {
    setTempProjectName(projectName);
    setIsEditingProjectName(true);
  };

  const saveProjectName = async () => {
    const trimmed = tempProjectName.trim();
    let nameToSave = trimmed;
    
    if (!nameToSave) {
      const autoName = await getAutoProjectName();
      nameToSave = autoName;
    }
    
    console.log('[SimpleCreate] Saving project name:', {
      projectId: currentProjectId,
      nameToSave: nameToSave,
      trimmed: trimmed
    });
    
    setProjectName(nameToSave);
    setIsEditingProjectName(false);
    
    // Ensure project exists first, then save name
    const projectId = currentProjectId || await ensureProjectExists();
    
    if (projectId) {
      try {
        const token = await getAccessToken();
        if (token) {
          const response = await apiRequest(`/api/projects/${projectId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: nameToSave,
            }),
          }, token);
          console.log('[SimpleCreate] Project name saved successfully to database:', {
            projectId: projectId,
            savedName: nameToSave,
            response: response
          });
          
          // Update current project ID if it was just created
          if (!currentProjectId && projectId) {
            setCurrentProjectId(projectId);
          }
        } else {
          console.warn('[SimpleCreate] Cannot save project name - no auth token');
        }
      } catch (error: any) {
        console.error('[SimpleCreate] Error saving project name to database:', error);
        alert(`Failed to save project name: ${error.message || 'Unknown error'}`);
      }
    } else {
      console.warn('[SimpleCreate] Cannot save project name - no project ID available');
    }
  };

  const cancelEditingProjectName = () => {
    setTempProjectName("");
    setIsEditingProjectName(false);
  };

  // Calculate expected scene count based on duration
  const getExpectedSceneCount = (duration: number, promptLength: number): { min: number; max: number } => {
    const isComplex = promptLength > 200;
    
    if (duration <= 5) {
      return { min: 1, max: 2 };
    } else if (duration <= 15) {
      return { min: 2, max: 3 };
    } else if (duration <= 30) {
      return { min: 3, max: 5 };
    } else {
      // 5-8 scenes for 60 sec video
      const max = isComplex ? Math.min(8, Math.max(5, Math.floor(promptLength / 100))) : 5;
      return { min: 5, max };
    }
  };

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

  const handleGenerateScript = async () => {
    setIsGeneratingScript(true);
    setGenerationError(null);
    
    try {
      const token = await getAccessToken();
      if (!token) {
        setGenerationError('Authentication required. Please log in.');
        setIsGeneratingScript(false);
        return;
      }
      
      // Use user-entered name or generate one
      let finalProjectName = projectName.trim();
      if (!finalProjectName) {
        finalProjectName = await generateProjectName((prompt || '').trim(), category, token);
      }
      setProjectNamePreview(finalProjectName);
      
      // Create project first
      const project = await apiRequest<{ id: string; name?: string }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: finalProjectName,
          category,
          prompt: prompt.trim(),
          duration,
          style,
          mood,
          aspectRatio,
          colorPalette,
          pacing,
          videoModelId,
        imageModelId,
          mode: 'classic',
        }),
      }, token);

      setCurrentProjectId(project.id);
      
      // Generate script
      const scriptResult = await apiRequest<{
        script: string;
        scenes: Array<{
          sceneNumber: number;
          prompt: string;
          duration: number;
          startTime: number;
          endTime: number;
        }>;
      }>(
        `/api/projects/${project.id}/generate-script`,
        {
          method: 'POST',
          body: JSON.stringify({}), // Explicitly send empty JSON body
        },
        token
      );

      // Format script for display
      const formatScriptForDisplay = (scriptText: string): string => {
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

      const formattedScript = formatScriptForDisplay(scriptResult.script);
      setGeneratedScript(scriptResult.script); // Keep original JSON for backend
      setEditedScript(formattedScript); // Display formatted version
      setModalStep('script');
    } catch (error: any) {
      console.error('Error generating script:', error);
      setGenerationError(error.message || 'Failed to generate script. Please try again.');
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleConfirmScript = async () => {
    setIsProcessing(true);
    setIsCreating(true);
    setProgress(0);
    setCurrentStage('Initializing video generation...');
    setGenerationError(null);
    setGenerationResult(null);
    setModalStep('generating');
    
    try {
      const token = await getAccessToken();
      if (!token) {
        setGenerationError('Authentication required. Please log in.');
        setIsProcessing(false);
        setIsCreating(false);
        return;
      }
      
      // If no project exists yet, create one first
      let projectIdToUse = currentProjectId;
      if (!projectIdToUse) {
        let finalProjectName = projectName.trim();
        if (!finalProjectName) {
          finalProjectName = await generateProjectName((prompt || '').trim(), category, token);
        }
        setProjectNamePreview(finalProjectName);
        
        const project = await apiRequest<{ id: string; name?: string }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: finalProjectName,
            category,
            prompt: prompt.trim(),
            duration,
            style,
            mood,
            aspectRatio,
            colorPalette,
            pacing,
            videoModelId,
            imageModelId,
            useReferenceFrame,
            mode: 'classic',
          }),
        }, token);
        
        projectIdToUse = project.id;
        setCurrentProjectId(project.id);
      }

      // Update project with edited script
      // If editedScript is formatted text, extract the overall prompt from it
      // Otherwise, if it's JSON, extract the overallPrompt field
      let finalPrompt = prompt; // Default to current prompt
      
      if (editedScript && editedScript.trim()) {
        try {
          // Try to parse as JSON first
          const parsedScript = JSON.parse(editedScript);
          finalPrompt = parsedScript.overallPrompt || editedScript;
        } catch {
          // Not JSON - it's formatted text, extract the overall prompt
          const promptMatch = editedScript.match(/OVERALL PROMPT\s*\n([\s\S]+?)(?=\n\n|🎨|🎬|$)/);
          if (promptMatch) {
            finalPrompt = promptMatch[1].trim();
          } else {
            // If no match, use the entire text (user might have edited it)
            finalPrompt = editedScript.trim();
          }
        }
      } else if (generatedScript) {
        // If editedScript is empty but we have generatedScript, use that
        try {
          const parsedScript = JSON.parse(generatedScript);
          finalPrompt = parsedScript.overallPrompt || generatedScript;
        } catch {
          finalPrompt = generatedScript;
        }
      }
      
      // Update project with the final prompt, full script, and current model selection
      if (projectIdToUse) {
        const updateData: any = {};
        if (finalPrompt) {
          updateData.prompt = finalPrompt;
        }
        // Always update videoModelId to use current selection (user may have changed it)
        if (videoModelId) {
          updateData.videoModelId = videoModelId;
        }
        
        // CRITICAL: Save the full script JSON to config.script so it can be used during video generation
        // The script contains detailed scene prompts (1000+ chars each) that must be used
        const scriptToSave = editedScript && editedScript.trim() ? editedScript : generatedScript;
        if (scriptToSave && scriptToSave.trim()) {
          // Get current project config to merge with
          const currentProject = await apiRequest<{ config?: any }>(
            `/api/projects/${projectIdToUse}`,
            { method: 'GET' },
            token
          );
          
          const currentConfig = currentProject.config || {};
          // Save the full script JSON to config.script
          // This ensures the detailed scene prompts (1000+ chars each) are available for video generation
          currentConfig.script = scriptToSave;
          // Save anchor images (reference_images) for Veo 3.1
          if (generatedAnchorImages.length > 0) {
            currentConfig.referenceImages = generatedAnchorImages.map(img => img.url);
            console.log('Saving reference images to config:', {
              count: generatedAnchorImages.length,
              urls: generatedAnchorImages.map(img => img.url.substring(0, 100) + '...'),
            });
          }
          updateData.config = currentConfig;
          
          console.log('Saving full script to config.script:', {
            scriptLength: scriptToSave.length,
            scriptPreview: scriptToSave.substring(0, 200) + '...',
          });
        }
        
        if (Object.keys(updateData).length > 0) {
          await apiRequest(`/api/projects/${projectIdToUse}`, {
            method: 'PATCH',
            body: JSON.stringify(updateData),
          }, token);
        }
      }
      
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 99) {
            clearInterval(progressInterval);
            return 99;
          }
          const newProgress = prev + Math.random() * 3;
          setCurrentStage(getProgressStage(newProgress));
          return Math.min(newProgress, 99);
        });
      }, 1000);
      
      // Call synchronous generation endpoint
      // Send current settings to override database config (user may have changed settings)
      try {
        const result = await apiRequest<{
          status: string;
          videoUrl: string;
          sceneUrls: string[];
          frameUrls: Array<{ first: string; last: string }>;
        }>(
          `/api/projects/${projectIdToUse}/generate-sync`,
          {
            method: 'POST',
            body: JSON.stringify({
              useReferenceFrame,
              continuous,
              videoModelId,
              aspectRatio,
              style,
              mood,
              colorPalette,
              pacing,
              referenceImages: generatedAnchorImages.map(img => img.url), // Pass anchor images as reference_images
              withAudio: includeAudio, // Include audio only if user opts in
            }),
          },
          token
        );

        clearInterval(progressInterval);
        setProgress(100);
        setCurrentStage('Video generation complete!');
        setGenerationResult({
          videoUrl: result.videoUrl,
          sceneUrls: result.sceneUrls,
          frameUrls: result.frameUrls,
        });
        setModalStep('completed');
      } catch (genError: any) {
        clearInterval(progressInterval);
        console.error('Video generation error:', genError);
        
        // Extract error message from various possible error formats
        // apiRequest uses fetch API, so errors have different structure than axios
        let errorMessage = 'Video generation failed. Please try again.';
        
        if (typeof genError === 'string') {
          errorMessage = genError;
        } else if (genError?.message) {
          errorMessage = genError.message;
        } else if (genError?.error?.message) {
          errorMessage = genError.error.message;
        } else if (genError?.response?.data?.message) {
          errorMessage = genError.response.data.message;
        }
        
        // Handle "Failed to fetch" - network/CORS error
        if (errorMessage === 'Failed to fetch' || genError?.message === 'Failed to fetch') {
          errorMessage = 'Network error: Unable to connect to the server. Please check your connection and try again.';
        }
        
        // Log error details in a serializable format
        const errorDetails: Record<string, any> = {
          message: errorMessage,
          errorType: genError?.constructor?.name || typeof genError,
        };
        
        // Safely extract error properties
        if (genError?.statusCode) {
          errorDetails.statusCode = genError.statusCode;
        }
        if (genError?.response?.status) {
          errorDetails.status = genError.response.status;
        }
        if (genError?.response?.data) {
          errorDetails.responseData = genError.response.data;
        }
        if (genError?.stack) {
          errorDetails.stack = genError.stack.split('\n').slice(0, 5).join('\n');
        }
        
        console.error('Error details:', errorDetails);
        setGenerationError(errorMessage);
        setProgress(0);
      }
    } catch (error: any) {
      console.error('Error generating video:', error);
      setGenerationError(error.message || 'Failed to generate video. Please try again.');
      setProgress(0);
    } finally {
      setIsCreating(false);
      setIsProcessing(false);
    }
  };

  const handleGenerationComplete = (videoUrl: string) => {
    // Don't navigate - modal stays open to show results
  };

  const handleGenerationError = (error: string) => {
    alert(`Video generation failed: ${error}`);
    setShowProgressModal(false);
  };

  const handleCloseProgressModal = () => {
    setShowProgressModal(false);
    setGenerationResult(null);
    setShowConfirmationModal(false);
    setIsProcessing(false);
    setProgress(0);
    setCurrentStage('');
    setGenerationError(null);
    // Navigate to dashboard to see the project
    if (currentProjectId) {
      navigate('/dashboard');
    }
  };

  const handleCloseConfirmationModal = () => {
    if (!isProcessing && !isGeneratingScript) {
      setShowConfirmationModal(false);
      setGenerationResult(null);
      setIsProcessing(false);
      setProgress(0);
      setCurrentStage('');
      setGenerationError(null);
      setModalStep('confirm');
      setGeneratedScript('');
      setEditedScript('');
      if (currentProjectId && generationResult) {
        navigate('/dashboard');
      }
    }
  };

  const handleBackToConfirm = () => {
    setModalStep('confirm');
    setGeneratedScript('');
    setEditedScript('');
  };

  // Prepare scene modal content
  const sceneModalContent = (() => {
    if (!showSceneModal.isOpen) return null;
    const scene = scenes.find(s => s.id === showSceneModal.sceneId);
    if (!scene || !scene.videoUrl) return null;
    
    const sceneIndex = scenes.findIndex(s => s.id === scene.id);
    const items = [
      ...(scene.videoUrl ? [{
        id: `${scene.id}-video`,
        type: 'video' as const,
        url: scene.videoUrl,
        title: `Scene ${sceneIndex + 1} Video`,
        description: scene.prompt,
      }] : []),
      ...(scene.firstFrameUrl ? [{
        id: `${scene.id}-first`,
        type: 'image' as const,
        url: scene.firstFrameUrl,
        title: 'First Frame',
        description: 'First frame of the scene',
      }] : []),
      ...(scene.lastFrameUrl ? [{
        id: `${scene.id}-last`,
        type: 'image' as const,
        url: scene.lastFrameUrl,
        title: 'Last Frame',
        description: 'Last frame of the scene',
      }] : []),
    ];
    
    return (
      <PreviewModal
        items={items}
        initialIndex={showSceneModal.currentIndex}
        isOpen={showSceneModal.isOpen}
        onClose={() => setShowSceneModal({ sceneId: '', isOpen: false, currentIndex: 0 })}
      />
    );
  })();

  // Handler functions for MiddleSection component
  const handleAddAssetSlot = useCallback(() => {
    if (anchorImagePrompts.length >= MAX_ANCHOR_ASSETS) {
      alert(`Maximum ${MAX_ANCHOR_ASSETS} assets allowed`);
      return;
    }
    setAnchorImagePrompts(prev => [...prev, '']);
    setExpandedAssetIndex(anchorImagePrompts.length);
  }, [anchorImagePrompts.length]);

  const handleGenerateAnchorImage = useCallback(async (assetIndex: number) => {
    const prompt = anchorImagePrompts[assetIndex];
    if (!prompt.trim()) {
      alert('Please enter a description for the asset');
      return;
    }

    // Check if this slot already has an asset
    const existingAsset = generatedAnchorImages.find(img => img.assetNumber === assetIndex + 1);
    if (existingAsset && !confirm(`Asset ${assetIndex + 1} already exists. Replace it?`)) {
      return;
    }

    try {
      // Set this specific asset as generating
      setIsGeneratingAssets(prev => {
        const newState = [...prev];
        while (newState.length <= assetIndex) {
          newState.push(false);
        }
        newState[assetIndex] = true;
        return newState;
      });

      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      // Ensure project exists before generating asset (creates one if needed)
      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Generate image - will be saved to S3 and database automatically
      const result = await apiRequest<{ imageUrl: string; isTemporary?: boolean; message?: string; assetId?: string | null }>('/api/generate-image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt,
          imageModelId,
          aspectRatio,
          projectId: projectId, // Always provide projectId so asset is saved
          assetNumber: assetIndex + 1, // Save asset order/position
        }),
      }, token);

      if (result?.imageUrl) {
        const newImage: AnchorImage = {
          id: result.assetId || `anchor-${Date.now()}-${assetIndex}`,
          assetId: result.assetId || undefined,
          url: result.imageUrl,
          prompt: prompt,
          assetNumber: assetIndex + 1,
          isTemporary: Boolean(result.isTemporary),
        };

        // Replace existing asset or add new one
        setGeneratedAnchorImages(prev => {
          const filtered = prev.filter(img => img.assetNumber !== assetIndex + 1);
          const updated = renumberAnchorImages([...filtered, newImage]);
          
          // Convert placeholder slot IDs in scenes to actual asset IDs
          setScenes(currentScenes => {
            return currentScenes.map(scene => {
              const updatedSelectedIds = scene.selectedAssetIds
                .map(id => {
                  // Check if this is a placeholder slot ID (format: "slot-{index}")
                  if (id.startsWith('slot-')) {
                    const slotIndex = parseInt(id.replace('slot-', ''), 10);
                    // Find the asset at this slot index (assetNumber = slotIndex + 1)
                    const matchingAsset = updated.find(img => img.assetNumber === slotIndex + 1);
                    return matchingAsset ? matchingAsset.id : id; // Keep placeholder if asset not found yet
                  }
                  return id; // Already a real ID
                })
                .filter(id => {
                  // Remove placeholders that don't have matching assets yet, but keep real IDs
                  if (id.startsWith('slot-')) {
                    const slotIndex = parseInt(id.replace('slot-', ''), 10);
                    return updated.some(img => img.assetNumber === slotIndex + 1);
                  }
                  return true; // Keep all real IDs
                });
              
              return {
                ...scene,
                selectedAssetIds: updatedSelectedIds,
              };
            });
          });
          
          return updated;
        });

        // Clear the prompt for this asset
        setAnchorImagePrompts(currentPrompts => {
          const newPrompts = [...currentPrompts];
          newPrompts[assetIndex] = '';
          return newPrompts;
        });

        // Collapse the text box and move to next if available
        if (assetIndex < anchorImagePrompts.length - 1) {
          setExpandedAssetIndex(assetIndex + 1);
        } else {
          setExpandedAssetIndex(null);
        }

        // Reload assets from database to ensure sync
        if (result.assetId) {
          await loadProjectAssets(projectId);
        } else {
          setTimeout(async () => {
            await loadProjectAssets(projectId);
          }, 2000);
        }
      }
    } catch (error: any) {
      console.error('Error generating anchor image:', error);
      alert(`Failed to generate image: ${error.message || 'Unknown error'}`);
    } finally {
      setIsGeneratingAssets(prev => {
        const newState = [...prev];
        while (newState.length <= assetIndex) {
          newState.push(false);
        }
        newState[assetIndex] = false;
        return newState;
      });
    }
  }, [anchorImagePrompts, imageModelId, aspectRatio, getAccessToken, ensureProjectExists, loadProjectAssets, generatedAnchorImages]);

  const handleGenerateAllAssets = useCallback(async () => {
    // Find all assets with prompts
    const assetsToGenerate = anchorImagePrompts
      .map((prompt, index) => ({ prompt, index }))
      .filter(({ prompt }) => prompt.trim());

    if (assetsToGenerate.length === 0) {
      alert('Please enter descriptions for at least one asset');
      return;
    }

    try {
      // Set all assets as generating
      setIsGeneratingAssets(() => {
        const newState: boolean[] = [];
        assetsToGenerate.forEach(({ index }) => {
          while (newState.length <= index) {
            newState.push(false);
          }
          newState[index] = true;
        });
        return newState;
      });

      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Generate all assets in parallel - update state as each completes to maintain slot consistency
      // Each asset's slot position (index) is fixed and never changes, regardless of completion order
      const generationPromises = assetsToGenerate.map(async ({ prompt, index }) => {
        try {
          const result = await apiRequest<{ imageUrl: string; isTemporary?: boolean; message?: string; assetId?: string | null }>('/api/generate-image', {
            method: 'POST',
            body: JSON.stringify({
              prompt: prompt.trim(),
              imageModelId,
              aspectRatio,
              projectId: projectId,
            }),
          }, token);

          if (result?.imageUrl) {
            // Create the new image with assetNumber based on the original slot index (index + 1)
            // This ensures asset 3 always goes to slot 3, even if it completes first
            const newImage: AnchorImage = {
              id: result.assetId || `anchor-${Date.now()}-${index}`,
              assetId: result.assetId || undefined,
              url: result.imageUrl,
              prompt: prompt,
              assetNumber: index + 1, // Fixed slot position - never changes
              isTemporary: Boolean(result.isTemporary),
            };

            // Update state immediately when this asset completes
            // This ensures assets appear in their correct slots as soon as they're ready
            // CRITICAL: assetNumber is based on the original slot index (index + 1), never changes
            setGeneratedAnchorImages(prev => {
              // Remove any existing asset at this slot (assetNumber = index + 1)
              const filtered = prev.filter(img => img.assetNumber !== (index + 1));
              
              // Add the new asset - it already has the correct assetNumber based on slot position
              const updated = [...filtered, newImage];
              
              // Sort by assetNumber to maintain slot order in the array
              // This ensures the UI displays assets in the correct order (1, 2, 3, etc.)
              const sorted = updated.sort((a, b) => a.assetNumber - b.assetNumber);
              
              // DO NOT call renumberAnchorImages here - it would break slot-based numbering
              // The assetNumber is already correct: slot 0 → assetNumber 1, slot 1 → assetNumber 2, etc.
              return sorted;
            });

            // Convert placeholder slot IDs in scenes to actual asset IDs for this specific asset
            setScenes(currentScenes => {
              return currentScenes.map(scene => {
                const updatedSelectedIds = scene.selectedAssetIds
                  .map(id => {
                    // Check if this is a placeholder slot ID for this asset's slot
                    if (id === `slot-${index}`) {
                      // Use the new asset's ID directly
                      return newImage.id;
                    }
                    return id; // Keep other IDs as-is
                  });
                
                return {
                  ...scene,
                  selectedAssetIds: updatedSelectedIds,
                };
              });
            });

            return {
              index,
              result,
              prompt,
              newImage,
            };
          }
          return null;
        } catch (error: any) {
          console.error(`Error generating asset ${index + 1}:`, error);
          // Mark this asset as no longer generating
          setIsGeneratingAssets(prev => {
            const newState = [...prev];
            if (newState.length > index) {
              newState[index] = false;
            }
            return newState;
          });
          return { index, error: error.message || 'Unknown error' };
        }
      });

      // Wait for all promises to complete (for error handling and cleanup)
      const results = await Promise.allSettled(generationPromises);

      // Process results for error reporting and final cleanup
      const newImages: AnchorImage[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      results.forEach((settledResult) => {
        if (settledResult.status === 'fulfilled' && settledResult.value) {
          const result = settledResult.value;
          if ('error' in result) {
            errors.push({ index: result.index, error: result.error });
          } else if (result.newImage) {
            // Image was already added to state, just track it for cleanup
            newImages.push(result.newImage);
          }
        }
      });

      // Only delete old assets AFTER new ones are successfully generated
      // Delete only the assets that were successfully replaced
      if (newImages.length > 0) {
        const assetNumbersToReplace = new Set(newImages.map(img => img.assetNumber));
        const assetsToDelete = generatedAnchorImages.filter(img => 
          assetNumbersToReplace.has(img.assetNumber) && img.assetId
        );

        if (assetsToDelete.length > 0) {
          const deletePromises = assetsToDelete.map(async (asset) => {
            if (asset.assetId) {
              try {
                await apiRequest(`/api/assets/${asset.assetId}`, { method: 'DELETE' }, token);
              } catch (error) {
                console.error(`[GENERATE ALL] Failed to delete old asset ${asset.assetId}:`, error);
                // Continue even if deletion fails - new asset is already generated
              }
            }
          });
          await Promise.all(deletePromises);
        }

        // Final state update - assets were already added individually above
        // This is just to ensure consistency and handle any edge cases
        // DO NOT renumber - assets already have correct slot-based assetNumbers
        setGeneratedAnchorImages(prev => {
          // Assets were already added individually with correct assetNumbers
          // Just ensure they're sorted by assetNumber for display
          const sorted = [...prev].sort((a, b) => a.assetNumber - b.assetNumber);
          
          // Verify all assets have correct slot-based numbering (no gaps, sequential from 1)
          // If there are gaps, that's okay - we don't want to renumber and break slot positions
          return sorted;
        });
          
        // Convert placeholder slot IDs in scenes to actual asset IDs
        // Use the newImages array we just created (assets were already added to state individually)
        setScenes(currentScenes => {
          return currentScenes.map(scene => {
            const updatedSelectedIds = scene.selectedAssetIds
              .map(id => {
                // Check if this is a placeholder slot ID (format: "slot-{index}")
                if (id.startsWith('slot-')) {
                  const slotIndex = parseInt(id.replace('slot-', ''), 10);
                  // Find the asset at this slot index (assetNumber = slotIndex + 1)
                  // Use newImages array which has the assets we just generated
                  const matchingAsset = newImages.find(img => img.assetNumber === slotIndex + 1);
                  return matchingAsset ? matchingAsset.id : id; // Keep placeholder if asset not found yet
                }
                return id; // Already a real ID
              })
              .filter(id => {
                // Remove placeholders that don't have matching assets yet, but keep real IDs
                if (id.startsWith('slot-')) {
                  const slotIndex = parseInt(id.replace('slot-', ''), 10);
                  return newImages.some(img => img.assetNumber === slotIndex + 1);
                }
                return true; // Keep all real IDs
              });
            
            return {
              ...scene,
              selectedAssetIds: updatedSelectedIds,
            };
          });
        });

        // Clear prompts for successfully generated assets
        setAnchorImagePrompts(prev => {
          const newPrompts = [...prev];
          newImages.forEach(img => {
            newPrompts[img.assetNumber - 1] = '';
          });
          return newPrompts;
        });
      } else {
        // No assets were successfully generated - keep old ones untouched
      }

      // Collapse all text boxes
      setExpandedAssetIndex(null);

      // Log results to console (no popup)
      if (errors.length > 0) {
        console.warn(`${newImages.length} asset(s) generated successfully. ${errors.length} failed:`, errors);
      } else {
        console.log(`All ${newImages.length} asset(s) generated successfully!`);
      }

      // DO NOT reload assets from database - it will renumber them incorrectly
      // Assets are already in state with correct assetNumbers based on slot positions
      // The database order might differ from slot order, causing assets to be jumbled
    } catch (error: any) {
      console.error('Error generating all assets:', error);
      alert(`Failed to generate assets: ${error.message || 'Unknown error'}`);
    } finally {
      setIsGeneratingAssets([]);
    }
  }, [anchorImagePrompts, imageModelId, aspectRatio, getAccessToken, ensureProjectExists, loadProjectAssets, generatedAnchorImages]);

  const handleAnchorImageClick = useCallback((index: number) => {
    setSelectedAnchorImageIndex(index);
    setShowAnchorImageModal(true);
  }, []);

  const handleUploadAsset = useCallback(async (assetIndex: number, file: File) => {
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Upload file to S3
      const { url } = await uploadFile(
        file,
        'image',
        token,
        undefined,
        projectId
      );

      // Save asset to database
      const savedAsset = await apiRequest<{ id: string; type: string; url: string; filename: string; metadata?: Record<string, any> }>(
        `/api/projects/${projectId}/assets`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'image',
            url: url,
            filename: file.name,
            metadata: {
              prompt: anchorImagePrompts[assetIndex] || file.name,
              assetNumber: assetIndex + 1, // Save asset order/position
            },
          }),
        },
        token
      );

      // Create AnchorImage from uploaded asset
      const newImage: AnchorImage = {
        id: savedAsset.id,
        assetId: savedAsset.id,
        url: url,
        prompt: anchorImagePrompts[assetIndex] || file.name,
        assetNumber: assetIndex + 1,
        isTemporary: false,
      };

      // Replace existing asset or add new one
      setGeneratedAnchorImages(prev => {
        const filtered = prev.filter(img => img.assetNumber !== assetIndex + 1);
        const updated = renumberAnchorImages([...filtered, newImage]);
        return updated;
      });

      // Update prompt if empty
      if (!anchorImagePrompts[assetIndex]?.trim()) {
        setAnchorImagePrompts(prev => {
          const newPrompts = [...prev];
          newPrompts[assetIndex] = file.name;
          return newPrompts;
        });
      }
    } catch (error: any) {
      console.error('Error uploading asset:', error);
      alert(`Failed to upload asset: ${error.message || 'Unknown error'}`);
    }
  }, [getAccessToken, ensureProjectExists, anchorImagePrompts]);

  const handleScenePromptChange = useCallback((sceneId: string, prompt: string) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, prompt } : s));
  }, []);

  const handleSceneExtendPreviousChange = useCallback((sceneId: string, extend: boolean) => {
    setScenes(prev => prev.map((s, index) => {
      // First scene (index 0) can never have extendPrevious set to true
      if (s.id === sceneId) {
        if (index === 0 && extend) {
          // Prevent setting extendPrevious to true for first scene
          return { ...s, extendPrevious: false };
        }
        return { ...s, extendPrevious: extend };
      }
      return s;
    }));
  }, []);

  const handleSceneSelectedAssetIdsChange = useCallback((sceneId: string, assetIds: string[]) => {
    setScenes(prev => prev.map(s => {
      if (s.id !== sceneId) return s;
      
      // When manually changing selections, also update selectedAssetNumbers to match
      // Find asset numbers for the selected asset IDs
      const selectedAssetNumbers: number[] = assetIds
        .map(assetId => {
          const asset = generatedAnchorImages.find(img => img.id === assetId);
          return asset ? asset.assetNumber : null;
        })
        .filter((num): num is number => num !== null);
      
      return {
        ...s,
        selectedAssetIds: assetIds,
        selectedAssetNumbers: selectedAssetNumbers.length > 0 ? selectedAssetNumbers : undefined,
      };
    }));
  }, [generatedAnchorImages]);

  const handleSceneGenerate = useCallback(async (sceneIndex: number, scene: Scene) => {
    if (!scene.prompt.trim()) {
      alert('Please enter a prompt for the scene');
      return;
    }

    try {
      // Set scene as generating
      setScenes(prev => prev.map(s => 
        s.id === scene.id ? { ...s, isGenerating: true } : s
      ));

      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      // Ensure project exists
      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Get only the selected assets as reference images (multiple URLs)
      // Filter to only include assets that are checked/selected for this scene
      // Use current reference images from frontend state, sorted by assetNumber
      const selectedAssets = generatedAnchorImages
        .sort((a, b) => a.assetNumber - b.assetNumber)
        .filter(img => scene.selectedAssetIds.includes(img.id));
      const referenceImages = selectedAssets.map(img => img.url);

      // Get previous scene's video URL if extendPrevious is enabled
      let previousSceneVideoUrl: string | undefined;
      let previousSceneLastFrame: string | undefined;
      if (sceneIndex > 0) {
        const previousScene = scenes[sceneIndex - 1];
        if (scene.extendPrevious) {
          previousSceneVideoUrl = previousScene.videoUrl;
        }
        // For continuous mode, always get the last frame from previous scene
        if (continuous) {
          previousSceneLastFrame = previousScene.lastFrameUrl;
        }
      }

      // Build request payload
      // CRITICAL: First scene (sceneIndex 0) always prioritizes assets and never uses extendPrevious
      const isFirstScene = sceneIndex === 0;
      const requestPayload = {
        sceneIndex,
        prompt: scene.prompt,
        videoModelId,
        aspectRatio,
        style,
        mood,
        colorPalette,
        pacing,
        referenceImages: isFirstScene ? referenceImages : (scene.extendPrevious ? [] : referenceImages), // First scene always uses assets
        previousSceneVideoUrl: isFirstScene ? undefined : previousSceneVideoUrl, // First scene never extends previous
        previousSceneLastFrame: isFirstScene ? undefined : previousSceneLastFrame, // First scene never extends previous
        useReferenceFrame: isFirstScene ? false : (scene.extendPrevious && useReferenceFrame), // First scene never uses extendPrevious
        continuous: continuous,
        withAudio: includeAudio, // Include audio only if user opts in
      };

      // Call API to generate single scene
      const result = await apiRequest<{
        videoUrl: string;
        firstFrameUrl?: string;
        lastFrameUrl?: string;
      }>(
        `/api/projects/${projectId}/scenes/generate`,
        {
          method: 'POST',
          body: JSON.stringify(requestPayload),
        },
        token
      );

      // Update scene with generated video
      setScenes(prev => prev.map(s => 
        s.id === scene.id ? {
          ...s,
          videoUrl: result.videoUrl,
          firstFrameUrl: result.firstFrameUrl,
          lastFrameUrl: result.lastFrameUrl,
          isGenerating: false,
        } : s
      ));
    } catch (error: any) {
      console.error('Error generating scene:', error);
      alert(`Failed to generate scene: ${error.message || 'Unknown error'}`);
      
      // Set scene as not generating on error
      setScenes(prev => prev.map(s => 
        s.id === scene.id ? { ...s, isGenerating: false } : s
      ));
    }
  }, [getAccessToken, ensureProjectExists, generatedAnchorImages, scenes, videoModelId, aspectRatio, style, mood, colorPalette, pacing, useReferenceFrame, continuous, includeAudio]);

  const handleAddScene = useCallback(() => {
                  setScenes(prev => [...prev, {
                    id: `scene-${Date.now()}`,
                    prompt: '',
                    extendPrevious: false,
      selectedAssetIds: [],
                    isGenerating: false,
                  }]);
  }, []);

  const handleRemoveScene = useCallback((sceneId: string) => {
    setScenes(prev => prev.filter(s => s.id !== sceneId));
  }, []);

  const [generationProgress, setGenerationProgress] = useState<{
    progress: number;
    currentStage: string;
    jobId: string | null;
    cost: number | null;
  }>({
    progress: 0,
    currentStage: '',
    jobId: null,
    cost: null,
  });

  const handleGenerateAll = useCallback(async (forceParallel: boolean = false) => {
    // Validate all scenes have prompts
    const scenesWithoutPrompts = scenes.filter(s => !s.prompt.trim());
    if (scenesWithoutPrompts.length > 0) {
      alert(`Please enter prompts for all scenes before generating. ${scenesWithoutPrompts.length} scene(s) missing prompts.`);
      return;
    }

    setIsGeneratingAll(true);
    setGenerationProgress({ progress: 0, currentStage: 'Initializing...', jobId: null, cost: null });
    
    let pollInterval: NodeJS.Timeout | null = null;
    
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      // Ensure project exists
      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Set all scenes as generating
      setScenes(prev => prev.map(s => ({ ...s, isGenerating: true })));

      // Use forceParallel if provided, otherwise use the parallel checkbox state
      const useParallel = forceParallel || parallel;

      // Start polling for progress (will start after jobId is received)
      const startPolling = (jobId: string) => {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(async () => {
          try {
            const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
            const apiUrl = import.meta.env.VITE_API_URL || (isDev ? 'http://localhost:3001' : 'https://api.vidverseai.com');
            const response = await fetch(`${apiUrl}/api/jobs/${jobId}`, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            if (response.ok) {
              const jobStatus = await response.json();
              setGenerationProgress(prev => ({
                ...prev,
                progress: jobStatus.progress || 0,
                currentStage: jobStatus.current_stage || '',
                cost: jobStatus.cost_usd || null,
              }));

              // Stop polling if job is complete or failed
              if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
                if (pollInterval) {
                  clearInterval(pollInterval);
                  pollInterval = null;
                }
              }
            }
          } catch (pollError) {
            console.error('Error polling job status:', pollError);
          }
        }, 2000); // Poll every 2 seconds
      };

      // Call backend endpoint to generate all scenes
      const result = await apiRequest<{
        jobId?: string;
        finalVideoUrl: string;
        sceneUrls: string[];
        frameUrls: Array<{ first: string; last: string }>;
        cost?: number;
        totalDuration?: number;
      }>(
        `/api/projects/${projectId}/scenes/generate-all`,
        {
          method: 'POST',
          body: JSON.stringify({
            scenes: scenes.map((scene, index) => ({
              sceneIndex: index + 1, // 1-based indexing (Scene 1, 2, 3, 4, 5)
              prompt: scene.prompt,
              selectedAssetIds: scene.selectedAssetIds,
              extendPrevious: scene.extendPrevious,
            })),
            parallel: useParallel,
            continuous,
            useReferenceFrame,
            videoModelId,
            aspectRatio,
            style,
            mood,
            colorPalette,
            pacing,
            // Use current reference images from frontend state, not old saved data
            // Get all currently generated assets in order (by assetNumber)
            // Send asset ID to URL mapping so backend can filter reference images per scene
            assetIdToUrlMap: generatedAnchorImages
              .sort((a, b) => a.assetNumber - b.assetNumber)
              .reduce((acc, img) => {
                acc[img.id] = img.url;
                return acc;
              }, {} as Record<string, string>),
            withAudio: includeAudio, // Include audio only if user opts in
          }),
        },
        token
      );

      // Start polling if jobId is returned
      if (result.jobId) {
        setGenerationProgress(prev => ({ ...prev, jobId: result.jobId || null }));
        startPolling(result.jobId);
      }

      // Update all scenes with generated videos
      setScenes(prev => prev.map((scene, index) => ({
        ...scene,
        videoUrl: result.sceneUrls[index],
        firstFrameUrl: result.frameUrls[index]?.first,
        lastFrameUrl: result.frameUrls[index]?.last,
        isGenerating: false,
      })));

      // Update final video URL
      if (result.finalVideoUrl) {
        setFinalVideoUrl(result.finalVideoUrl);
      }

      // Update cost if provided
      if (result.cost !== undefined) {
        setGenerationProgress(prev => ({ ...prev, cost: result.cost || null, progress: 100 }));
      }

      // Show success message
      console.log('All scenes generated successfully! Final stitched video:', result.finalVideoUrl);
      if (result.cost !== undefined) {
        console.log(`Generation cost: $${result.cost.toFixed(2)}`);
      }
    } catch (error: any) {
      console.error('Error generating all scenes:', error);
      
      // Better error handling
      let errorMessage = 'Unknown error occurred';
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      }
      
      alert(`Failed to generate all scenes: ${errorMessage}`);
      
      // Set all scenes as not generating on error
      setScenes(prev => prev.map(s => ({ ...s, isGenerating: false })));
      
      // Update progress to show error
      setGenerationProgress(prev => ({ ...prev, progress: 0, currentStage: 'Error occurred' }));
    } finally {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      setIsGeneratingAll(false);
      // Reset progress after a delay to allow user to see final state
      setTimeout(() => {
        setGenerationProgress({ progress: 0, currentStage: '', jobId: null, cost: null });
      }, 5000);
    }
  }, [scenes, parallel, continuous, useReferenceFrame, videoModelId, aspectRatio, style, mood, colorPalette, pacing, generatedAnchorImages, getAccessToken, ensureProjectExists, includeAudio]);

  const handleSceneVideoClick = useCallback((sceneId: string) => {
    setShowSceneModal({ sceneId, isOpen: true, currentIndex: 0 });
  }, []);

  const handleGenerateMusic = useCallback(async () => {
    if (!musicPrompt.trim()) {
      alert('Please enter music input (JSON format)');
      return;
    }

    setIsGeneratingMusic(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Parse the input to extract lyrics, prompt, and optional parameters from JSON
      let extractedLyrics = '';
      let extractedPrompt = 'Jazz, Smooth Jazz, Romantic, Dreamy';
      let extractedBitrate = 256000;
      let extractedSampleRate = 44100;
      let extractedAudioFormat = 'mp3';

      // Try to parse as JSON
      try {
        // Try to find JSON-like structure in the input
        const jsonMatch = musicPrompt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          let jsonStr = jsonMatch[0];
          
          // Clean up trailing commas in JSON (make parser more lenient)
          // Remove trailing commas before closing braces and brackets
          jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
          
          const parsed = JSON.parse(jsonStr);
          
          // Extract lyrics (required)
          if (parsed.lyrics && typeof parsed.lyrics === 'string') {
            extractedLyrics = parsed.lyrics;
          }
          
          // Extract prompt (required by API, but we'll use default if not provided)
          // Validate and clean prompt: must be 10-300 characters, style-only
          if (parsed.prompt && typeof parsed.prompt === 'string') {
            let promptText = parsed.prompt.trim();
            
            // If prompt is too short, use default
            if (promptText.length < 10) {
              console.warn(`Prompt too short (${promptText.length} chars), using default`);
              extractedPrompt = 'Jazz, Smooth Jazz, Romantic, Dreamy';
            } else if (promptText.length > 300) {
              // If too long, truncate to 300 characters
              console.warn(`Prompt too long (${promptText.length} chars), truncating to 300`);
              extractedPrompt = promptText.substring(0, 300).trim();
            } else {
              extractedPrompt = promptText;
            }
          }
          
          // Extract optional parameters
          if (parsed.bitrate && typeof parsed.bitrate === 'number') {
            extractedBitrate = parsed.bitrate;
          }
          if (parsed.sample_rate && typeof parsed.sample_rate === 'number') {
            extractedSampleRate = parsed.sample_rate;
          }
          if (parsed.audio_format && typeof parsed.audio_format === 'string') {
            extractedAudioFormat = parsed.audio_format;
          }
          
          console.log('Parsed JSON from input:', { 
            hasLyrics: !!parsed.lyrics,
            hasPrompt: !!parsed.prompt,
            prompt: extractedPrompt,
            bitrate: extractedBitrate,
            sample_rate: extractedSampleRate,
            audio_format: extractedAudioFormat
          });
        } else {
          throw new Error('No JSON object found in input');
        }
      } catch (e) {
        console.error('Failed to parse JSON:', e);
        alert('Invalid JSON format. Please paste a valid JSON object with "lyrics" field (and optionally "prompt", "bitrate", "sample_rate", "audio_format").');
        return;
      }

      if (!extractedLyrics.trim()) {
        alert('No lyrics found in JSON. Please include a "lyrics" field.');
        return;
      }

      const result = await apiRequest<{ musicUrl: string }>(
        `/api/projects/${projectId}/generate-music`,
        {
          method: 'POST',
          body: JSON.stringify({
            lyrics: extractedLyrics,
            prompt: extractedPrompt,
            bitrate: extractedBitrate,
            sample_rate: extractedSampleRate,
            audio_format: extractedAudioFormat,
          }),
        },
        token
      );

      if (result.musicUrl) {
        setGeneratedMusicUrl(result.musicUrl);
        console.log('Music generated successfully:', result.musicUrl);
      }
    } catch (error: any) {
      console.error('Error generating music:', error);
      alert(`Failed to generate music: ${error.message || 'Unknown error'}`);
    } finally {
      setIsGeneratingMusic(false);
    }
  }, [musicPrompt, getAccessToken, ensureProjectExists]);

  const handleStitchScenes = useCallback(async () => {
    setIsStitching(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Authentication required. Please log in.');
        return;
      }

      const projectId = await ensureProjectExists();
      if (!projectId) {
        alert('Failed to create project. Please try again.');
        return;
      }

      // Send music URL if available, otherwise send empty object to satisfy Fastify JSON parser
      const body: { musicUrl?: string } = {};
      if (generatedMusicUrl) {
        body.musicUrl = generatedMusicUrl;
      }

      const result = await apiRequest<{ success: boolean; videoUrl: string; finalVideoUrl?: string; sceneCount: number; hasMusic: boolean }>(
        `/api/projects/${projectId}/stitch`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        token
      );

      if (result.videoUrl || result.finalVideoUrl) {
        const finalUrl = result.finalVideoUrl || result.videoUrl;
        setFinalVideoUrl(finalUrl);
        
        // Reload project data from database to ensure final video URL is properly saved
        try {
          const project = await apiRequest<any>(`/api/projects/${projectId}`, { method: 'GET' }, token);
          
          // Update final video URL from database (ensures it's saved)
          if (project.final_video_url) {
            setFinalVideoUrl(project.final_video_url);
          } else if (project.config?.finalVideoUrl) {
            setFinalVideoUrl(project.config.finalVideoUrl);
          } else if (project.config?.videoUrl) {
            setFinalVideoUrl(project.config.videoUrl);
          }
          
          console.log('Project data reloaded after stitching. Final video URL saved:', project.final_video_url || project.config?.finalVideoUrl);
        } catch (reloadError) {
          console.warn('Failed to reload project data after stitching:', reloadError);
          // Still use the URL from the stitch response
        }
        
        console.log(`Successfully stitched ${result.sceneCount} scene(s)${result.hasMusic ? ' with music' : ''}!`, finalUrl);
      }
    } catch (error: any) {
      console.error('Error stitching scenes:', error);
      alert(`Failed to stitch scenes: ${error.message || 'Unknown error'}`);
    } finally {
      setIsStitching(false);
    }
  }, [getAccessToken, ensureProjectExists, generatedMusicUrl]);

  // Import handler for structured project data from chat
  const handleImportProject = useCallback((projectData: {
    script?: string;
    assets?: Array<{ name: string; prompt: string }>;
    scenes?: Array<{ sceneNumber: number; prompt: string; assetIds: string[] }>;
    music?: { lyrics?: string; prompt?: string; bitrate?: string; sample_rate?: string; audio_format?: string };
    sceneAssetMap?: { [sceneNumber: string]: number[] }; // Map of scene numbers to asset numbers (1-based)
  }) => {
    try {
      // Import assets (limit to 5)
      if (projectData.assets && projectData.assets.length > 0) {
        const assetPrompts = projectData.assets.slice(0, 5).map(asset => asset.prompt);
        // Pad to 5 slots if needed
        while (assetPrompts.length < 5) {
          assetPrompts.push('');
        }
        setAnchorImagePrompts(assetPrompts);
        console.log(`[Import] Imported ${assetPrompts.filter(p => p).length} asset prompts`);
        console.log(`[Import] Asset prompts:`, assetPrompts.map((p, i) => ({ slot: i, prompt: p.substring(0, 50) + '...' })));
      }

      // Import scenes - merge with existing scenes to preserve video URLs
      if (projectData.scenes && projectData.scenes.length > 0) {
        setScenes(currentScenes => {
          const importedScenesData = projectData.scenes!
            .sort((a, b) => a.sceneNumber - b.sceneNumber);
          
          // Create a map of existing scenes by their index/ID to preserve URLs
          const existingScenesMap = new Map<string, Scene>();
          currentScenes.forEach((scene, idx) => {
            // Try to match by scene number if IDs match pattern, otherwise by index
            const sceneNum = scene.id.match(/scene-(\d+)/)?.[1];
            if (sceneNum) {
              existingScenesMap.set(sceneNum, scene);
            }
            existingScenesMap.set(idx.toString(), scene);
          });
          
          const mergedScenes: Scene[] = importedScenesData.map((scene, index) => {
            // Find existing scene to preserve URLs
            const existingScene = existingScenesMap.get(scene.sceneNumber.toString()) || 
                                 existingScenesMap.get(index.toString()) ||
                                 currentScenes[index];
            
            // Use sceneAssetMap as the source of truth - convert asset names/numbers to asset numbers (1-based)
            let selectedAssetNumbers: number[] = [];
            
            // Create a map from asset names to their position in the assets array (1-based)
            const assetNameToIndex = new Map<string, number>();
            if (projectData.assets) {
              projectData.assets.forEach((asset, idx) => {
                assetNameToIndex.set(asset.name, idx + 1); // 1-based asset number
              });
            }
            
            if (projectData.sceneAssetMap && projectData.sceneAssetMap[scene.sceneNumber.toString()]) {
              // sceneAssetMap may contain asset names (strings) or numbers - convert to numbers
              const sceneAssets = projectData.sceneAssetMap[scene.sceneNumber.toString()];
              selectedAssetNumbers = sceneAssets
                .map((item: string | number) => {
                  // If it's already a number, use it directly (1-based)
                  if (typeof item === 'number') {
                    return item;
                  }
                  // If it's a string (asset name), look it up in the assets array
                  return assetNameToIndex.get(item);
                })
                .filter((num): num is number => num !== undefined && num !== null);
              console.log(`[Import] Scene ${scene.sceneNumber}: Using sceneAssetMap - converted to asset numbers:`, selectedAssetNumbers);
            } else if (scene.assetIds && scene.assetIds.length > 0 && projectData.assets) {
              // Fallback: derive asset numbers from assetIds (asset names)
              selectedAssetNumbers = scene.assetIds
                .map(assetName => assetNameToIndex.get(assetName))
                .filter((num): num is number => num !== undefined);
              console.log(`[Import] Scene ${scene.sceneNumber}: Derived asset numbers from assetIds:`, selectedAssetNumbers);
            }

            // Convert asset numbers to actual asset IDs if assets already exist (for backend compatibility)
            let finalSelectedAssetIds: string[] = existingScene?.selectedAssetIds ? [...existingScene.selectedAssetIds] : []; // Create new array copy
            if (selectedAssetNumbers.length > 0 && generatedAnchorImages.length > 0) {
              // Assets exist - convert asset numbers to IDs for backend
              finalSelectedAssetIds = selectedAssetNumbers
                .map(assetNum => {
                  const matchingAsset = generatedAnchorImages.find(img => img.assetNumber === assetNum);
                  return matchingAsset ? matchingAsset.id : null;
                })
                .filter((id): id is string => id !== null);
            }

            // Merge imported data with existing scene, preserving URLs
            return {
              ...existingScene, // Preserve existing properties (videoUrl, firstFrameUrl, lastFrameUrl, etc.)
              id: existingScene?.id || `scene-${scene.sceneNumber}`, // Keep existing ID if available
              prompt: scene.prompt, // Update prompt from import
              extendPrevious: index === 0 ? false : (existingScene?.extendPrevious ?? (index > 0)), // First scene always false, preserve or set default for others
              selectedAssetIds: [...finalSelectedAssetIds], // Asset IDs for backend (if assets exist) - create new array copy
              selectedAssetNumbers: selectedAssetNumbers.length > 0 ? [...selectedAssetNumbers] : undefined, // Asset numbers from script - source of truth for checkboxes - create new array copy
              isGenerating: existingScene?.isGenerating ?? false, // Preserve generating state
            };
          });
          
          console.log(`[Import] Merged ${mergedScenes.length} scenes - preserved existing URLs, updated prompts and asset selections`);
          console.log(`[Import] Scene asset mappings (from script/sceneAssetMap):`, mergedScenes.map(s => ({ 
            sceneId: s.id, 
            selectedAssetNumbers: s.selectedAssetNumbers, // Source of truth from script
            selectedAssetIds: s.selectedAssetIds, // For backend compatibility
            hasVideoUrl: !!s.videoUrl 
          })));
          console.log(`[Import] Current generated assets:`, generatedAnchorImages.map(a => ({ id: a.id, assetNumber: a.assetNumber })));
          
          return mergedScenes;
        });
      }

      // Import music prompt as JSON string
      if (projectData.music) {
        const musicJSON = JSON.stringify(projectData.music, null, 2);
        setMusicPrompt(musicJSON);
        console.log('Imported music prompt:', projectData.music);
      }

      // Optionally set the main prompt to the script
      if (projectData.script) {
        setPrompt(projectData.script);
      }

      console.log(`Successfully imported ${projectData.assets?.length || 0} assets, ${projectData.scenes?.length || 0} scenes, and music prompt!`);
    } catch (error: any) {
      console.error('Error importing project data:', error);
      alert(`Failed to import project data: ${error.message}`);
    }
  }, [generatedAnchorImages]);

  // Handler to populate scenes - enable checkboxes based on sceneAssetMap
  const handlePopulateScenes = useCallback(() => {
    try {
      // Check sessionStorage for conversation data
      const quickCreateConversation = sessionStorage.getItem('quickCreateConversation');
      if (!quickCreateConversation) {
        alert('No project data found. Please generate a script in the AI chat first.');
        return;
      }

      const conversationData = JSON.parse(quickCreateConversation);
      if (!conversationData.messages || !Array.isArray(conversationData.messages)) {
        alert('No valid conversation data found.');
        return;
      }

      // Find the last assistant message with structured data
      let structuredData: any = null;
      for (let i = conversationData.messages.length - 1; i >= 0; i--) {
        const msg = conversationData.messages[i];
        if (msg.role === 'assistant' && msg.structuredData) {
          structuredData = msg.structuredData;
          break;
        }
        // Also try to extract from content if structuredData is not present
        if (msg.role === 'assistant' && msg.content) {
          try {
            const extracted = extractProjectJSON(msg.content);
            if (extracted && validateProjectData(extracted)) {
              structuredData = normalizeProjectData(extracted);
              break;
            }
          } catch (error) {
            // Continue searching
          }
        }
      }

      if (!structuredData || !structuredData.sceneAssetMap) {
        alert('No scene asset mapping found. Please generate a script with scene asset mapping in the AI chat first.');
        return;
      }

      const sceneAssetMap = structuredData.sceneAssetMap;
      console.log('[Populate] sceneAssetMap from data:', sceneAssetMap);
      
      // Create a map from asset names to their position in the assets array (1-based)
      const assetNameToIndex = new Map<string, number>();
      if (structuredData.assets) {
        structuredData.assets.forEach((asset: any, idx: number) => {
          assetNameToIndex.set(asset.name, idx + 1); // 1-based asset number
        });
      }
      console.log('[Populate] assetNameToIndex map:', Array.from(assetNameToIndex.entries()));

      // Update scenes with asset numbers from sceneAssetMap
      setScenes(currentScenes => {
        console.log('[Populate] Current scenes:', currentScenes.map((s, idx) => ({ id: s.id, index: idx, selectedAssetNumbers: s.selectedAssetNumbers, selectedAssetIds: s.selectedAssetIds })));
        console.log('[Populate] sceneAssetMap keys:', Object.keys(sceneAssetMap));
        console.log('[Populate] sceneAssetMap:', sceneAssetMap);
        
        return currentScenes.map((scene, sceneIndex) => {
          // Use sceneIndex + 1 as the scene number (1-based) to match sceneAssetMap keys
          // sceneIndex is 0-based: scene 0 -> scene number 1, scene 1 -> scene number 2, etc.
          const sceneNumber = String(sceneIndex + 1);
          
          console.log(`[Populate] Scene ID: ${scene.id}, sceneIndex: ${sceneIndex}, sceneNumber: ${sceneNumber}, available in map: ${sceneAssetMap[sceneNumber] ? 'YES' : 'NO'}`);
          
          // Check if this scene has a mapping in sceneAssetMap
          if (!sceneAssetMap[sceneNumber]) {
            console.log(`[Populate] Scene ${scene.id} (number ${sceneNumber}): No mapping found in sceneAssetMap, clearing selections`);
            // Clear selections if no mapping found (don't keep old selections)
            return {
              ...scene,
              selectedAssetNumbers: undefined,
              selectedAssetIds: [],
            };
          }

          // Get asset numbers for this scene from sceneAssetMap
          // CRITICAL: Create a new array for each scene to avoid reference issues
          const sceneAssets = sceneAssetMap[sceneNumber];
          if (!Array.isArray(sceneAssets)) {
            console.warn(`[Populate] Scene ${sceneNumber}: sceneAssetMap[${sceneNumber}] is not an array:`, sceneAssets);
            return {
              ...scene,
              selectedAssetNumbers: undefined,
              selectedAssetIds: [],
            };
          }
          
          // Create a fresh array for this scene's asset numbers
          const selectedAssetNumbers: number[] = sceneAssets
            .map((item: string | number): number | undefined => {
              // If it's already a number, use it directly (1-based)
              if (typeof item === 'number') {
                return item;
              }
              // If it's a string (asset name), look it up in the assets array
              return assetNameToIndex.get(item);
            })
            .filter((num: number | undefined): num is number => num !== undefined && num !== null);
          
          console.log(`[Populate] Scene ${sceneNumber}: sceneAssets from map:`, sceneAssets, '-> converted to numbers:', selectedAssetNumbers);

          // CRITICAL: Always clear old selectedAssetIds and convert asset numbers to IDs
          // This ensures API calls use the populated selection, not old selections
          let selectedAssetIds: string[] = [];
          if (selectedAssetNumbers.length > 0) {
            if (generatedAnchorImages.length > 0) {
              // Assets exist - convert numbers to IDs immediately for API calls
              selectedAssetIds = selectedAssetNumbers
                .map((assetNum: number): string | null => {
                  const matchingAsset = generatedAnchorImages.find(img => img.assetNumber === assetNum);
                  return matchingAsset ? matchingAsset.id : null;
                })
                .filter((id: string | null): id is string => id !== null);
            } else {
              // Assets don't exist yet - selectedAssetIds will be empty
              // selectedAssetNumbers will be used for checkbox checking
              // When assets are generated, they'll be converted via useEffect
              selectedAssetIds = [];
            }
          }

          console.log(`[Populate] Scene ${sceneNumber}: CLEARED old selections. New assetNumbers=[${selectedAssetNumbers.join(', ')}], new assetIds=[${selectedAssetIds.join(', ')}], oldIds=[${scene.selectedAssetIds.join(', ')}]`);

          // CRITICAL: Create new arrays to avoid reference sharing between scenes
          return {
            ...scene,
            selectedAssetNumbers: selectedAssetNumbers.length > 0 ? [...selectedAssetNumbers] : undefined, // New array copy
            selectedAssetIds: [...selectedAssetIds], // New array copy - always cleared and populated from sceneAssetMap
          };
        });
      });

      console.log(`Successfully populated asset checkboxes for ${Object.keys(sceneAssetMap).length} scenes based on scene asset mapping!`);
    } catch (error: any) {
      console.error('Error populating scenes:', error);
      alert(`Failed to populate scenes: ${error.message}`);
    }
  }, [generatedAnchorImages]);

  // Convert slot placeholders to actual asset IDs when assets are generated/loaded
  // This ensures checkboxes are automatically checked when importing projects
  useEffect(() => {
    if (generatedAnchorImages.length === 0) return;
    
    setScenes(currentScenes => {
      let hasChanges = false;
      const updatedScenes = currentScenes.map(scene => {
        const hasPlaceholders = scene.selectedAssetIds.some(id => id.startsWith('slot-'));
        const hasAssetNumbers = scene.selectedAssetNumbers && scene.selectedAssetNumbers.length > 0;
        
        // Only process if we have placeholders to convert OR selectedAssetNumbers to convert
        if (!hasPlaceholders && !hasAssetNumbers) return scene;
        
        hasChanges = true;
        const updatedSelectedIds = scene.selectedAssetIds
          .map(id => {
            // Check if this is a placeholder slot ID (format: "slot-{index}")
            if (id.startsWith('slot-')) {
              const slotIndex = parseInt(id.replace('slot-', ''), 10);
              // Find the asset at this slot index (assetNumber = slotIndex + 1, which is 1-based)
              // slot-0 should match assetNumber 1, slot-1 should match assetNumber 2, etc.
              const matchingAsset = generatedAnchorImages.find(img => img.assetNumber === slotIndex + 1);
              if (matchingAsset) {
                console.log(`[Import] Converting slot-${slotIndex} (Asset ${slotIndex + 1}) to asset ID ${matchingAsset.id}`);
                return matchingAsset.id;
              } else {
                console.log(`[Import] No asset found for slot-${slotIndex} (Asset ${slotIndex + 1}). Available assets:`, generatedAnchorImages.map(a => `Asset ${a.assetNumber} (ID: ${a.id})`));
              }
              return id; // Keep placeholder if asset not found yet
            }
            return id; // Already a real ID
          })
          .filter(id => {
            // Remove placeholders that don't have matching assets yet, but keep real IDs
            if (id.startsWith('slot-')) {
              const slotIndex = parseInt(id.replace('slot-', ''), 10);
              const hasMatchingAsset = generatedAnchorImages.some(img => img.assetNumber === slotIndex + 1);
              if (!hasMatchingAsset) {
                console.log(`[Import] Removing placeholder slot-${slotIndex} - no matching asset found`);
              }
              return hasMatchingAsset;
            }
            return true; // Keep all real IDs
          });
        
        if (updatedSelectedIds.length > 0 && updatedSelectedIds.some(id => !id.startsWith('slot-'))) {
          console.log(`[Import] Scene ${scene.id} updated: ${scene.selectedAssetIds.length} -> ${updatedSelectedIds.length} asset IDs:`, updatedSelectedIds);
        }
        
        // Also convert selectedAssetNumbers to actual IDs if they exist
        // CRITICAL: If selectedAssetNumbers exists, use it as the source of truth (from populate/import)
        // Don't merge with old selectedAssetIds - clear and replace to ensure API calls use populated selection
        let finalSelectedIds = updatedSelectedIds;
        if (scene.selectedAssetNumbers && scene.selectedAssetNumbers.length > 0) {
          const assetIdsFromNumbers = scene.selectedAssetNumbers
            .map(assetNum => {
              const matchingAsset = generatedAnchorImages.find(img => img.assetNumber === assetNum);
              return matchingAsset ? matchingAsset.id : null;
            })
            .filter((id): id is string => id !== null);
          
          // If we have selectedAssetNumbers, they are the source of truth - replace selectedAssetIds
          // This ensures API calls use the populated selection, not old selections
          if (assetIdsFromNumbers.length > 0) {
            finalSelectedIds = assetIdsFromNumbers;
            console.log(`[Asset Conversion] Scene ${scene.id}: Converted selectedAssetNumbers ${scene.selectedAssetNumbers} to assetIds ${assetIdsFromNumbers}`);
          }
        }
        
        return {
          ...scene,
          selectedAssetIds: finalSelectedIds,
          // Keep selectedAssetNumbers for checkbox checking even after conversion
          // They serve as fallback if selectedAssetIds is empty
          selectedAssetNumbers: scene.selectedAssetNumbers,
        };
      });
      
      if (hasChanges) {
        console.log(`[Import] Updated ${updatedScenes.filter((s, i) => s.selectedAssetIds !== currentScenes[i]?.selectedAssetIds).length} scenes with asset IDs`);
      }
      
      return hasChanges ? updatedScenes : currentScenes;
    });
  }, [generatedAnchorImages]);

  // Check for quick create import data on mount - ONLY for new projects (no projectIdFromUrl)
  useEffect(() => {
    // Only import quick create data if we're NOT loading an existing project
    if (!projectIdFromUrl) {
      const quickCreateData = sessionStorage.getItem('quickCreateProjectData');
      if (quickCreateData) {
        try {
          const projectData = JSON.parse(quickCreateData);
          handleImportProject(projectData);
          sessionStorage.removeItem('quickCreateProjectData');
        } catch (error) {
          console.error('Error importing quick create data:', error);
          sessionStorage.removeItem('quickCreateProjectData');
        }
      }
    }
  }, [projectIdFromUrl, handleImportProject]);

  return (
    <div className="min-h-screen relative overflow-hidden">
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

      <Header />
      
      <div className="relative z-10 min-h-[calc(100vh-4rem)] flex">
        {/* Left Panel - Settings */}
        <LeftPanel
          category={category}
          onCategoryChange={handleCategoryChange}
          style={style}
          onStyleChange={setStyle}
          mood={mood}
          onMoodChange={setMood}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          duration={duration}
          onDurationChange={setDuration}
          colorPalette={colorPalette}
          onColorPaletteChange={setColorPalette}
          pacing={pacing}
          onPacingChange={setPacing}
          videoModelId={videoModelId}
          onVideoModelIdChange={setVideoModelId}
          imageModelId={imageModelId}
          onImageModelIdChange={setImageModelId}
          useReferenceFrame={useReferenceFrame}
          onUseReferenceFrameChange={setUseReferenceFrame}
          includeAudio={includeAudio}
          onIncludeAudioChange={setIncludeAudio}
          styleOptions={styleOptions}
          moodOptions={moodOptions}
          aspectRatioOptions={aspectRatioOptions}
          durationOptions={durationOptions}
          colorPaletteOptions={colorPaletteOptions}
          pacingOptions={pacingOptions}
          videoModelOptions={videoModelOptions}
          imageModelOptions={imageModelOptions}
          glassSelectStyle={glassSelectStyle}
        />

        {/* Center Panel - Scrollable Content */}
        <MiddleSection
          projectName={projectName}
          isEditingProjectName={isEditingProjectName}
          tempProjectName={tempProjectName}
          onProjectNameChange={setTempProjectName}
          onStartEditingProjectName={startEditingProjectName}
          onSaveProjectName={saveProjectName}
          onCancelEditingProjectName={cancelEditingProjectName}
          anchorImagePrompts={anchorImagePrompts}
          onAnchorImagePromptChange={(index, prompt) => {
            setAnchorImagePrompts(prev => {
              const newPrompts = [...prev];
              newPrompts[index] = prompt;
              return newPrompts;
            });
          }}
          expandedAssetIndex={expandedAssetIndex}
          onExpandedAssetIndexChange={setExpandedAssetIndex}
          generatedAnchorImages={generatedAnchorImages}
          isGeneratingAssets={isGeneratingAssets}
          onGenerateAnchorImage={handleGenerateAnchorImage}
          onGenerateAllAssets={handleGenerateAllAssets}
          onAddAssetSlot={handleAddAssetSlot}
          onRemoveAnchorImage={handleRemoveAnchorImage}
          onAnchorImageClick={handleAnchorImageClick}
          scenes={scenes}
          onScenesChange={setScenes}
          onScenePromptChange={handleScenePromptChange}
          onSceneExtendPreviousChange={handleSceneExtendPreviousChange}
          onSceneSelectedAssetIdsChange={handleSceneSelectedAssetIdsChange}
          onSceneGenerate={handleSceneGenerate}
          onAddScene={handleAddScene}
          onRemoveScene={handleRemoveScene}
          onSceneVideoClick={handleSceneVideoClick}
          imageModelId={imageModelId}
          aspectRatio={aspectRatio}
          glassTextareaStyle={glassTextareaStyle}
          continuous={continuous}
          onContinuousChange={setContinuous}
          parallel={parallel}
          onParallelChange={setParallel}
          isGeneratingAll={isGeneratingAll}
          onGenerateAll={async () => await handleGenerateAll(false)}
          onGenerateAllParallel={async () => await handleGenerateAll(true)}
          onStitchScenes={handleStitchScenes}
          isStitching={isStitching}
          generationProgress={generationProgress}
          onReorderAssets={handleReorderAssets}
          musicPrompt={musicPrompt}
          onMusicPromptChange={setMusicPrompt}
          generatedMusicUrl={generatedMusicUrl}
          isGeneratingMusic={isGeneratingMusic}
          onGenerateMusic={handleGenerateMusic}
          finalVideoUrl={finalVideoUrl}
          onUploadAsset={handleUploadAsset}
          onPopulateScenes={handlePopulateScenes}
          projectId={currentProjectId}
        />

        {/* Right Panel - Reserved for future features */}
        <div className="w-96 flex-shrink-0">
          {/* Reserved space for future features */}
        </div>
      </div>

      {/* AI Chat Panel - Fixed on right side */}
      <AIChatPanel
        projectContext={{
          name: projectName,
          category,
          prompt,
          style,
          mood,
          aspectRatio,
          colorPalette,
          pacing,
          duration,
        }}
        onApplyPrompt={(promptText) => {
          setPrompt(promptText);
          // Scroll to prompt textarea
          const textarea = document.getElementById('prompt');
          if (textarea) {
            textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
            textarea.focus();
          }
        }}
        onImportProject={handleImportProject}
      />

      {/* Confirmation Modal */}
      <ProjectConfirmationModal
        isOpen={showConfirmationModal}
        projectData={{
          name: projectNamePreview || prompt.trim().substring(0, 50) || 'Untitled Project',
          category,
          prompt: prompt.trim(),
          duration,
          style,
          mood,
          aspectRatio,
          colorPalette,
          pacing,
          videoModelId,
          imageModelId,
          useReferenceFrame,
        }}
        onGenerateScript={handleGenerateScript}
        onConfirmScript={handleConfirmScript}
        onCancel={handleCloseConfirmationModal}
        onBack={handleBackToConfirm}
        modalStep={modalStep}
        isGeneratingScript={isGeneratingScript}
        isProcessing={isProcessing}
        progress={progress}
        currentStage={currentStage}
        generatedScript={generatedScript}
        editedScript={editedScript}
        onScriptChange={setEditedScript}
        onPromptChange={(newPrompt) => {
          setPrompt(newPrompt);
        }}
        expectedSceneCount={getExpectedSceneCount(duration, prompt.trim().length)}
        generationResult={generationResult}
        error={generationError}
      />

      {/* Video Generation Progress Modal */}
      {showProgressModal && currentProjectId && (
        <SynchronousVideoProgressModal
          isOpen={showProgressModal}
          projectId={currentProjectId}
          generationResult={generationResult}
          onClose={handleCloseProgressModal}
          onError={handleGenerationError}
        />
      )}

      {/* Anchor Image Preview Modal */}
      {showAnchorImageModal && generatedAnchorImages.length > 0 && (
        <PreviewModal
          items={generatedAnchorImages.map(img => ({
            id: img.id,
            type: 'image' as const,
            url: img.url,
            title: `Asset ${img.assetNumber}`,
            description: img.prompt,
          }))}
          initialIndex={selectedAnchorImageIndex}
          isOpen={showAnchorImageModal}
          onClose={() => setShowAnchorImageModal(false)}
        />
      )}

      {/* Scene Slideshow Modal */}
      {sceneModalContent}
    </div>
  );
}

export default function SimpleCreatePage() {
  return (
    <ProtectedRoute>
      <SimpleCreateContent />
    </ProtectedRoute>
  );
}