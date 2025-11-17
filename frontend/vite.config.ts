import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "components": path.resolve(__dirname, "src/components"),
      "pages": path.resolve(__dirname, "src/pages"),
    },
  },
  server: {
    port: 3000,
    host: 'localhost', // Restrict to localhost only
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true, // Enable websocket proxying
        // Don't log connection errors for setup endpoints (backend may not be running)
        configure: (proxy, _options) => {
          proxy.on('error', (err, req, res) => {
            // Suppress connection refused errors for setup endpoints
            if (err.code === 'ECONNREFUSED' && req.url?.includes('/api/setup/')) {
              // Silently ignore - backend may not be running
              return;
            }
            // For other errors, log them
            if (err.code !== 'ECONNREFUSED') {
              console.error('Proxy error:', err.message);
            }
          });
        },
      },
    },
  },
});

