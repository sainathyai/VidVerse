import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  showLogout?: boolean;
  showProjectEditor?: boolean;
  onSaveProject?: () => void;
}

export function Header({ showLogout = true, showProjectEditor = false, onSaveProject }: HeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl sticky top-0 z-50">
      <div className="w-full px-4">
        <div className="flex items-center justify-between h-12">
          {/* Left side */}
          <div className="flex items-center gap-4">
            {showProjectEditor ? (
              <>
                <Link to="/dashboard" className="text-white/70 hover:text-white text-sm transition-colors">
                  ← Dashboard
                </Link>
                <h1 className="text-base font-semibold text-white">Project Editor</h1>
              </>
            ) : (
              <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <h1 className="text-2xl font-bold text-white">VidVerse</h1>
              </Link>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {showProjectEditor && onSaveProject && (
              <button 
                onClick={onSaveProject}
                className="px-3 py-1.5 text-sm bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-md hover:from-blue-600 hover:to-purple-600 transition-all shadow-lg shadow-blue-500/30"
              >
                Save Project
              </button>
            )}
            {showLogout && user && (
              <Button
                onClick={handleLogout}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 bg-white/5 border-white/10 text-white hover:bg-white/10"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

