import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, process.env.OUTPUT_DIRECTORY || "dist");

// HTML files are the editable source. Only these public files and folders are
// packaged; archives, backend source, credentials, and tests stay private.
const publicPaths = [
  "index.html",
  "menu",
  "404.html",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "PDFs",
  "register",
  "staff",
  "ticket",
  "assets/css",
  "assets/fonts",
  "assets/event-ticketing",
  "assets/favicons",
  "assets/food",
  "assets/gallery",
  "assets/vendor/qrcode-generator-1.4.4/qrcode.js",
  "assets/flag_wave.webp",
  "assets/flag_wave_mobile.webp",
  "assets/logo.webp",
  "assets/smokey-mike.webp",
  "assets/vob.webp",
  "assets/videos",
  "assets/site-reliability.js",
];

function copyTree(source, destination) {
  const stats = statSync(source);
  if (stats.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(destination, entry));
    }
    return;
  }
  mkdirSync(dirname(destination), { recursive: true });
  if (process.env.BUILD_LINK_ASSETS === "1" && source.endsWith(".mp4")) {
    linkSync(source, destination);
    return;
  }
  // Clone large media on APFS; other filesystems fall back to a normal copy.
  copyFileSync(source, destination, constants.COPYFILE_FICLONE);
}

function versionPageAssets(relativePath) {
  const pagePath = join(output, relativePath);
  const source = readFileSync(pagePath, "utf8");
  const page = source.replace(
    /\b(href|src)="(\/(?:assets|PDFs)\/[^"?#]+\.(?:css|js|pdf))"/gi,
    (_, attribute, pathname) => {
      const asset = readFileSync(join(output, pathname));
      const version = createHash("sha256").update(asset).digest("hex").slice(0, 12);
      return `${attribute}="${pathname}?v=${version}"`;
    },
  );
  writeFileSync(pagePath, page);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const relativePath of publicPaths) {
  const source = join(root, relativePath);
  if (!existsSync(source)) throw new Error(`Required deployment asset is missing: ${relativePath}`);
  copyTree(source, join(output, relativePath));
}

for (const page of ["index.html", "menu/index.html", "404.html"]) {
  versionPageAssets(page);
}

console.log(`Built deployable static site at ${output}`);
