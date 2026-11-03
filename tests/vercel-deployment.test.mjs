import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const output = join(root, ".test-dist");

test.before(() => {
  rmSync(output, { recursive: true, force: true });
  execFileSync(process.execPath, [join(root, "scripts/build-vercel.mjs")], {
    cwd: root,
    env: { ...process.env, OUTPUT_DIRECTORY: output, BUILD_LINK_ASSETS: "1" },
    stdio: "pipe",
  });
});

test.after(() => {
  rmSync(output, { recursive: true, force: true });
});

test("Vercel config applies security and deliberate cache headers", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert.equal(config.outputDirectory, "dist");
  const globalHeaders = config.headers.find((rule) => rule.source === "/(.*)").headers;
  const header = (name) => globalHeaders.find(({ key }) => key === name)?.value;
  assert.match(header("Content-Security-Policy"), /frame-ancestors 'none'/);
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("X-Frame-Options"), "DENY");
  assert.match(header("Strict-Transport-Security"), /max-age=31536000/);
  assert.equal(header("Cache-Control"), "public, max-age=0, must-revalidate");
  const immutable = config.headers.filter((rule) => rule.headers.some(({ value }) => value.includes("immutable")));
  assert.deepEqual(immutable.map(({ source }) => source), [
    "/_next/static/(.*)",
    "/assets/favicons/(.*)",
    "/assets/vendor/(.*)",
  ]);
});

test("build contains required public routes and resources", () => {
  for (const relativePath of [
    "index.html",
    "PDFs/CateringMenu-2025-Template.pdf",
    "register/index.html",
    "staff/check-in/index.html",
    "ticket/index.html",
    "assets/videos/smoky-mike-drive-in.mp4",
    "assets/site-reliability.js",
  ]) {
    assert.ok(existsSync(join(output, relativePath)), `missing ${relativePath}`);
  }
});

test("build excludes dormant server code, secrets, archives, and development files", () => {
  for (const relativePath of [
    "backend",
    "wallet",
    "tests",
    "node_modules",
    "out/Archive.zip",
    "CREW_PASS_HANDOFF.md",
    "WALLET_SETUP.md",
    ".env",
  ]) {
    assert.equal(existsSync(join(output, relativePath)), false, `unexpected ${relativePath}`);
  }
});

test("homepage has resilient form, media, accessibility, and footer markup", () => {
  const page = readFileSync(join(output, "index.html"), "utf8");
  assert.doesNotMatch(page, />undefined</);
  assert.doesNotMatch(page, /window\.addEventListener\('load'/);
  assert.match(page, /action="https:\/\/formspree\.io\/f\/xkovnkog" method="POST"/);
  assert.match(page, /id="event-email" required=""/);
  assert.match(page, /id="event-people" type="number" min="10" max="500" required=""/);
  assert.match(page, /data-src="\/assets\/videos\/smoky-mike-drive-in\.mp4"/);
  assert.equal((page.match(/<video[^>]+controls=""/g) || []).length, 3);
  assert.match(page, /Cash \/ Check/);
  assert.match(page, /American Legion Member/);
  assert.match(page, /href="tel:\+17749923466"/);
  assert.match(page, /captainsmokeysbbq@gmail\.com/);
});

test("static homepage does not load the mismatched compiled Next runtime", () => {
  const page = readFileSync(join(output, "index.html"), "utf8");
  assert.doesNotMatch(page, /self\.__next_f/);
  assert.doesNotMatch(page, /<script[^>]+src="\/_next\//);
  assert.equal(existsSync(join(output, "_next/static/chunks/0df4c9dcd2e66f5b.js")), false);
  assert.ok(existsSync(join(output, "_next/static/chunks/54e00be915a8c017.css")));
});
