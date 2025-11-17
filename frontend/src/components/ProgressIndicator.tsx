import { useEffect, useState } from 'react';
import { useAuth } from './auth/AuthProvider';
import { apiRequest } from '../lib/api';

interface ProgressIndicatorProps {
  jobId: string;
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
}

export function ProgressIndicator({ jobId, onComplete, onError }: ProgressIndicatorProps) {
  const [status, setStatus] = useState<string>('queued');
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const { getAccessToken } = useAuth();

  useEffect(() => {
    if (!jobId) return;

    const pollInterval = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const data = await apiRequest<{
          status: string;
          progress: number;
          result?: any;
          error?: string;
        }>(`/api/jobs/${jobId}`, { method: 'GET' }, token);

        setStatus(data.status);
        setProgress(data.progress || 0);

        if (data.status === 'completed') {
          clearInterval(pollInterval);
          onComplete?.(data.result);
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          setError(data.error || 'Job failed');
          onError?.(data.error || 'Job failed');
        }
      } catch (err: any) {
        clearInterval(pollInterval);
        setError(err.message || 'Failed to fetch job status');
        onError?.(err.message || 'Failed to fetch job status');
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [jobId, onComplete, onError, getAccessToken]);

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'active':
      case 'processing':
        return 'text-blue-400';
      default:
        return 'text-yellow-400';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'queued':
        return 'Queued';
      case 'waiting':
        return 'Waiting';
      case 'active':
      case 'processing':
        return 'Processing';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${getStatusColor()}`}>
          {getStatusText()}
        </span>
        <span className="text-sm text-muted">{progress}%</span>
      </div>
      
      <div className="w-full bg-surface rounded-full h-2 overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${
            status === 'completed' ? 'bg-green-500' :
            status === 'failed' ? 'bg-red-500' :
            'bg-primary-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {status === 'active' || status === 'processing' ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Generating video...
        </div>
      ) : null}
    </div>
  );
}

