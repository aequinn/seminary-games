import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";

// Every page is its own HTML entry, so each game keeps its own folder.
const pages = ["index.html", "join/index.html", "one-in-a-millennium/index.html"];

export default defineConfig({
  plugins: [cloudflare()],
  environments: { client: { build: { rollupOptions: { input: Object.fromEntries(pages.map(p => [p.replace(/\/?index\.html$/, "") || "main", resolve(import.meta.dirname, p)])) } } } }
});
