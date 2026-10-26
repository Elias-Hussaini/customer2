import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/// <reference types="vitest/config" />

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/** GitHub Pages repository name — the app is served under /customer2/. */
const REPO_NAME = "customer2";

/**
 * GitHub Pages is a static host with no SPA fallback.
 * Copying index.html to 404.html makes client-side routes resolve
 * after a hard refresh / direct navigation (classic Pages trick).
 */
function githubPagesPlugin(): Plugin {
  return {
    name: "github-pages-404",
    closeBundle() {
      const dist = resolve(rootDir, "dist");
      const index = resolve(dist, "index.html");
      if (existsSync(index)) {
        copyFileSync(index, resolve(dist, "404.html"));
        console.log("github-pages-404: dist/404.html written");
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? `/${REPO_NAME}/` : "/",
  plugins: [
    react(),
    tailwindcss(),
    githubPagesPlugin(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "favicon-64.png", "apple-touch-icon.png"],
      manifest: {
        name: "E-managment — مدیریت ویزا",
        short_name: "E-managment",
        description: "سامانه محلی مدیریت مشتریان، نمایندگان و درخواست‌های ویزا",
        lang: "fa",
        dir: "rtl",
        theme_color: "#635bff",
        background_color: "#f7f8fc",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
