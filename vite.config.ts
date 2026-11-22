import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { resolve } from "node:path";
import { inlineScript } from "./scriptureman/inline.mjs";

// Every page is its own HTML entry, so each game keeps its own folder.
const pages = ["index.html", "join/index.html", "one-in-a-millennium/index.html", "scriptureman/index.html", "zap/index.html"];

const scriptureMan: Plugin = {
  name: "inline-scriptureman-script",
  transformIndexHtml: {
    order: "pre",
    handler: (html, ctx) => ctx.path === "/scriptureman/index.html" ? inlineScript(html) : html
  }
};

export default defineConfig({
  plugins: [scriptureMan, cloudflare()],
  environments: { client: { build: { rollupOptions: { input: Object.fromEntries(pages.map(p => [p.replace(/\/?index\.html$/, "") || "main", resolve(import.meta.dirname, p)])) } } } }
});
