import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = __dirname;

const require = createRequire(import.meta.url);

/** Force Rollup `dist` entrypoints so dev never executes raw `src/*.ts` (postinstall patches only touch dist + src guard). */
function lineToolsDist(pkg: string, distFile: string): string {
  try {
    const pkgRoot = path.dirname(require.resolve(`${pkg}/package.json`));
    return path.join(pkgRoot, distFile);
  } catch {
    return pkg;
  }
}

// https://vite.dev/config/
export default defineConfig({
  root: frontendDir,
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "lightweight-charts-line-tools-core": lineToolsDist(
        "lightweight-charts-line-tools-core",
        "dist/lightweight-charts-line-tools-core.js",
      ),
      "lightweight-charts-line-tools-lines": lineToolsDist(
        "lightweight-charts-line-tools-lines",
        "dist/lightweight-charts-line-tools-lines.js",
      ),
      "lightweight-charts-line-tools-freehand": lineToolsDist(
        "lightweight-charts-line-tools-freehand",
        "dist/lightweight-charts-line-tools-freehand.js",
      ),
      "lightweight-charts-line-tools-fib-retracement": lineToolsDist(
        "lightweight-charts-line-tools-fib-retracement",
        "dist/lightweight-charts-line-tools-fib-retracement.js",
      ),
    },
    dedupe: ["lightweight-charts"],
  },
  optimizeDeps: {
    // Line tools: use pre-built dist via alias (postinstall patches core dist).
    include: [
      "lightweight-charts-line-tools-core",
      "lightweight-charts-line-tools-lines",
      "lightweight-charts-line-tools-freehand",
      "lightweight-charts-line-tools-fib-retracement",
    ],
  },
  server: {
    port: 3000,
    host: true,
    fs: {
      allow: [frontendDir, path.resolve(frontendDir, "..")],
    },
  },
});
