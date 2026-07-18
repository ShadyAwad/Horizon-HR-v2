import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (mode === 'production' && env.VITE_ENABLE_DEMO_LOGIN === 'true') {
    throw new Error('VITE_ENABLE_DEMO_LOGIN must be false in production builds.');
  }
  const plugins = [react(), tailwindcss()];

  if (mode === 'analyze') {
    plugins.push(
      visualizer({
        filename: 'dist/bundle-stats.html',
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }) as never
    );
  }

  return {
    plugins,

    // Must be a top-level Vite option.
    assetsInclude: ['**/*.glb'],

    build: {
      minify: 'esbuild',
      cssMinify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            maplibre: ['maplibre-gl'],
          },
        },
      },
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },

    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: [
        'courtesy-reached-reached-powell.trycloudflare.com',
      ],

      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',

      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
