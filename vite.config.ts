import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

/// <reference types="vitest/config" />

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/** GitHub Pages repository name — the app is served under /customer2/. */
const REPO_NAME = "customer2";

/**
 * Build identity — injected at compile time so the UI can always answer
 * «which version am I running?». The user was repeatedly left guessing whether
 * a fix had reached their device; a visible build stamp removes all doubt.
 */
function buildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

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
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    tailwindcss(),
    githubPagesPlugin(),
    VitePWA({
      // "prompt" keeps the user in control: a new deploy shows the sticky
      // «نسخه جدید آماده است — به‌روزرسانی» toast and ONLY reloads when they
      // click it. (autoUpdate applied updates silently and the user lost the
      // visible signal they relied on — restored here on purpose.)
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
          // ?v= cache-buster: browsers snapshot the manifest icon URL at
          // install time. A NEW url forces Chrome to re-fetch and refresh the
          // install/home-screen icon instead of showing the stale one.
          { src: "icons/icon-192.png?v=20261030", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png?v=20261030", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-192.png?v=20261030",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/icon-maskable-512.png?v=20261030",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // traineddata = the local OCR models; mjs = the patched pdf worker
        // + module chunks (offline doc classification & PDF conversion)
        globPatterns: ["**/*.{js,mjs,css,html,ico,png,svg,woff2,webmanifest,traineddata}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
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
