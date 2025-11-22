import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Film, Zap, CheckCircle2, DollarSign, Star, Calendar, Clock, Edit3, Trash2, ChevronDown, Sparkles, Video } from "lucide-react";
import { Header } from "../components/Header";

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
  config?: {
    videoUrl?: string;
    finalVideoUrl?: string;
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
  const { getAccessToken } = useAuth();

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 30000);
    return () => clearInterval(interval);
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
  const projectsWithNames = useMemo(() => {
    return projects.map((project, index) => {
      if (!project.name || project.name.trim() === '') {
        // Generate default name: "Project 1", "Project 2", etc.
        // Sort by creation date to ensure consistent numbering
        const sortedProjects = [...projects].sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const projectIndex = sortedProjects.findIndex(p => p.id === project.id);
        return {
          ...project,
          displayName: `Project ${projectIndex + 1}`,
        };
      }
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
          <Button asChild className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white border-0 shadow-lg shadow-blue-500/30">
            <Link to="/create">
              <Plus className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Quick Create</span>
              <span className="sm:hidden">Create</span>
            </Link>
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
                {/* New Project Card */}
                <Card className="border-dashed border-white/20 bg-black/20 backdrop-blur-xl hover:border-blue-500/50 hover:bg-black/30 transition-all cursor-pointer group animate-fade-in overflow-hidden p-0" style={{ animationDelay: '0.4s' }}>
                  <Link to="/create" className="block">
                    <div className="relative aspect-video bg-black/50 overflow-hidden flex flex-col items-center justify-center p-8">
                      <div className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-200 text-white/70">+</div>
                      <h3 className="text-lg font-semibold text-white mb-1">Quick Create</h3>
                      <p className="text-sm text-white/50 text-center">Start creating a new video</p>
                    </div>
                  </Link>
                </Card>

                {/* Existing Projects */}
                {filteredProjects.map((project, index) => {
                  // Prefer finalVideoUrl (merged with audio) over videoUrl (stitched without audio)
                  const videoUrl = project.config?.finalVideoUrl || project.config?.videoUrl;
                  const projectName = project.name || project.displayName || 'Untitled Project';
                  
                  return (
                    <Card 
                      key={project.id} 
                      className="border-white/10 bg-black/20 backdrop-blur-xl hover:border-white/20 hover:bg-black/30 transition-all hover:scale-[1.02] hover:shadow-2xl hover:shadow-blue-500/10 group animate-fade-in overflow-hidden p-0"
                      style={{ animationDelay: `${0.45 + index * 0.05}s` }}
                    >
                      <div className="relative aspect-video bg-black/50 overflow-hidden cursor-pointer" onClick={() => navigate(`/project/${project.id}`)}>
                          {/* Video Thumbnail */}
                          {videoUrl && (
                            <video
                              src={videoUrl}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              onMouseEnter={(e) => {
                                // Play video on hover
                                const video = e.currentTarget;
                                video.currentTime = 0;
                                video.play().catch(() => {
                                  // Ignore autoplay errors
                                });
                              }}
                              onMouseLeave={(e) => {
                                // Pause video when not hovering
                                e.currentTarget.pause();
                              }}
                            />
                          )}
                          
                          {/* Gradient Overlay for better text readability */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                          
                          {/* Project Name Overlay */}
                          <div className="absolute bottom-0 left-0 right-0 p-4 pb-12">
                            <h3 className="text-lg font-bold text-white line-clamp-2 drop-shadow-lg group-hover:text-blue-300 transition-colors">
                              {projectName}
                            </h3>
                          </div>
                          
                          {/* Date Overlay - Bottom Right */}
                          <div className="absolute bottom-2 right-2 z-10">
                            <div className="px-2 py-1 bg-black/60 backdrop-blur-sm rounded text-xs text-white/90 drop-shadow-lg">
                              {new Date(project.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          
                          {/* Status Badge - Top Right */}
                          <div className="absolute top-2 right-2 z-10">
                            {getStatusBadge(project.status)}
                          </div>
                          
                          {/* Category and Agentic Badge - Top Left */}
                          <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
                            <div className="text-xl drop-shadow-lg">{getCategoryIcon(project.category)}</div>
                            {project.agentic_mode && (
                              <div className="px-2 py-0.5 bg-blue-500/80 backdrop-blur-sm rounded text-[10px] text-white flex items-center gap-1">
                                <Star className="h-2.5 w-2.5 fill-white" />
                                Agentic
                              </div>
                            )}
                          </div>
                          
                          {/* Action Buttons - Top Right (on hover, below status badge) */}
                          <div className="absolute top-10 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 z-20">
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
                                    className="fixed inset-0 z-20" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenDropdownId(null);
                                    }}
                                  />
                                  <div className="absolute top-full right-0 mt-1 w-48 bg-black/95 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl overflow-hidden z-30">
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
