import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ProtectedRoute } from "../components/auth/ProtectedRoute";
import { useAuth } from "../components/auth/AuthProvider";
import { apiRequest } from "../lib/api";

function UserMenu() {
  const { user, signOut } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-white/10 hover:bg-surface-hover transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white font-semibold">
          {user?.username?.[0]?.toUpperCase() || 'U'}
        </div>
        <span className="text-white text-sm">{user?.username || 'User'}</span>
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-2 w-48 rounded-lg border border-white/10 bg-surface shadow-lg z-10">
          <button
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
            className="w-full text-left px-4 py-2 text-white hover:bg-surface-hover rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

interface Project {
  id: string;
  category: string;
  prompt: string;
  status: string;
  created_at: string;
}

function DashboardContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const { getAccessToken } = useAuth();

  useEffect(() => {
    fetchProjects();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-success/20 text-success border-success/30';
      case 'generating':
        return 'bg-primary-500/20 text-primary-400 border-primary-500/30';
      case 'failed':
        return 'bg-danger/20 text-danger border-danger/30';
      default:
        return 'bg-surface border-white/10 text-muted';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">My Projects</h1>
            <p className="text-muted">Create and manage your AI video generation projects</p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/project/new"
              className="bg-gradient-to-r from-primary-500 to-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:shadow-lg hover:shadow-primary-500/30 transition-all duration-200"
            >
              + New Project
            </Link>
            <UserMenu />
          </div>
        </div>

        {loading ? (
          <div className="text-center text-muted py-12">
            <div className="animate-pulse">Loading projects...</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* New Project Card */}
            <Link
              to="/project/new"
              className="group relative rounded-xl border-2 border-dashed border-white/20 bg-surface/40 backdrop-blur-xl p-8 hover:border-primary-500/50 hover:bg-surface/60 transition-all duration-300 flex flex-col items-center justify-center min-h-[200px]"
            >
              <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300">+</div>
              <h3 className="text-xl font-semibold text-white mb-2">New Project</h3>
              <p className="text-sm text-muted text-center">Start creating a new video</p>
            </Link>

            {/* Existing Projects */}
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                className="group relative rounded-xl border border-white/10 bg-surface/60 backdrop-blur-xl p-6 hover:border-primary-500/30 hover:shadow-lg hover:shadow-primary-500/10 transition-all duration-300"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl">{getCategoryIcon(project.category)}</div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium border ${getStatusColor(
                      project.status
                    )}`}
                  >
                    {project.status}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-white mb-2 line-clamp-2">
                  {project.prompt.substring(0, 60)}
                  {project.prompt.length > 60 ? '...' : ''}
                </h3>
                <p className="text-xs text-muted capitalize mb-4">{project.category.replace('_', ' ')}</p>
                <div className="text-xs text-muted">
                  {new Date(project.created_at).toLocaleDateString()}
                </div>
              </Link>
            ))}

            {projects.length === 0 && (
              <div className="col-span-full text-center text-muted py-12">
                <p>No projects yet. Create your first project to get started!</p>
              </div>
            )}
          </div>
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

