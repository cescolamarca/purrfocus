import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const DEFAULT_ZIP = path.join(os.homedir(), "Downloads", "Tiny Cat.zip");
const zipPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ZIP;
const outDir = path.resolve(process.cwd(), "assets", "cats");

function readZipEntries(buffer) {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid zip archive: end of central directory not found.");
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];

  for (let idx = 0; idx < totalEntries; idx++) {
    if (buffer.readUInt32LE(cdOffset) !== 0x02014b50) {
      throw new Error("Invalid central directory header.");
    }
    const compressionMethod = buffer.readUInt16LE(cdOffset + 10);
    const compressedSize = buffer.readUInt32LE(cdOffset + 20);
    const fileNameLen = buffer.readUInt16LE(cdOffset + 28);
    const extraLen = buffer.readUInt16LE(cdOffset + 30);
    const commentLen = buffer.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);
    const name = buffer.toString("utf8", cdOffset + 46, cdOffset + 46 + fileNameLen);

    cdOffset += 46 + fileNameLen + extraLen + commentLen;

    if (name.endsWith("/") || !name.toLowerCase().endsWith(".png")) {
      continue;
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid local header for ${name}`);
    }
    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawSlice = buffer.subarray(dataStart, dataStart + compressedSize);

    let content;
    if (compressionMethod === 0) {
      content = rawSlice;
    } else if (compressionMethod === 8) {
      content = zlib.inflateRawSync(rawSlice);
    } else {
      throw new Error(`Unsupported compression method ${compressionMethod} for ${name}`);
    }

    entries.push({ name: path.basename(name), content });
  }

  return entries;
}

function formatCatSkin(fileName) {
  const base = fileName.replace(/\.png$/i, "").replace(/^tiny cat_spritesheet_/i, "");
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const label = base
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? `#${Number(part) + 1}` : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
  return { id, label, file: fileName };
}

function main() {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Sprite zip not found at: ${zipPath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const zipBuffer = fs.readFileSync(zipPath);
  const entries = readZipEntries(zipBuffer).sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) {
    throw new Error("No PNG sprite sheets found in archive.");
  }

  const manifest = [];
  for (const entry of entries) {
    fs.writeFileSync(path.join(outDir, entry.name), entry.content);
    manifest.push(formatCatSkin(entry.name));
  }

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Extracted ${manifest.length} cat sprite sheets to ${outDir}`);
}

main();
