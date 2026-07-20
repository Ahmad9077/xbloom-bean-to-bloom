#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const defaultWebDist = join(repoRoot, "web", "dist");
const defaultAssetsDist = join(repoRoot, "assets-dist");

async function requireDirectory(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch {
    throw new Error(`${label} is missing: ${path}`);
  }

  if (!details.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function copyFileWithoutReplacingImmutableAsset(source, destination, relativePath) {
  const isHashedAsset = relativePath.split(sep)[0] === "assets";

  if (isHashedAsset) {
    let destinationExists = true;
    try {
      await access(destination);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      destinationExists = false;
    }

    if (destinationExists) {
      if ((await digest(source)) !== (await digest(destination))) {
        throw new Error(
          `Refusing to replace an existing immutable asset with different content: ${relativePath}`,
        );
      }
      return;
    }
  }

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyTree(sourceRoot, targetRoot, currentSource = sourceRoot) {
  const entries = await readdir(currentSource, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  let copiedFiles = 0;
  for (const entry of entries) {
    const source = join(currentSource, entry.name);
    const relativePath = relative(sourceRoot, source);
    const destination = join(targetRoot, relativePath);

    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true });
      copiedFiles += await copyTree(sourceRoot, targetRoot, source);
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(`Unsupported entry in web build output: ${source}`);
    }

    if (relativePath === "index.html") {
      continue;
    }

    await copyFileWithoutReplacingImmutableAsset(source, destination, relativePath);
    copiedFiles += 1;
  }

  return copiedFiles;
}

/**
 * Copies a completed Vite build into the Worker asset directory.
 *
 * Existing files are intentionally never deleted, so an already-open browser
 * and a rollback can continue to request an older content-hashed asset. The
 * new index.html is copied last, after every asset it references is available.
 */
export async function stageWebAssets({
  webDist = defaultWebDist,
  assetsDist = defaultAssetsDist,
} = {}) {
  const sourceRoot = resolve(webDist);
  const targetRoot = resolve(assetsDist);
  const sourceIndex = join(sourceRoot, "index.html");

  await requireDirectory(sourceRoot, "Web build output");
  try {
    await access(sourceIndex);
  } catch {
    throw new Error(`Web build output is missing index.html: ${sourceIndex}`);
  }

  await mkdir(targetRoot, { recursive: true });
  const copiedFiles = await copyTree(sourceRoot, targetRoot);
  await copyFile(sourceIndex, join(targetRoot, "index.html"));

  return {
    sourceRoot,
    targetRoot,
    copiedFiles: copiedFiles + 1,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  stageWebAssets()
    .then(({ sourceRoot, targetRoot, copiedFiles }) => {
      console.log(
        `[stage-web-assets] Staged ${copiedFiles} files from ${sourceRoot} to ${targetRoot}; existing hashed assets were preserved.`,
      );
    })
    .catch((error) => {
      console.error(`[stage-web-assets] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
