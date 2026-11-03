import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const script = readFileSync(resolve(root, "assets/site-reliability.js"), "utf8");
const css = readFileSync(resolve(root, "assets/css/reliability.css"), "utf8");

test("reliability layer respects reduced motion and keeps videos optional", () => {
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /video\.pause\(\)/);
  assert.match(script, /Video unavailable/);
  assert.match(script, /booking form are still available/);
});

test("form failures are visible and retain alternate contact options", () => {
  assert.match(script, /response\.ok/);
  assert.match(script, /entries are still here/);
  assert.match(script, /captainsmokeysbbq@gmail\.com/);
  assert.match(script, /774-992-3466/);
});

test("the owned enhancement layer supplies mobile navigation and carousels", () => {
  assert.match(script, /configureMobileMenu/);
  assert.match(script, /configureCarousel\("#video"\)/);
  assert.match(script, /configureCarousel\("#menu"\)/);
  assert.match(css, /scroll-snap-type: x mandatory/);
});

test("essential about content is visible without the motion runtime", () => {
  assert.match(css, /#about \[style\*="opacity:0"\]/);
  assert.match(css, /opacity: 1 !important/);
});
