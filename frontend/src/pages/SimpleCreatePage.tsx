import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { Header } from "../components/Header";
import { VideoGenerationProgressModal } from "../components/VideoGenerationProgressModal";
import { SynchronousVideoProgressModal } from "../components/SynchronousVideoProgressModal";
import { ProjectConfirmationModal } from "../components/ProjectConfirmationModal";
import { Sparkles, ArrowRight, Settings, ArrowLeft, Pencil, Check, X, RotateCcw, Bot } from "lucide-react";
import { AIChatPanel } from "../components/AIChatPanel";

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
  const [style, setStyle] = useState("cinematic");
  const [mood, setMood] = useState("energetic");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState(15);
  const [colorPalette, setColorPalette] = useState("vibrant");
  const [pacing, setPacing] = useState("medium");
  const [videoModelId, setVideoModelId] = useState('google/veo-3.1');
  const [imageModelId, setImageModelId] = useState('openai/dall-e-3');
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
  const { getAccessToken } = useAuth();
  const navigate = useNavigate();

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
    { value: 5, label: "5 seconds", description: "Minimum" },
    { value: 15, label: "15 seconds", description: "Quick" },
    { value: 30, label: "30 seconds", description: "Short" },
    { value: 60, label: "60 seconds", description: "Standard" },
    { value: 90, label: "90 seconds", description: "Extended" },
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
  useEffect(() => {
    if (!projectName) {
      getAutoProjectName().then(name => {
        setProjectName(name);
      });
    }
  }, []);

  // Handle project name editing
  const startEditingProjectName = () => {
    setTempProjectName(projectName);
    setIsEditingProjectName(true);
  };

  const saveProjectName = async () => {
    const trimmed = tempProjectName.trim();
    if (trimmed) {
      setProjectName(trimmed);
    } else {
      const autoName = await getAutoProjectName();
      setProjectName(autoName);
    }
    setIsEditingProjectName(false);
  };

  const cancelEditingProjectName = () => {
    setTempProjectName("");
    setIsEditingProjectName(false);
  };

  // Reset form to defaults
  const resetForm = () => {
    if (confirm('Are you sure you want to reset all fields? This will clear your current input.')) {
      setProjectName("");
      setPrompt(categoryPrompts.ad_creative);
      setStyle("cinematic");
      setMood("energetic");
      setAspectRatio("16:9");
      setDuration(15);
      setColorPalette("vibrant");
      setPacing("medium");
      setCostPerSecond(0.20);
      setCategory("ad_creative");
      // Re-populate project name
      getAutoProjectName().then(name => {
        setProjectName(name);
      });
    }
  };

  // Save draft to S3
  const saveDraft = async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Please log in to save drafts.');
        return;
      }

      const draft = {
        projectName,
        category,
        prompt,
        style,
        mood,
        aspectRatio,
        duration,
        colorPalette,
        pacing,
        videoModelId,
        imageModelId,
        savedAt: new Date().toISOString(),
      };

      // Create or get draft project
      let draftProjectId = currentProjectId;
      if (!draftProjectId) {
        // Create a draft project
        const project = await apiRequest<{ id: string }>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({
            name: projectName || 'Draft',
            category,
            prompt: prompt.trim() || 'Draft project',
            duration: duration || 15,
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
        draftProjectId = project.id;
        setCurrentProjectId(project.id);
      }

      // Save draft to S3
      await apiRequest(`/api/projects/${draftProjectId}/draft`, {
        method: 'POST',
        body: JSON.stringify(draft),
      }, token);

      alert('Draft saved successfully to S3!');
    } catch (error: any) {
      console.error('Error saving draft:', error);
      alert(`Failed to save draft: ${error.message || 'Unknown error'}`);
    }
  };

  // Load draft from S3
  const loadDraft = async () => {
    try {
      const token = await getAccessToken();
      if (!token) {
        alert('Please log in to load drafts.');
        return;
      }

      const projects = await apiRequest<Array<{
        id: string;
        name?: string;
        category: string;
        prompt: string;
        status: string;
        created_at?: string;
        config?: any;
      }>>('/api/projects', { method: 'GET' }, token);
      
      // Find projects that might have drafts (draft status or recent projects)
      const draftProjects = projects.filter(p => p.status === 'draft' || p.status === 'pending');
      if (draftProjects.length === 0) {
        alert('No draft projects found. Create a project first and save it as a draft.');
        return;
      }
      
      // Get the most recent draft project
      const latestDraftProject = draftProjects.sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      })[0];
      
      // Try to load draft from S3
      try {
        const draftData = await apiRequest<any>(`/api/projects/${latestDraftProject.id}/draft`, {
          method: 'GET',
        }, token);
        
        // Load the draft data
        if (draftData.projectName) setProjectName(draftData.projectName);
        if (draftData.category) setCategory(draftData.category as typeof category);
        if (draftData.prompt) setPrompt(draftData.prompt);
        if (draftData.style) setStyle(draftData.style);
        if (draftData.mood) setMood(draftData.mood);
        if (draftData.aspectRatio) setAspectRatio(draftData.aspectRatio);
        if (draftData.duration) setDuration(draftData.duration);
        if (draftData.colorPalette) setColorPalette(draftData.colorPalette);
        if (draftData.pacing) setPacing(draftData.pacing);
        if (draftData.videoModelId) setVideoModelId(draftData.videoModelId);
        if (draftData.imageModelId) setImageModelId(draftData.imageModelId);
        
        setCurrentProjectId(latestDraftProject.id);
        alert('Draft loaded successfully from S3!');
      } catch (draftError: any) {
        // If draft not found in S3, try to load from project data
        console.warn('Draft not found in S3, loading from project data:', draftError);
        
        // Load from project data as fallback
        if (latestDraftProject.name) setProjectName(latestDraftProject.name);
        if (latestDraftProject.category) setCategory(latestDraftProject.category as typeof category);
        if (latestDraftProject.prompt) setPrompt(latestDraftProject.prompt);
        
        // Load config if available
        if (latestDraftProject.config) {
          const config = typeof latestDraftProject.config === 'string' 
          ? JSON.parse(latestDraftProject.config) 
          : latestDraftProject.config;
        
        if (config.style) setStyle(config.style);
        if (config.mood) setMood(config.mood);
        if (config.aspectRatio) setAspectRatio(config.aspectRatio);
        if (config.duration) setDuration(config.duration);
        if (config.colorPalette) setColorPalette(config.colorPalette);
        if (config.pacing) setPacing(config.pacing);
        if (config.videoModelId) setVideoModelId(config.videoModelId);
        if (config.imageModelId) setImageModelId(config.imageModelId);
        }
        
        setCurrentProjectId(latestDraftProject.id);
        alert(`Draft "${latestDraftProject.name || 'Untitled'}" loaded successfully from project data!`);
      }
    } catch (error: any) {
      console.error('Error loading draft:', error);
      alert(error.message || 'Failed to load draft from database.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    // Use user-entered name or generate one
    let previewName = projectName.trim();
    if (!previewName) {
      try {
        const token = await getAccessToken();
        previewName = await generateProjectName(prompt.trim(), category, token);
        setProjectNamePreview(previewName);
      } catch (error) {
        // If name generation fails, use fallback
        previewName = prompt.trim().substring(0, 50) || 'Untitled Project';
        setProjectNamePreview(previewName);
      }
    } else {
      setProjectNamePreview(previewName);
    }
    
    // Show confirmation modal instead of creating immediately
    setShowConfirmationModal(true);
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
      
      // Use user-entered name or generate one
      let finalProjectName = projectName.trim();
      if (!finalProjectName) {
        finalProjectName = await generateProjectName(prompt.trim(), category, token);
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
      
      // If no project exists yet, create one first
      let projectIdToUse = currentProjectId;
      if (!projectIdToUse) {
        let finalProjectName = projectName.trim();
        if (!finalProjectName) {
          finalProjectName = await generateProjectName(prompt.trim(), category, token);
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
      
      // Update project with the final prompt and current model selection
      if (projectIdToUse) {
        const updateData: any = {};
        if (finalPrompt) {
          updateData.prompt = finalPrompt;
        }
        // Always update videoModelId to use current selection (user may have changed it)
        if (videoModelId) {
          updateData.videoModelId = videoModelId;
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
            body: JSON.stringify({}),
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
    console.error('Generation error:', error);
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
        <div className="w-96 border-r border-white/10 bg-black/20 backdrop-blur-xl p-8 overflow-y-auto animate-slide-in-left flex flex-col">
          {/* Back to Dashboard Button */}
          <div className="mb-6 animate-fade-in">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 text-white/70 hover:text-white transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span className="text-sm font-medium">Back to Dashboard</span>
            </button>
          </div>

          <div className="space-y-5 flex-1">
            {/* Category Selection */}
            <div className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <label className="block text-sm font-medium text-white/70 mb-3 uppercase tracking-wider">
                Category <span className="text-red-400">*</span>
              </label>
              <div className="flex gap-3">
                {[
                  { value: "music_video", label: "Music", icon: "🎵" },
                  { value: "ad_creative", label: "Ad", icon: "📢" },
                  { value: "explainer", label: "Explain", icon: "📚" },
                ].map((cat, idx) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => handleCategoryChange(cat.value as typeof category)}
                    className={`flex-1 aspect-square flex flex-col items-center justify-center rounded-lg border transition-all duration-300 transform hover:scale-[1.05] ${
                      category === cat.value
                        ? "border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/20"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                    }`}
                    style={{ maxWidth: '80px', maxHeight: '80px', animationDelay: `${0.15 + idx * 0.05}s` }}
                  >
                    <span className="text-2xl mb-1">{cat.icon}</span>
                    <span className="text-xs font-medium text-white">{cat.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Style + Mood - Row 1 */}
            <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.3s' }}>
              {/* Visual Style */}
              <div className="flex-1">
                <label htmlFor="style" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Visual Style
                </label>
                <select
                  id="style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {styleOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mood */}
              <div className="flex-1">
                <label htmlFor="mood" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Mood
                </label>
                <select
                  id="mood"
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {moodOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Aspect Ratio + Duration - Row 2 */}
            <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.4s' }}>
              {/* Aspect Ratio */}
              <div className="flex-1">
                <label htmlFor="aspectRatio" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Aspect Ratio
                </label>
                <select
                  id="aspectRatio"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {aspectRatioOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Duration */}
              <div className="flex-1">
                <label htmlFor="duration" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Duration
                </label>
                <select
                  id="duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {durationOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color Palette + Pacing - Row 3 */}
            <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.5s' }}>
              {/* Color Palette */}
              <div className="flex-1">
                <label htmlFor="colorPalette" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Color Palette
                </label>
                <select
                  id="colorPalette"
                  value={colorPalette}
                  onChange={(e) => setColorPalette(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {colorPaletteOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Pacing */}
              <div className="flex-1">
                <label htmlFor="pacing" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Pacing
                </label>
                <select
                  id="pacing"
                  value={pacing}
                  onChange={(e) => setPacing(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {pacingOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Video and Image Models - Side by Side */}
            <div className="animate-fade-in flex gap-3" style={{ animationDelay: '0.6s' }}>
              {/* Video Models */}
              <div className="flex-1">
                <label htmlFor="videoModelId" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Video Models
                </label>
                <select
                  id="videoModelId"
                  value={videoModelId}
                  onChange={(e) => setVideoModelId(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {videoModelOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Image Models */}
              <div className="flex-1">
                <label htmlFor="imageModelId" className="block text-sm font-medium text-white/70 mb-2 uppercase tracking-wider">
                  Image Models
                </label>
                <select
                  id="imageModelId"
                  value={imageModelId}
                  onChange={(e) => setImageModelId(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 backdrop-blur-sm px-2.5 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/20 transition-all appearance-none cursor-pointer hover:bg-white/10"
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.5rem center',
                    backgroundSize: '10px 6px',
                    paddingRight: '1.5rem',
                  }}
                >
                  {imageModelOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Settings Label at Bottom */}
          <div className="mt-auto pt-6 border-t border-white/10">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white/70">Settings</h2>
            </div>
          </div>
        </div>

        {/* Center Panel - Main Content */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in relative" style={{ marginLeft: '8rem', marginRight: '8rem' }}>
          <div className="w-full max-w-3xl space-y-6">
            {/* Project Name - Top Left */}
            <div className="flex items-center gap-3 animate-slide-in-up -mt-4">
              {isEditingProjectName ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={tempProjectName}
                    onChange={(e) => setTempProjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        saveProjectName();
                      } else if (e.key === 'Escape') {
                        cancelEditingProjectName();
                      }
                    }}
                    autoFocus
                    className="flex-1 px-4 py-2 rounded-lg border border-blue-500/50 bg-black/30 backdrop-blur-sm text-white text-lg font-semibold focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    onClick={saveProjectName}
                    className="p-2 text-green-400 hover:text-green-300 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button
                    onClick={cancelEditingProjectName}
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
                    onClick={startEditingProjectName}
                    className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title="Edit project name"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Header */}
            <div className="space-y-2 animate-slide-in-up -mt-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center animate-pulse-slow">
                  <Bot className="w-5 h-5 text-blue-400" />
                </div>
                <h1 className="text-2xl font-bold text-white">
                  Create Your Video
                </h1>
              </div>
              <p className="text-white/70 text-sm ml-[3.25rem]">
                Describe your video idea and we'll help you bring it to life with AI-powered creativity
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Prompt Input - Center Stage */}
              <div className="animate-slide-in-up" style={{ animationDelay: '0.2s' }}>
                <div className="relative group">
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      // Auto-resize textarea
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                    }}
                    placeholder="Describe your video idea in detail... What story do you want to tell? What visuals should appear? What mood should it convey?"
                    rows={12}
                    className="w-full rounded-2xl border-2 border-white/10 bg-black/30 backdrop-blur-xl px-6 py-5 text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition-all resize-none text-base leading-relaxed shadow-2xl overflow-y-auto min-h-[200px] max-h-[400px]"
                    required
                    style={{ minHeight: '200px', maxHeight: '400px' }}
                  />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                </div>
                <p className="mt-3 text-xs text-white/50 text-center">
                  Be as detailed as possible. The more information you provide, the better the result.
                </p>
              </div>

              {/* Submit Button */}
              <div className="animate-slide-in-up" style={{ animationDelay: '0.3s' }}>
                <button
                  type="submit"
                  disabled={!prompt.trim() || isCreating}
                  className="w-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 text-white py-4 rounded-xl font-semibold text-lg hover:shadow-2xl hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 relative overflow-hidden group"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {isCreating ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        Create Video
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>
            </form>

            {/* Quick Examples */}
            <div className="animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <p className="text-xs text-white/50 mb-3 text-center">Need inspiration? Try these:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  {
                    title: "Product Showcase",
                    prompt: "Sleek smartphone showcase with smooth transitions",
                    detailed: "Create a sleek and modern product showcase video for a new smartphone. Feature close-up shots highlighting the device's premium design, display quality, and key features. Include smooth transitions between different angles, showcase the phone's camera capabilities with sample photos, demonstrate the user interface with fluid animations, and end with a dynamic reveal of the product in various lifestyle settings. Use professional lighting, clean backgrounds, and emphasize the device's sleek form factor and innovative technology."
                  },
                  {
                    title: "Music Video",
                    prompt: "Energetic music video with vibrant colors",
                    detailed: "Produce an energetic and vibrant music video with dynamic camera movements and bold visual style. Include fast-paced cuts, colorful lighting effects, and rhythmic transitions that sync with the beat. Feature diverse locations from urban streets to abstract digital environments. Incorporate creative camera techniques like slow-motion, time-lapse, and tracking shots. Use a vibrant color palette with neon accents, dynamic particle effects, and stylized visual treatments. Include performance shots, abstract visual sequences, and moments that capture the energy and emotion of the music."
                  },
                  {
                    title: "Explainer Video",
                    prompt: "Simple explainer breaking down how AI works",
                    detailed: "Create an engaging explainer video that breaks down how artificial intelligence works in simple, accessible terms. Use clear visual metaphors, animated diagrams, and step-by-step demonstrations. Start with a relatable analogy, then gradually introduce key concepts like machine learning, neural networks, and data processing. Include animated illustrations showing how AI systems learn from data, make predictions, and improve over time. Use a friendly, approachable tone with clean graphics, smooth animations, and real-world examples that viewers can relate to. End with practical applications of AI in everyday life."
                  },
                  {
                    title: "Luxury Brand Ad",
                    prompt: "Elegant luxury ad with premium visuals",
                    detailed: "Craft an elegant and sophisticated luxury brand advertisement that exudes premium quality and timeless sophistication. Feature high-end products in refined settings with meticulous attention to detail. Use slow, deliberate camera movements, soft natural lighting, and rich color palettes with gold and deep tones. Include close-up shots highlighting craftsmanship, premium materials, and exquisite details. Showcase the brand's heritage and values through carefully curated scenes of luxury lifestyle, refined environments, and aspirational moments. Emphasize exclusivity, quality, and the prestige associated with the brand through cinematic visuals and elegant pacing."
                  },
                ].map((example, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPrompt(example.detailed)}
                    className="text-left p-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] transition-all backdrop-blur-sm"
                  >
                    <div className="font-medium mb-0.5 text-sm text-white/80">{example.title}</div>
                    <div className="text-xs text-white/50 leading-tight">{example.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Load Draft, Save Draft and Reset Buttons - Bottom Right, aligned with max-w-3xl panel */}
          <div className="absolute bottom-8 flex gap-3" style={{ right: 'calc(50% - 24rem + 2rem)' }}>
            <button
              type="button"
              onClick={loadDraft}
              className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors"
            >
              Load Draft
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors"
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-lg border border-white/10 bg-white/5 text-white hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>

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