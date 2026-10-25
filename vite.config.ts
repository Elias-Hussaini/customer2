import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative asset paths work with GitHub Pages project repositories.
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: {
        name: "Customer Visa Management",
        short_name: "Customer",
        description: "مدیریت مشتریان و درخواست‌های ویزا",
        lang: "fa",
        dir: "rtl",
        theme_color: "#635bff",
        background_color: "#f7f8fc",
        display: "standalone",
        start_url: "./",
        icons: []
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]
      }
    })
  ]
});
