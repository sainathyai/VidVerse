"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Project {
  id: string;
  category: string;
  prompt: string;
  duration: number;
  status: string;
  created_at: string;
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectId) {
      fetchProject();
    }
  }, [projectId]);

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        setProject(data);
      }
    } catch (error) {
      console.error('Error fetching project:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center text-muted py-12">
            <div className="animate-pulse">Loading project...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center text-muted py-12">
            <p>Project not found</p>
            <Link href="/dashboard" className="text-primary-500 hover:underline mt-4 inline-block">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-900 via-neutral-800 to-neutral-900 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/dashboard" className="text-muted hover:text-white mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-4xl font-bold text-white mb-2">Project Details</h1>
        </div>

        {/* Project Info Card */}
        <div className="rounded-xl border border-white/10 bg-surface/60 backdrop-blur-xl p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-semibold text-white mb-2">{project.prompt}</h2>
              <p className="text-muted capitalize">{project.category.replace('_', ' ')}</p>
            </div>
            <span className="px-3 py-1 rounded-lg bg-primary-500/20 text-primary-400 border border-primary-500/30 text-sm font-medium">
              {project.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6">
            <div>
              <p className="text-sm text-muted mb-1">Duration</p>
              <p className="text-white font-medium">{project.duration} seconds</p>
            </div>
            <div>
              <p className="text-sm text-muted mb-1">Created</p>
              <p className="text-white font-medium">
                {new Date(project.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Placeholder for future features */}
        <div className="rounded-xl border border-white/10 bg-surface/60 backdrop-blur-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Next Steps</h3>
          <p className="text-muted">
            Project creation is complete! In the next PRs, you'll be able to:
          </p>
          <ul className="list-disc list-inside text-muted mt-4 space-y-2">
            <li>Upload audio files and assets</li>
            <li>Generate video scenes</li>
            <li>Edit and refine your video</li>
            <li>Export your final video</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

