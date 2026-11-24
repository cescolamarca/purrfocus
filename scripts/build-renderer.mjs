import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const rootDir = process.cwd();
const outRendererDir = path.join(rootDir, "dist", "renderer");
const vendor98Dir = path.join(outRendererDir, "vendor", "98css");
const outAssetsDir = path.join(outRendererDir, "assets", "cats");

function copyDirRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing directory: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  fs.mkdirSync(outRendererDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "renderer", "app.ts")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    sourcemap: false,
    outfile: path.join(outRendererDir, "bundle.js")
  });

  fs.copyFileSync(
    path.join(rootDir, "src", "renderer", "index.html"),
    path.join(outRendererDir, "index.html")
  );
  fs.copyFileSync(
    path.join(rootDir, "src", "renderer", "styles.css"),
    path.join(outRendererDir, "styles.css")
  );

  copyDirRecursive(path.join(rootDir, "node_modules", "98.css", "dist"), vendor98Dir);
  copyDirRecursive(path.join(rootDir, "assets", "cats"), outAssetsDir);

  console.log("Renderer bundle and assets built successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
