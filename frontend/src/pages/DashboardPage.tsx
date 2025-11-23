import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Film, Zap, CheckCircle2, DollarSign, Star, Calendar, Clock, Edit3, Trash2, ChevronDown, Sparkles, Video, Play } from "lucide-react";
import { Header } from "../components/Header";
import { QuickCreateModal } from "../components/QuickCreateModal";
import { VideoPlayerModal } from "../components/VideoPlayerModal";

// Component to display video thumbnail from database or fallback to generating from video
function VideoThumbnail({ 
  thumbnailUrl, 
  videoUrl, 
  projectId, 
  projectName 
}: { 
  thumbnailUrl?: string | null; 
  videoUrl?: string | null; 
  projectId: string; 
  projectName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Use Intersection Observer to only load thumbnail when visible
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '50px' } // Start loading 50px before it becomes visible
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [projectId, thumbnailUrl]);

  // Fallback: Generate thumbnail from video (original behavior)
  useEffect(() => {
    // Skip if we have a thumbnail URL from database
    if (thumbnailUrl && !imageError) {
      return;
    }
    
    // Skip if no video URL available
    if (!videoUrl) return;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    // Only load thumbnail if visible and not already loaded
    if (!canvas || !video || thumbnailLoaded || !isVisible) return;

    const captureThumbnail = () => {
      try {
        if (video.readyState >= 2) {
          // Video metadata is loaded, capture first frame
          video.currentTime = 0.1;
          
          const handleSeeked = () => {
            try {
              const ctx = canvas.getContext('2d');
              if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                setThumbnailLoaded(true);
                video.removeEventListener('seeked', handleSeeked);
                video.pause();
                video.currentTime = 0;
              }
            } catch (err) {
              setHasError(true);
            }
          };

          video.addEventListener('seeked', handleSeeked, { once: true });
        }
      } catch (err) {
        setHasError(true);
      }
    };

    const handleLoadedMetadata = () => {
      captureThumbnail();
    };

    const handleError = () => {
      setHasError(true);
    };

    // Set video properties first
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata'; // Load metadata to get first frame
    
    // Add event listeners before setting src
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);
    
    // Set src to trigger loading
    video.src = videoUrl;
    video.load(); // Explicitly trigger load

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      // Clear src on cleanup to prevent loading
      video.src = '';
    };
  }, [videoUrl, thumbnailLoaded, isVisible, thumbnailUrl, imageError]);

  // Render based on state - always render the same structure to avoid hooks issues
  return (
    <div ref={containerRef} className="w-full h-full relative bg-black">
      {/* Always render video element (hidden) so refs are available */}
      <video
        ref={videoRef}
        className="hidden"
        crossOrigin="anonymous"
        muted
        playsInline
        preload="none"
      />
      
      {/* If we have a thumbnail URL from database, use it */}
      {thumbnailUrl && !imageError ? (
        <>
          <img
            src={thumbnailUrl}
            alt={`${projectName} thumbnail`}
            className="w-full h-full object-cover"
            style={{ display: 'block' }}
            onError={() => {
              setImageError(true);
              // Fall through to video-based thumbnail generation
            }}
            onLoad={() => {
              setThumbnailLoaded(true);
            }}
          />
          {!thumbnailLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900 z-10">
              <Video className="w-16 h-16 text-white/20 animate-pulse" />
            </div>
          )}
        </>
      ) : hasError ? (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
          <Video className="w-16 h-16 text-white/20" />
        </div>
      ) : (
        <>
          {/* Canvas thumbnail */}
          {thumbnailLoaded ? (
            <canvas
              ref={canvasRef}
              className="w-full h-full object-cover"
              style={{ display: 'block' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
              <Video className="w-16 h-16 text-white/20" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface Project {
  id: string;
  name?: string;
  category: string;
  prompt: string;
  status: string;
  created_at: string;
  cost?: number;
  duration?: number;
  agentic_mode?: boolean;
  final_video_url?: string; // Database column
  thumbnail_url?: string; // Database column
  config?: {
    videoUrl?: string;
    finalVideoUrl?: string;
    thumbnailUrl?: string;
    sceneUrls?: string[];
    [key: string]: any;
  };
  displayName?: string; // Computed display name (default numbered if no name)
}

interface DashboardStats {
  totalProjects: number;
  completedProjects: number;
  activeProjects: number;
  failedProjects: number;
  totalCost: number;
  successRate: number;
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon,
  iconColor = "text-blue-400",
  delay = 0
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string; 
  icon: React.ElementType;
  iconColor?: string;
  delay?: number;
}) {
  // Map icon colors to background colors
  const getBgColor = (color: string) => {
    if (color.includes('purple')) return 'bg-purple-500/20';
    if (color.includes('yellow')) return 'bg-yellow-500/20';
    if (color.includes('green')) return 'bg-green-500/20';
    if (color.includes('amber')) return 'bg-amber-500/20';
    return 'bg-blue-500/20';
  };

  return (
    <Card className="border-white/10 bg-black/20 backdrop-blur-xl hover:bg-black/30 hover:border-white/20 transition-all hover:scale-[1.02] animate-fade-in" style={{ animationDelay: `${delay}s` }}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-white/70">{title}</CardTitle>
        <div className={`p-2 rounded-lg ${getBgColor(iconColor)}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-white">{value}</div>
        {subtitle && (
          <p className="text-xs text-white/50 mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardContent() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("completed"); // Default: show completed projects
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [showQuickCreateModal, setShowQuickCreateModal] = useState(false);
  const [pendingImportData, setPendingImportData] = useState<any>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [videoPlayerModal, setVideoPlayerModal] = useState<{ isOpen: boolean; videoUrl: string; projectName: string }>({
    isOpen: false,
    videoUrl: '',
    projectName: '',
  });
  const { getAccessToken } = useAuth();

  useEffect(() => {
    fetchProjects();
    // Refresh every 10 minutes (600000ms) - only fetch when user is actively viewing
    // Remove auto-refresh to reduce unnecessary API calls
    // Users can manually refresh if needed
    // const interval = setInterval(fetchProjects, 600000);
    // return () => clearInterval(interval);
  }, []);

  const fetchProjects = async () => {
    try {
      const token = await getAccessToken();
      const data = await apiRequest<Project[]>('/api/projects', { method: 'GET' }, token);
      setProjects(data);
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const stats: DashboardStats = useMemo(() => {
    const total = projects.length;
    const completed = projects.filter(p => p.status === 'completed').length;
    const active = projects.filter(p => p.status === 'pending').length;
    const failed = projects.filter(p => p.status === 'failed').length;
    const totalCost = projects.reduce((sum, p) => sum + (p.cost || 0), 0);
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      totalProjects: total,
      completedProjects: completed,
      activeProjects: active,
      failedProjects: failed,
      totalCost,
      successRate,
    };
  }, [projects]);

  // Generate default project names for projects without names
  // Keep the backend order (newest first) but generate display names based on chronological order
  const projectsWithNames = useMemo(() => {
    // Sort by creation date ascending to get correct numbering (oldest = Project 1)
    const sortedByDate = [...projects].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    // Create a map of project ID to its chronological index
    const projectIndexMap = new Map<string, number>();
    sortedByDate.forEach((project, index) => {
      projectIndexMap.set(project.id, index + 1);
    });
    
    // Map projects back to original order (newest first from backend) with display names
    return projects.map((project) => {
      if (!project.name || project.name.trim() === '') {
        // Generate default name: "Project 1", "Project 2", etc. based on chronological order
        const projectIndex = projectIndexMap.get(project.id) || 1;
        return {
          ...project,
          displayName: `Project ${projectIndex}`,
        };
      }
      // Use the actual saved name from database
      return {
        ...project,
        displayName: project.name,
      };
    });
  }, [projects]);

  const filteredProjects = useMemo(() => {
    return projectsWithNames.filter(project => {
      const matchesSearch = (project.displayName || project.prompt || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                           project.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           project.id.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Status filtering logic
      let matchesStatus = false;
      if (statusFilter === 'all') {
        matchesStatus = true; // Show all projects
      } else if (statusFilter === 'active') {
        // Default: show completed and draft projects (exclude failed)
        matchesStatus = project.status === 'completed' || 
                       project.status === 'draft' || 
                       !project.status || 
                       project.status === '';
      } else if (statusFilter === 'failed') {
        matchesStatus = project.status === 'failed';
      } else {
        // For other statuses (pending, completed, etc.), match exactly
        matchesStatus = project.status === statusFilter;
      }
      
      const matchesCategory = categoryFilter === 'all' || project.category === categoryFilter;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [projectsWithNames, searchQuery, statusFilter, categoryFilter]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'music_video':
        return '🎵';
      case 'ad_creative':
        return '📢';
      case 'explainer':
        return '📚';
      default:
        return '🎬';
    }
  };

  const getCategoryName = (category: string) => {
    return category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success">{status}</Badge>;
      case 'pending':
        return <Badge variant="info">{status}</Badge>;
      case 'failed':
        return <Badge variant="destructive">{status}</Badge>;
      default:
        return <Badge variant="secondary">{status || 'draft'}</Badge>;
    }
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${projectName || 'this project'}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const token = await getAccessToken();
      await apiRequest<void>(`/api/projects/${projectId}`, { method: 'DELETE' }, token);
      // Refresh projects list
      fetchProjects();
    } catch (error: any) {
      console.error('Error deleting project:', error);
      alert(error.message || 'Failed to delete project. Please try again.');
    }
  };

  const formatCost = (cost: number | undefined) => {
    if (!cost) return '$0.00';
    return `$${cost.toFixed(2)}`;
  };

  const formatDuration = (duration: number | undefined) => {
    if (!duration) return 'N/A';
    if (duration < 60) return `${Math.round(duration)}s`;
    return `${Math.round(duration / 60)}m ${Math.round(duration % 60)}s`;
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
      
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Page Title */}
        <div className="mb-8 animate-fade-in">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-white/70 text-sm">Monitor and manage your AI video projects</p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <Button 
            onClick={() => setShowQuickCreateModal(true)}
            className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 shadow-lg shadow-blue-500/30"
          >
            <Plus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Quick Create</span>
            <span className="sm:hidden">Create</span>
          </Button>
          <Button asChild variant="outline" className="border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 text-white">
            <Link to="/project/new">
              <Plus className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Advanced Project</span>
              <span className="sm:hidden">Advanced</span>
            </Link>
          </Button>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Total Projects"
            value={stats.totalProjects}
            subtitle={`${stats.completedProjects} completed`}
            icon={Film}
            iconColor="text-purple-400"
            delay={0.1}
          />
          <StatCard
            title="Active Jobs"
            value={stats.activeProjects}
            subtitle={stats.activeProjects > 0 ? "In progress" : "All clear"}
            icon={Zap}
            iconColor="text-yellow-400"
            delay={0.15}
          />
          <StatCard
            title="Success Rate"
            value={`${stats.successRate}%`}
            subtitle={`${stats.completedProjects}/${stats.totalProjects} successful`}
            icon={CheckCircle2}
            iconColor="text-green-400"
            delay={0.2}
          />
          <StatCard
            title="Total Cost"
            value={formatCost(stats.totalCost)}
            subtitle="All time spending"
            icon={DollarSign}
            iconColor="text-amber-400"
            delay={0.25}
          />
        </div>

        {/* Filters and Search */}
        <div className="mb-8 flex flex-col sm:flex-row gap-3 animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/50" />
            <Input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 border-white/10 bg-black/20 backdrop-blur-sm text-white placeholder-white/40 focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border-white/10 bg-black/20 backdrop-blur-sm text-white focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="active" className="bg-neutral-900">Active (Completed & Draft)</option>
            <option value="all" className="bg-neutral-900">All Status</option>
            <option value="pending" className="bg-neutral-900">Pending</option>
            <option value="completed" className="bg-neutral-900">Completed</option>
            <option value="failed" className="bg-neutral-900">Failed</option>
            <option value="draft" className="bg-neutral-900">Draft</option>
          </Select>
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border-white/10 bg-black/20 backdrop-blur-sm text-white focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all" className="bg-neutral-900">All Categories</option>
            <option value="music_video" className="bg-neutral-900">Music Video</option>
            <option value="ad_creative" className="bg-neutral-900">Ad Creative</option>
            <option value="explainer" className="bg-neutral-900">Explainer</option>
          </Select>
        </div>

        {/* Projects Grid */}
        {loading ? (
          <div className="text-center py-16">
            <div className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
              <p className="text-white/70">Loading projects...</p>
            </div>
          </div>
        ) : (
          <>
            {filteredProjects.length === 0 ? (
              <Card className="text-center py-16 border-white/10 bg-black/20 backdrop-blur-xl">
                <CardContent>
                  <div className="text-6xl mb-4">🎬</div>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {projects.length === 0 ? 'No projects yet' : 'No projects match your filters'}
                  </h3>
                  <p className="text-white/60 mb-6 max-w-md mx-auto">
                    {projects.length === 0 
                      ? 'Create your first project to get started!' 
                      : 'Try adjusting your search or filters'}
                  </p>
                  {projects.length === 0 && (
                    <Button asChild className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0">
                      <Link to="/create">
                        <Plus className="h-4 w-4 mr-2" />
                        Create Your First Project
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* New Project Card - Quick Create */}
                <Card 
                  className="border border-white/20 bg-gradient-to-br from-blue-500/10 via-purple-500/8 to-pink-500/5 backdrop-blur-xl hover:border-blue-500/50 hover:from-blue-500/15 hover:via-purple-500/12 hover:to-pink-500/8 transition-all cursor-pointer group animate-fade-in overflow-hidden p-0 shadow-lg shadow-purple-500/10 hover:shadow-purple-500/20" 
                  style={{ animationDelay: '0.4s' }}
                  onClick={() => setShowQuickCreateModal(true)}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-neutral-900/50 via-neutral-800/40 to-neutral-900/50 overflow-hidden flex flex-col items-center justify-center p-8">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="relative z-10 flex flex-col items-center">
                      <div className="p-3 bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-sm rounded-lg mb-4 group-hover:scale-110 transition-transform duration-200 shadow-lg shadow-blue-500/20">
                        <Sparkles className="w-6 h-6 text-white/90" />
                      </div>
                      <h3 className="text-lg font-semibold text-white mb-1 drop-shadow-lg">Quick Create</h3>
                      <p className="text-sm text-white/60 text-center">Describe your video concept</p>
                    </div>
                  </div>
                </Card>

                {/* Existing Projects */}
                {filteredProjects.map((project, index) => {
                  // Parse config if it's a string
                  const config = typeof project.config === 'string' 
                    ? JSON.parse(project.config) 
                    : (project.config || {});
                  
                  // Check for final_video_url in multiple places
                  const finalVideoUrlFromColumn = (project as any).final_video_url;
                  const finalVideoUrlFromConfig = config.finalVideoUrl;
                  const videoUrlFromConfig = config.videoUrl;
                  const sceneUrls = config.sceneUrls;
                  
                  // Check for thumbnail_url in multiple places
                  const thumbnailUrlFromColumn = (project as any).thumbnail_url;
                  const thumbnailUrlFromConfig = config.thumbnailUrl;
                  
                  // Prefer final_video_url column, then finalVideoUrl in config, then videoUrl, then first scene video
                  let videoUrl: string | null = null;
                  
                  // Priority order: final_video_url column > config.finalVideoUrl > config.videoUrl > first scene video
                  if (finalVideoUrlFromColumn && typeof finalVideoUrlFromColumn === 'string' && finalVideoUrlFromColumn.trim() !== '') {
                    videoUrl = finalVideoUrlFromColumn.trim();
                  } else if (finalVideoUrlFromConfig && typeof finalVideoUrlFromConfig === 'string' && finalVideoUrlFromConfig.trim() !== '') {
                    videoUrl = finalVideoUrlFromConfig.trim();
                  } else if (videoUrlFromConfig && typeof videoUrlFromConfig === 'string' && videoUrlFromConfig.trim() !== '') {
                    videoUrl = videoUrlFromConfig.trim();
                  } else if (sceneUrls && Array.isArray(sceneUrls) && sceneUrls.length > 0) {
                    // Use first scene video as fallback
                    const firstSceneUrl = sceneUrls[0];
                    if (firstSceneUrl && typeof firstSceneUrl === 'string' && firstSceneUrl.trim() !== '') {
                      videoUrl = firstSceneUrl.trim();
                    }
                  }
                  
                  // Get thumbnail URL - prefer thumbnail_url column, then config.thumbnailUrl
                  let thumbnailUrl: string | null = null;
                  if (thumbnailUrlFromColumn && typeof thumbnailUrlFromColumn === 'string' && thumbnailUrlFromColumn.trim() !== '') {
                    thumbnailUrl = thumbnailUrlFromColumn.trim();
                  } else if (thumbnailUrlFromConfig && typeof thumbnailUrlFromConfig === 'string' && thumbnailUrlFromConfig.trim() !== '') {
                    thumbnailUrl = thumbnailUrlFromConfig.trim();
                  }
                  
                  // Ensure videoUrl is a complete, valid URL
                  if (videoUrl) {
                    if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
                      console.warn(`[DASHBOARD] Invalid video URL format for ${projectName}:`, {
                        videoUrl,
                        videoUrlLength: videoUrl.length,
                        startsWith: videoUrl.substring(0, 20)
                      });
                      videoUrl = null;
                    } else {
                      // Validate URL is complete (should end with extension or have query params)
                      const isComplete = videoUrl.endsWith('.mp4') || 
                                        videoUrl.endsWith('.mov') || 
                                        videoUrl.endsWith('.webm') ||
                                        videoUrl.includes('?') || // Presigned URLs have query params
                                        videoUrl.includes('X-Amz-Signature'); // AWS presigned URL signature
                      
                      if (!isComplete && videoUrl.length < 100) {
                        console.warn(`[DASHBOARD] Video URL appears incomplete for ${projectName}:`, {
                          videoUrl,
                          videoUrlLength: videoUrl.length,
                          videoUrlEnd: videoUrl.substring(Math.max(0, videoUrl.length - 30))
                        });
                      }
                    }
                  }
                  
                  const projectName = project.name || project.displayName || 'Untitled Project';
                  
                  return (
                    <Card 
                      key={project.id} 
                      className="border-white/10 bg-black/20 backdrop-blur-xl hover:border-white/20 hover:bg-black/30 transition-all hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10 group animate-fade-in overflow-hidden p-0"
                      style={{ animationDelay: `${0.45 + index * 0.05}s` }}
                    >
                      <div 
                        className="relative aspect-video bg-black/50 overflow-hidden cursor-pointer group/video"
                        onMouseEnter={() => setHoveredProjectId(project.id)}
                        onMouseLeave={() => setHoveredProjectId(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Open video player modal when clicking thumbnail
                          if (videoUrl) {
                            setVideoPlayerModal({
                              isOpen: true,
                              videoUrl: videoUrl,
                              projectName: projectName,
                            });
                          }
                        }}
                      >
                          {/* Video Thumbnail - From database or generated from video */}
                          {videoUrl || thumbnailUrl ? (
                            <VideoThumbnail 
                              thumbnailUrl={thumbnailUrl}
                              videoUrl={videoUrl || null} 
                              projectId={project.id}
                              projectName={projectName}
                            />
                          ) : (
                            // Placeholder when no video or thumbnail
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
                              <Video className="w-16 h-16 text-white/20" />
                            </div>
                          )}
                          
                          {/* Gradient Overlay for better text readability */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                          
                          {/* Center Play Button - Shows on hover, only the button is clickable */}
                          {videoUrl && hoveredProjectId === project.id && (
                            <div 
                              className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
                            >
                              <div 
                                className="w-20 h-20 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-2xl hover:bg-white hover:scale-110 transition-all duration-300 cursor-pointer group/play pointer-events-auto"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Ensure videoUrl is a complete, valid URL
                                  if (!videoUrl || typeof videoUrl !== 'string' || videoUrl.trim() === '') {
                                    console.error(`[DASHBOARD] Invalid video URL for project ${projectName}:`, videoUrl);
                                    return;
                                  }
                                  
                                  // Validate URL is complete (should end with file extension or have query params for presigned URLs)
                                  const trimmedUrl = videoUrl.trim();
                                  const isComplete = trimmedUrl.endsWith('.mp4') || 
                                                    trimmedUrl.endsWith('.mov') || 
                                                    trimmedUrl.endsWith('.webm') ||
                                                    trimmedUrl.includes('?') || // Presigned URLs have query params
                                                    trimmedUrl.includes('X-Amz-Signature'); // AWS presigned URL signature
                                  
                                  if (!isComplete && trimmedUrl.length < 150) {
                                    console.warn(`[DASHBOARD] Video URL appears incomplete for ${projectName}:`, {
                                      videoUrl: trimmedUrl,
                                      length: trimmedUrl.length,
                                      endsWith: trimmedUrl.substring(trimmedUrl.length - 20)
                                    });
                                  }
                                  
                                  // Open video player modal
                                  setVideoPlayerModal({
                                    isOpen: true,
                                    videoUrl: trimmedUrl, // Use full URL, not truncated
                                    projectName: projectName,
                                  });
                                }}
                              >
                                <Play className="w-10 h-10 text-black ml-1 group-hover/play:scale-110 transition-transform" fill="black" />
                              </div>
                            </div>
                          )}
                          
                          {/* Click overlay to navigate to project (only works when not hovering over buttons) */}
                          <div 
                            className="absolute inset-0 z-0 cursor-pointer"
                            onClick={(e) => {
                              // Only navigate if clicking on the tile itself, not on buttons
                              const target = e.target as HTMLElement;
                              if (!target.closest('button') && !target.closest('[class*="z-40"]') && !target.closest('[class*="z-50"]')) {
                                navigate(`/project/${project.id}`);
                              }
                            }}
                          />
                          
                          {/* Project Name Overlay */}
                          <div className="absolute bottom-0 left-0 right-0 p-4 pb-12 z-40">
                            <h3 className="text-lg font-bold text-white line-clamp-2 drop-shadow-lg group-hover:text-blue-300 transition-colors">
                              {projectName}
                            </h3>
                          </div>
                          
                          {/* Date Overlay - Bottom Right */}
                          <div className="absolute bottom-2 right-2 z-40">
                            <div className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white/90 drop-shadow-lg">
                              {new Date(project.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          
                          {/* Status Badge - Bottom Left */}
                          <div className="absolute bottom-2 left-2 z-40">
                            {getStatusBadge(project.status)}
                          </div>
                          
                          {/* Category and Agentic Badge - Top Left */}
                          <div className="absolute top-2 left-2 z-40 flex items-center gap-2">
                            <div className="text-xl drop-shadow-lg">{getCategoryIcon(project.category)}</div>
                            {project.agentic_mode && (
                              <div className="px-2 py-0.5 bg-blue-500/80 backdrop-blur-sm rounded text-[10px] text-white flex items-center gap-1">
                                <Star className="h-2.5 w-2.5 fill-white" />
                                Agentic
                              </div>
                            )}
                          </div>
                          
                          {/* Action Buttons - Top Right (on hover, below status badge) - Higher z-index to be above play button */}
                          <div className="absolute top-10 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 z-50">
                            {/* Edit Dropdown */}
                            <div className="relative">
                              <Button 
                                size="sm" 
                                className="bg-white/90 backdrop-blur-sm border-white/20 hover:bg-white text-black"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenDropdownId(openDropdownId === project.id ? null : project.id);
                                }}
                              >
                                <Edit3 className="h-3 w-3 mr-1" />
                                Edit
                                <ChevronDown className="h-3 w-3 ml-1" />
                              </Button>
                              
                              {/* Dropdown Menu */}
                              {openDropdownId === project.id && (
                                <>
                                  {/* Backdrop to close dropdown */}
                                  <div 
                                    className="fixed inset-0 z-40" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenDropdownId(null);
                                    }}
                                  />
                                  <div className="absolute top-full right-0 mt-1 w-48 bg-black/95 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl overflow-hidden z-50">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenDropdownId(null);
                                        // Navigate to quick create with project data
                                        navigate(`/create?projectId=${project.id}`);
                                      }}
                                      className="w-full px-4 py-3 text-left text-white hover:bg-white/10 transition-colors flex items-center gap-2"
                                    >
                                      <Sparkles className="h-4 w-4 text-blue-400" />
                                      <div>
                                        <div className="font-medium text-sm">Quick Create</div>
                                        <div className="text-xs text-white/60">Modify with saved assets</div>
                                      </div>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenDropdownId(null);
                                        navigate(`/project/${project.id}/edit`);
                                      }}
                                      className="w-full px-4 py-3 text-left text-white hover:bg-white/10 transition-colors flex items-center gap-2 border-t border-white/10"
                                    >
                                      <Video className="h-4 w-4 text-purple-400" />
                                      <div>
                                        <div className="font-medium text-sm">Advanced Edit</div>
                                        <div className="text-xs text-white/60">Full video editor</div>
                                      </div>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                            
                            <Button 
                              size="sm" 
                              className="bg-red-500/90 backdrop-blur-sm border-red-500/30 hover:bg-red-500 text-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenDropdownId(null);
                                handleDeleteProject(project.id, projectName);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Create Modal */}
      <QuickCreateModal
        isOpen={showQuickCreateModal}
        onClose={() => setShowQuickCreateModal(false)}
        onImportProject={(projectData) => {
          // Store project data in sessionStorage for SimpleCreatePage to pick up
          sessionStorage.setItem('quickCreateProjectData', JSON.stringify(projectData));
          setPendingImportData(projectData);
        }}
        onNavigateToCreate={() => {
          navigate('/create');
        }}
      />

      {/* Video Player Modal */}
      <VideoPlayerModal
        isOpen={videoPlayerModal.isOpen}
        onClose={() => setVideoPlayerModal({ isOpen: false, videoUrl: '', projectName: '' })}
        videoUrl={videoPlayerModal.videoUrl}
        projectName={videoPlayerModal.projectName}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
