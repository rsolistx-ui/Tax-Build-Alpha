import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Truepost Practice OS',
        short_name: 'Truepost',
        description: 'Bookkeeping, tax workpapers, client requests and signatures for tax and accounting practices',
        theme_color: '#0b3b91',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          {
            src: '/icons/icon-72x72.png',
            sizes: '72x72',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-96x96.png',
            sizes: '96x96',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-128x128.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-144x144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-152x152.png',
            sizes: '152x152',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-384x384.png',
            sizes: '384x384',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
        ],
        categories: ['business', 'finance', 'productivity'],
        shortcuts: [
          {
            name: 'Clients',
            short_name: 'Clients',
            description: 'Open a client to upload a receipt or review work',
            url: '/clients',
            icons: [{ src: '/icons/scan-shortcut.png', sizes: '192x192' }]
          },
          {
            name: 'Work Queue',
            short_name: 'Queue',
            description: 'See work awaiting review across all clients',
            url: '/work-queue',
            icons: [{ src: '/icons/invoice-shortcut.png', sizes: '192x192' }]
          },
        ],
      },
      workbox: {
        // generateSW writes its own sw.js and never runs public/sw.js, so push
        // notification handling is injected here instead of living there.
        importScripts: ['/push-handlers.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The initial experience is the dashboard and intake shell. The
        // receipt workspace and HEIC converter are lazy routes, so avoid
        // forcing a phone to download them before they are needed.
        globIgnores: ['assets/client-workspace-*.js', 'assets/heic2any-*.js'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cloudflare-assets',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8791',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Do not ship readable source maps with the public financial workspace.
    // Production diagnostics are handled server-side; removing these maps
    // reduces the install payload and avoids exposing application source.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['lucide-react', 'framer-motion'],
          charts: ['recharts'],
        },
      },
    },
  },
});
