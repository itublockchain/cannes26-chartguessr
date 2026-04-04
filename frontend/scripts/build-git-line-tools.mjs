import { execSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function pruneNestedLightweightCharts(packageRoot) {
  const walk = (dir) => {
    const nm = join(dir, "node_modules");
    if (!existsSync(nm)) return;
    const nested = join(nm, "lightweight-charts");
    if (existsSync(nested)) {
      rmSync(nested, { recursive: true, force: true });
    }
    for (const name of readdirSync(nm)) {
      if (name === ".bin") continue;
      const child = join(nm, name);
      try {
        if (statSync(child).isDirectory()) {
          walk(child);
        }
      } catch (e) {}
    }
  };
  try {
    walk(packageRoot);
  } catch (e) {}
}

const packages = [
  {
    name: "lightweight-charts-line-tools-core",
    distFile: "dist/lightweight-charts-line-tools-core.js",
  },
  {
    name: "lightweight-charts-line-tools-lines",
    distFile: "dist/lightweight-charts-line-tools-lines.js",
  },
  {
    name: "lightweight-charts-line-tools-freehand",
    distFile: "dist/lightweight-charts-line-tools-freehand.js",
  },
  {
    name: "lightweight-charts-line-tools-fib-retracement",
    distFile: "dist/lightweight-charts-line-tools-fib-retracement.js",
  },
];

for (const { name, distFile } of packages) {
  // Find where it is installed. It might be in frontend/node_modules or ../node_modules
  const localPkgDir = join(root, "node_modules", name);
  const rootPkgDir = join(root, "..", "node_modules", name);
  
  let pkgDir = "";
  if (existsSync(localPkgDir)) {
    pkgDir = localPkgDir;
  } else if (existsSync(rootPkgDir)) {
    pkgDir = rootPkgDir;
  }

  if (!pkgDir) {
    console.warn(`[postinstall] skip ${name}: not found in node_modules`);
    continue;
  }

  const distPath = join(pkgDir, distFile);
  if (existsSync(distPath)) {
    console.log(`[postinstall] ${name} already built.`);
    continue;
  }

  console.log(`[postinstall] building ${name} at ${pkgDir}...`);
  try {
    execSync("bun install", {
      cwd: pkgDir,
      stdio: "inherit",
    });
    pruneNestedLightweightCharts(pkgDir);
    execSync("bun run build", {
      cwd: pkgDir,
      stdio: "inherit",
    });
  } catch (e) {
    console.error(`[postinstall] failed to build ${name}:`, e.message);
  }
}
