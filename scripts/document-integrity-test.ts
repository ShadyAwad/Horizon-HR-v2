import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const scriptsRoot = path.resolve("scripts");
const temp = await mkdtemp(path.join(scriptsRoot, ".document-test-"));
try {
  const output = path.join(temp, "check.mjs");
  await build({
    entryPoints: ["scripts/document-integrity-check.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    packages: "external",
    format: "esm",
    jsx: "automatic",
    define: {
      "import.meta.env": JSON.stringify({ DEV: false, BASE_URL: "/" }),
    },
  });
  await import(pathToFileURL(output).href);
} finally {
  const relative = path.relative(scriptsRoot, path.resolve(temp));
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(temp).startsWith(".document-test-")
  )
    throw Error("Unsafe temporary test path");
  await rm(temp, { recursive: true, force: true });
}
