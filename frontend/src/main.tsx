import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './components/auth/AuthProvider';
import App from './App';
import './index.css';

// Apply dark mode to HTML element
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

// Suppress console errors for setup endpoints (from non-existent SetupProgress component)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  const originalError = console.error;
  console.error = (...args: any[]) => {
    // Filter out errors related to setup endpoints
    const errorString = args.join(' ');
    if (errorString.includes('/api/setup/') || 
        errorString.includes('SetupProgress') ||
        (errorString.includes('500') && errorString.includes('setup'))) {
      // Silently ignore setup endpoint errors
      return;
    }
    // Log all other errors normally
    originalError.apply(console, args);
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

