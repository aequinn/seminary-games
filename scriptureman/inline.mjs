// Puts script.js inside the page. Used by build.mjs and by the site build (vite.config.ts).
// index.html needs a classic script tag to work when opened as a file, and Vite won't
// bundle classic scripts, so they are inlined instead.
import { readFileSync } from "node:fs";

const TAG = '<script src="script.js"></script>';

export function inlineScript(html) {
  if (!html.includes(TAG)) throw new Error(`scriptureman/index.html needs this exact tag: ${TAG}`);
  const js = readFileSync(new URL("./script.js", import.meta.url), "utf8").replace(/<\/script/gi, "<\\/script");
  // A function, not a string, so "$" in the code is copied literally.
  return html.replace(TAG, () => `<script>\n${js}</script>`);
}
