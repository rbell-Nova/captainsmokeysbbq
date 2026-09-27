// Branded favicons on every page (event pages plus the exported home/404).
//
//   node tests/favicons.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectBuild } from "../scripts/build-check-in.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["staff/check-in/index.html", "register/index.html", "ticket/index.html",
  "index.html", "404.html", "404/index.html", "_not-found/index.html"];
const icons = [
  ["assets/favicons/smokey-favicon-v1.ico", null],
  ["assets/favicons/smokey-favicon-16-v1.png", 16],
  ["assets/favicons/smokey-favicon-32-v1.png", 32],
  ["assets/favicons/smokey-icon-192-v1.png", 192],
  ["assets/favicons/smokey-apple-touch-icon-v1.png", 180],
];

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", `${file} is a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n${err.stack}`);
  }
}

test("icon files exist with the expected dimensions", () => {
  for (const [rel, size] of icons) {
    const file = path.join(root, rel);
    assert.ok(fs.existsSync(file), `${rel} missing`);
    if (size) assert.deepEqual(pngSize(file), [size, size], rel);
  }
  const ico = fs.readFileSync(path.join(root, icons[0][0]));
  assert.equal(ico.readUInt16LE(2), 1, "ICO type");
  assert.ok(ico.readUInt16LE(4) >= 3, "ICO has 16/32/48 sizes");
});

for (const page of pages) {
  test(`${page} links every branded icon and not the old default`, () => {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    for (const [rel] of icons) assert.match(html, new RegExp(`href="/${rel.replace(/\./g, "\\.")}"`), `${page} → ${rel}`);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.doesNotMatch(html, /href="\/favicon\.ico"/, "old Vercel default icon is gone");
    assert.doesNotMatch(html, /favicon\.0b3bf435/, "Next.js default icon (tag and RSC payload) is gone");
  });
}

test("/favicon.ico (browsers' default request) is the Smokey icon, not the Next.js triangle", () => {
  const rootIco = fs.readFileSync(path.join(root, "favicon.ico"));
  assert.ok(rootIco.equals(fs.readFileSync(path.join(root, "assets/favicons/smokey-favicon-v1.ico"))));
});

test("the build bundles the icons", () => {
  const files = collectBuild(root);
  for (const [rel] of icons) assert.ok(files.has(rel), `${rel} not in build`);
});

if (failed) {
  console.error(`${failed} favicon test(s) failed.`);
  process.exit(1);
}
console.log("Favicon tests passed.");
