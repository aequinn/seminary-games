// Inlines style.css and script.js into index.html, writing one self-contained
// page to build/scriptureman.html. Run with: npm run build:scriptureman
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(dir, name), "utf8");

const css = read("style.css");
const js = read("script.js");
let html = read("index.html");

// Replacement functions (not strings) so "$" in the code is copied literally.
const replaceOnce = (pattern, make, what) => {
  if (!pattern.test(html)) throw new Error(`index.html has no ${what} tag to inline`);
  html = html.replace(pattern, make);
};
replaceOnce(/<link rel="stylesheet" href="style\.css">/, () => `<style>\n${css}</style>`, "style.css");
replaceOnce(/<script src="script\.js"><\/script>/, () => `<script>\n${js.replace(/<\/script/gi, "<\\/script")}</script>`, "script.js");

mkdirSync(join(dir, "build"), { recursive: true });
writeFileSync(join(dir, "build", "scriptureman.html"), html);
console.log("Wrote scriptureman/build/scriptureman.html");
