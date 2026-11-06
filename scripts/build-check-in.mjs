#!/usr/bin/env node
/**
 * Copies the event-ticketing routes (staff check-in, registration, guest
 * ticket) and every local file they reference into a deploy folder.
 *
 *   node scripts/build-check-in.mjs                 # write into ./out
 *   node scripts/build-check-in.mjs --out dist      # write somewhere else
 *   node scripts/build-check-in.mjs --check         # exit 1 if ./out is stale
 *   node scripts/build-check-in.mjs --dry-run       # list files, write nothing
 *
 * What it does:
 *  - Starts from the route HTML files below and follows local src/href
 *    references plus CSS @import/url() references, so nothing is copied
 *    that the pages don't actually load (backend/, tests/, scripts/, docs
 *    and node_modules are never included).
 *  - Appends ?v=<content hash> to local .js/.css references in the copied
 *    HTML and CSS. The site's .htaccess caches JS/CSS for a year as
 *    "immutable", so without this, phones keep running old staff code.
 *  - Fails if a referenced local file is missing.
 *  - Only adds/overwrites files. It never deletes anything in the output
 *    folder, and it leaves every other site file (homepage, .htaccess,
 *    _next/, etc.) alone.
 *
 * It does not upload anything. Publishing to HostGator is a separate,
 * manual step.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROUTES = ["staff/check-in/index.html", "register/index.html", "ticket/index.html"];

const HASHED_EXTENSIONS = new Set([".js", ".css"]);

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function isLocalRef(ref) {
  return ref.startsWith("/") && !ref.startsWith("//");
}

function refToRelative(ref) {
  return decodeURIComponent(ref.split(/[?#]/)[0]).replace(/^\/+/, "");
}

function htmlRefs(html) {
  return [...html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
}

function cssRefs(css) {
  const clean = stripCssComments(css);
  const refs = [];
  for (const m of clean.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) refs.push(m[2]);
  for (const m of clean.matchAll(/@import\s+(["'])([^"']+)\1/gi)) refs.push(m[2]);
  return refs;
}

function shortHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 10);
}

/**
 * Returns Map<relativePath, Buffer> of every file the routes need, with
 * cache-busting already applied to HTML and CSS.
 */
export function collectBuild(sourceRoot, routes = ROUTES) {
  const output = new Map();
  const missing = [];
  const visiting = new Set();

  function build(rel, referencedFrom) {
    if (output.has(rel)) return output.get(rel);
    const abs = path.join(sourceRoot, rel);
    if (!abs.startsWith(sourceRoot + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missing.push(`${rel} (referenced from ${referencedFrom})`);
      return null;
    }
    if (visiting.has(rel)) return fs.readFileSync(abs); // CSS import cycle; keep as-is
    visiting.add(rel);

    const ext = path.extname(rel).toLowerCase();
    let content = fs.readFileSync(abs);

    if (ext === ".html" || ext === ".css") {
      let text = content.toString("utf8");
      const refs = ext === ".html" ? htmlRefs(text) : cssRefs(text);
      const versions = new Map();
      for (const ref of refs) {
        if (!isLocalRef(ref)) continue;
        const target = refToRelative(ref);
        if (!target || target.endsWith("/")) continue; // page links such as href="/"
        const built = build(target, rel);
        if (built && HASHED_EXTENSIONS.has(path.extname(target).toLowerCase())) {
          versions.set(ref, `/${target}?v=${shortHash(built)}`);
        }
      }
      for (const [ref, versioned] of versions) {
        text = text.split(`"${ref}"`).join(`"${versioned}"`).split(`'${ref}'`).join(`'${versioned}'`);
      }
      content = Buffer.from(text, "utf8");
    }

    visiting.delete(rel);
    output.set(rel, content);
    return content;
  }

  for (const route of routes) build(route, "route list");
  if (missing.length) {
    const err = new Error(`Missing referenced files:\n  ${missing.join("\n  ")}`);
    err.missing = missing;
    throw err;
  }
  return output;
}

export function diffAgainst(outRoot, files) {
  const stale = [];
  for (const [rel, content] of files) {
    const dest = path.join(outRoot, rel);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(content)) stale.push(rel);
  }
  return stale;
}

export function writeBuild(outRoot, files) {
  const written = [];
  for (const [rel, content] of files) {
    const dest = path.join(outRoot, rel);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(content)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    written.push(rel);
  }
  return written;
}

function parseArgs(argv) {
  const opts = { out: "out", check: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check") opts.check = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg.startsWith("--out=")) opts.out = arg.slice(6);
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!opts.out) throw new Error("--out needs a folder name");
  return opts;
}

function main() {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: node scripts/build-check-in.mjs [--out <dir>] [--check] [--dry-run]");
    return 0;
  }

  const outRoot = path.resolve(sourceRoot, opts.out);
  if (outRoot === sourceRoot || !outRoot.startsWith(sourceRoot + path.sep)) {
    throw new Error(`Refusing to build into ${outRoot}: choose a subfolder of the repository.`);
  }

  const files = collectBuild(sourceRoot);
  const stale = diffAgainst(outRoot, files);
  const label = path.relative(sourceRoot, outRoot);

  if (opts.dryRun) {
    for (const rel of files.keys()) console.log(`${stale.includes(rel) ? "update" : "same  "}  ${label}/${rel}`);
    console.log(`${files.size} files, ${stale.length} would change. Nothing written.`);
    return 0;
  }

  if (opts.check) {
    if (stale.length) {
      console.log(`${label}/ is out of date (${stale.length} of ${files.size} files):`);
      stale.forEach((rel) => console.log(`  ${rel}`));
      console.log("Run: node scripts/build-check-in.mjs");
      return 1;
    }
    console.log(`${label}/ is up to date (${files.size} files).`);
    return 0;
  }

  const written = writeBuild(outRoot, files);
  written.forEach((rel) => console.log(`wrote  ${label}/${rel}`));
  console.log(`${written.length} written, ${files.size - written.length} already current. Nothing was deleted or uploaded.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
