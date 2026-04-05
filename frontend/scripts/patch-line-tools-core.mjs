/**
 * Patches lightweight-charts-line-tools-core:
 * - dist: getViewportBounds null-safe (safeLineToolGetChart + teardown)
 * - src/utils/culling-helpers.ts: same guards (tsc / other bundlers that compile from source)
 * Idempotent; run after build-git-line-tools.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MARKER_V2 = "__PATCH_VP_TRY__";
/** Legacy marker from first patch version — migrates to v2 on next run */
const MARKER_V1 = "__PATCH_VIEWPORT_NULL_CHART__";
const SRC_MARKER = "__TRADINGCHART_CULLING_HELPERS_PATCH__";

const candidates = [
  join(root, "node_modules", "lightweight-charts-line-tools-core"),
  join(root, "..", "node_modules", "lightweight-charts-line-tools-core"),
];

function patchCullingHelpersSource(pkgDir) {
  const srcPath = join(pkgDir, "src", "utils", "culling-helpers.ts");
  if (!existsSync(srcPath)) return;
  let content = readFileSync(srcPath, "utf8");
  if (content.includes(SRC_MARKER)) {
    console.log(`[patch-line-tools-core] source already patched: ${srcPath}`);
    return;
  }
  const needle =
    "\tconst chart = tool.getChart();\n\tconst series = tool.getSeries();\n\tconst timeScale = chart.timeScale();";
  if (!content.includes(needle)) {
    console.warn(
      `[patch-line-tools-core] source pattern not found, skip: ${srcPath}`,
    );
    return;
  }
  const replacement = `\tconst chart = tool.getChart();
\tconst series = tool.getSeries();
\tif (chart == null || series == null) {
\t\treturn null;
\t}
\t// ${SRC_MARKER}
\tlet timeScale: ReturnType<IChartApiBase<HorzScaleItem>["timeScale"]>;
\ttry {
\t\ttimeScale = chart.timeScale();
\t} catch {
\t\treturn null;
\t}
\tif (timeScale == null) {
\t\treturn null;
\t}`;
  writeFileSync(srcPath, content.replace(needle, replacement), "utf8");
  console.log(`[patch-line-tools-core] patched source: ${srcPath}`);
}

function patchFile(distPath) {
  let content = readFileSync(distPath, "utf8");
  if (content.includes(MARKER_V2)) {
    console.log(`[patch-line-tools-core] already patched (${MARKER_V2}): ${distPath}`);
    return;
  }

  // v1 → v2: add try/catch + timeScale null check (LW v5 API edge cases)
  if (content.includes(MARKER_V1)) {
    const migrated = content.replace(
      /if\(chart==null\|\|series==null\)\{return null;\}\/\*\*__PATCH_VIEWPORT_NULL_CHART__\*\/const timeScale = chart\.timeScale\(\);/,
      `if(chart==null||series==null){return null;}let timeScale;try{timeScale=chart.timeScale();}catch(__vp){return null;}if(timeScale==null){return null;}/**${MARKER_V2}*/`,
    );
    if (migrated !== content) {
      writeFileSync(distPath, migrated, "utf8");
      console.log(`[patch-line-tools-core] migrated v1→v2: ${distPath}`);
      return;
    }
  }

  const re =
    /function getViewportBounds\(tool\) \{[\s\S]*?const chart = tool\.getChart\(\);[\s\S]*?const series = tool\.getSeries\(\);[\s\S]*?const timeScale = chart\.timeScale\(\);/;
  if (!re.test(content)) {
    console.warn(
      `[patch-line-tools-core] pattern not found, skip: ${distPath}`,
    );
    return;
  }
  content = content.replace(
    re,
    (match) =>
      match.replace(
        /const timeScale = chart\.timeScale\(\);/,
        `if(chart==null||series==null){return null;}let timeScale;try{timeScale=chart.timeScale();}catch(__vp){return null;}if(timeScale==null){return null;}/**${MARKER_V2}*/`,
      ),
  );
  writeFileSync(distPath, content, "utf8");
  console.log(`[patch-line-tools-core] patched: ${distPath}`);
}

for (const pkgDir of candidates) {
  if (!existsSync(pkgDir)) continue;
  patchCullingHelpersSource(pkgDir);
  const distPath = join(
    pkgDir,
    "dist",
    "lightweight-charts-line-tools-core.js",
  );
  if (existsSync(distPath)) patchFile(distPath);
}
