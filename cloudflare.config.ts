import { defineConfig, defineWorker, exports } from "cf/config";
import * as entrypoint from "./worker/index.ts" with { type: "cf-worker" };

const worker = defineWorker({
  name: "seminary-games",
  compatibilityDate: "2026-11-01",
  entrypoint,
  // Pages are static files; only /api/* runs the Worker.
  assets: { runWorkerFirst: ["/api/*"], htmlHandling: "auto-trailing-slash" },
  exports: {
    GameRoom: exports.durableObject({ storage: "sqlite" })
  },
  env: {}
});

export default defineConfig({ worker });
