import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";

export default function HomePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (user) {
        navigate("/dashboard");
      } else {
        navigate("/login");
      }
    }
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 flex items-center justify-center">
      <div className="text-muted">Loading...</div>
    </div>
  );
}

