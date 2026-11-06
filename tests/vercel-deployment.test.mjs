import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
    "/assets/fonts/(.*)",
    "/assets/favicons/(.*)",
    "/assets/vendor/(.*)",
  ]);
});

test("build contains required public routes and resources", () => {
  for (const relativePath of [
    "index.html",
    "menu/index.html",
    "assets/css/menu.css",
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
  assert.match(page, /<fieldset class="event-schedule">/);
  assert.match(page, /id="event-date" required="" type="date"/);
  assert.match(page, /id="event-time" required="" type="time"/);
  assert.match(page, /id="schedule-summary"/);
  assert.match(page, /data-src="\/assets\/videos\/smoky-mike-drive-in\.mp4"/);
  for (const tag of page.match(/<video[^>]*>/g) || []) {
    assert.doesNotMatch(tag, /\scontrols(?:\s|=|>)/);
    assert.match(tag, /muted=""/);
    assert.match(tag, /disablepictureinpicture=""/);
  }
  assert.equal((page.match(/<button type="button" class="swiper-button-prev"><\/button>/g) || []).length, 2);
  assert.equal((page.match(/<button type="button" class="swiper-button-next"><\/button>/g) || []).length, 2);
  assert.match(page, /href="\/menu\/">Menu<\/a>/);
  assert.match(page, /id="mobile-menu"[^>]*>[\s\S]*?<a href="\/menu\/">Menu<\/a>/);
  assert.match(page, /reliability\.css\?v=[a-f0-9]{12}/);
  assert.match(page, /site-reliability\.js\?v=[a-f0-9]{12}/);
  assert.match(page, /Cash \/ Check/);
  assert.match(page, /American Legion Member/);
  assert.match(page, /href="tel:\+17749923466"/);
  assert.match(page, /captainsmokeysbbq@gmail\.com/);
});

test("the menu route publishes its assets, PDF, and return navigation", () => {
  const page = readFileSync(join(output, "menu/index.html"), "utf8");
  assert.match(page, /href="\/"[^>]*>[\s\S]*?Back to home/);
  assert.match(page, /href="\/#book"/);
  assert.match(page, /menu\.css\?v=[a-f0-9]{12}/);
  assert.match(page, /CateringMenu-2025-Template\.pdf\?v=[a-f0-9]{12}/);
  for (const match of page.matchAll(/(?:src|href)="(\/[^"#?]+)(?:\?[^"#]*)?"/g)) {
    const pathname = match[1];
    const file = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    assert.ok(existsSync(join(output, file)), `menu asset missing: ${pathname}`);
  }
});

test("public pages are maintained HTML; packaging only versions their assets", () => {
  for (const relativePath of ["index.html", "menu/index.html", "404.html"]) {
    const source = readFileSync(join(root, relativePath), "utf8");
    const page = readFileSync(join(output, relativePath), "utf8");
    assert.doesNotMatch(source, /self\.__next_f|\/_next\/|data-nimg|next-size-adjust/);
    assert.equal(page.replace(/\?v=[a-f0-9]{12}/g, ""), source, relativePath);
    for (const match of page.matchAll(/(?:src|href)="(\/[^"#?]+)(?:\?v=([a-f0-9]{12}))?"/g)) {
      const pathname = match[1];
      const file = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      assert.ok(existsSync(join(output, file)), `${relativePath} references missing ${pathname}`);
      if (match[2]) {
        const digest = createHash("sha256").update(readFileSync(join(output, file))).digest("hex").slice(0, 12);
        assert.equal(match[2], digest, `wrong content version for ${pathname}`);
      }
    }
  }
  assert.equal(existsSync(join(output, "_next")), false);
});

test("shared styles and menu styles resolve their locally hosted fonts", () => {
  for (const relativePath of ["assets/css/site.css", "assets/css/carousel.css", "assets/css/menu.css", "assets/css/tokens.css"]) {
    const css = readFileSync(join(output, relativePath), "utf8");
    assert.doesNotMatch(css, /\/_next\/|\.\.\/media\//);
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const url = match[1];
      if (/^(data:|https?:|#)/.test(url)) continue;
      const asset = url.startsWith("/") ? join(output, url) : resolve(output, dirname(relativePath), url);
      assert.ok(existsSync(asset), `${relativePath} references missing ${url}`);
    }
  }
});
