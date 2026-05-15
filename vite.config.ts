import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA as PWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss() as any,
    PWA({
      registerType: 'autoUpdate',
      manifest: {
        name: "DYCI Connect",
        short_name: "DYCI Connect",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1d4ed8",
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    })
  ],
  server: {
    port: 3000,
    host: true,
    // Allow access via Cloudflare/ngrok tunnels and other hosts in dev
    allowedHosts: true,
  },
  esbuild: {
    // Automatically strip console.log and debugger statements in production build (Vercel)
    drop: ['console', 'debugger'],
  },
})
