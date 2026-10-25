// Builds and runs the Excel smoke test via esbuild's JS API (avoids
// npm-on-Windows argument-quoting pitfalls).
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, ".smoke.bundle.mjs");

await build({
  entryPoints: [join(here, "smoke-excel.mts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "error",
  define: { "import.meta.env": "{}" },
  banner: { js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);' },
});

const res = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
process.exitCode = res.status ?? 1;
