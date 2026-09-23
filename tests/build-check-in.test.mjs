// Tests for scripts/build-check-in.mjs.
//
//   node tests/build-check-in.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectBuild, diffAgainst, writeBuild, ROUTES } from "../scripts/build-check-in.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smokey-build-"));
}

function writeTree(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
    fs.writeFileSync(path.join(base, rel), content);
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// --- the real repository -------------------------------------------------

test("every route and the files it loads resolve in this repo", () => {
  const files = collectBuild(root);
  for (const route of ROUTES) assert.ok(files.has(route), `${route} missing from build`);
  for (const rel of [
    "staff/assets/js/check-in-app.js",
    "staff/assets/css/staff.css",
    "assets/css/tokens.css",
    "assets/event-ticketing/repository.js",
    "assets/event-ticketing/config.js",
    "register/assets/js/register-form.js",
    "ticket/assets/js/ticket-page.js",
  ]) {
    assert.ok(files.has(rel), `${rel} should be included`);
  }
});

test("build never includes backend, tests, scripts, docs, or node_modules", () => {
  for (const rel of collectBuild(root).keys()) {
    assert.doesNotMatch(rel, /^(backend|tests|scripts|node_modules|out)\//, rel);
    assert.doesNotMatch(rel, /\.md$/i, rel);
  }
});

test("local JS/CSS references get a content-hash version", () => {
  const html = collectBuild(root).get("staff/check-in/index.html").toString("utf8");
  assert.match(html, /src="\/staff\/assets\/js\/check-in-app\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /href="\/staff\/assets\/css\/staff\.css\?v=[0-9a-f]{10}"/);
  assert.match(html, /src="\/assets\/event-ticketing\/repository\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /href="\/favicon\.ico"/, "non-JS/CSS assets are left unversioned");
  assert.match(html, /href="\/"/, "page links are untouched");
});

test("source files are not modified by a build", () => {
  const before = fs.readFileSync(path.join(root, "staff/check-in/index.html"));
  collectBuild(root);
  assert.ok(before.equals(fs.readFileSync(path.join(root, "staff/check-in/index.html"))));
});

// --- fixtures -------------------------------------------------------------

test("changing a script changes its version in the HTML", () => {
  const src = tempDir();
  writeTree(src, {
    "staff/check-in/index.html": '<link href="/a.css"><script src="/app.js"></script>',
    "a.css": '@import url("/b.css");',
    "b.css": "body{}",
    "app.js": "one();",
  });
  const routes = ["staff/check-in/index.html"];
  const first = collectBuild(src, routes);
  fs.writeFileSync(path.join(src, "app.js"), "two();");
  const second = collectBuild(src, routes);
  assert.notEqual(first.get("staff/check-in/index.html").toString(), second.get("staff/check-in/index.html").toString());
  assert.equal(first.get("a.css").toString(), second.get("a.css").toString(), "unrelated CSS keeps its version");
  assert.match(second.get("a.css").toString(), /@import url\("\/b\.css\?v=[0-9a-f]{10}"\)/, "CSS imports are versioned too");
});

test("a missing referenced file fails the build with its source", () => {
  const src = tempDir();
  writeTree(src, { "staff/check-in/index.html": '<script src="/gone.js"></script>' });
  assert.throws(() => collectBuild(src, ["staff/check-in/index.html"]), /gone\.js \(referenced from staff\/check-in\/index\.html\)/);
});

test("commented-out and external references are ignored", () => {
  const src = tempDir();
  writeTree(src, {
    "page.html": '<link href="/s.css"><script src="https://cdn.example/x.js"></script>',
    "s.css": '/* @import url("/nope.css"); */ @import url("https://fonts.example/f.css");',
  });
  const files = collectBuild(src, ["page.html"]);
  assert.deepEqual([...files.keys()].sort(), ["page.html", "s.css"]);
});

test("writing is additive and --check reports staleness", () => {
  const src = tempDir();
  const out = tempDir();
  writeTree(src, { "page.html": '<script src="/app.js"></script>', "app.js": "x();" });
  writeTree(out, { "index.html": "homepage", ".htaccess": "rules" });
  const files = collectBuild(src, ["page.html"]);

  assert.deepEqual(diffAgainst(out, files).sort(), ["app.js", "page.html"]);
  assert.deepEqual(writeBuild(out, files).sort(), ["app.js", "page.html"]);
  assert.deepEqual(diffAgainst(out, files), []);
  assert.deepEqual(writeBuild(out, files), [], "second run writes nothing");
  assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8"), "homepage", "other site files untouched");
  assert.equal(fs.readFileSync(path.join(out, ".htaccess"), "utf8"), "rules");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n${err && err.stack ? err.stack : err}`);
  }
}
if (failed) {
  console.error(`${failed} build test(s) failed.`);
  process.exit(1);
}
console.log(`Build script tests passed (${tests.length}).`);
