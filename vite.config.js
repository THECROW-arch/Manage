import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      checks: {
        eval: false,
        pluginTimings: false
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](?:react|react-dom|scheduler|i18next|react-i18next)[\\/]/,
              priority: 40
            },
            {
              name: 'vendor-supabase',
              test: /node_modules[\\/]@supabase[\\/]/,
              priority: 30
            },
            {
              name: 'vendor-charts',
              test: /node_modules[\\/](?:recharts|d3-[^\\/]+|victory-vendor)[\\/]/,
              priority: 20
            },
            {
              name: 'i18n-dictionary',
              test: /src[\\/]i18n\.js$/,
              priority: 10
            }
          ]
        }
      }
    }
  }
});