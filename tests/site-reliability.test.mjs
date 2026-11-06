import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const script = readFileSync(resolve(root, "assets/site-reliability.js"), "utf8");
const css = readFileSync(resolve(root, "assets/css/reliability.css"), "utf8");

test("reliability layer keeps active videos muted, automatic, and optional", () => {
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /video\.pause\(\)/);
  assert.match(script, /video\.controls = false/);
  assert.match(script, /video\.muted = true/);
  assert.match(script, /disablePictureInPicture = true/);
  assert.match(script, /carouselchange/);
  assert.doesNotMatch(script, /video\.controls = true/);
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
  assert.match(script, /track\.scrollTo/);
  assert.match(script, /track\.setPointerCapture/);
  assert.match(script, /moveTo\(activeIndex \+ direction\)/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /#video \.site-carousel-arrow/);
  assert.match(css, /#video \.swiper-wrapper\.is-dragging/);
});

test("the booking schedule stays within the mobile form and has a readable preview", () => {
  assert.match(css, /\.event-schedule__fields/);
  assert.match(css, /grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 0\.8fr\)/);
  assert.match(css, /#book form input,[\s\S]*min-width: 0/);
  assert.match(script, /configureSchedulePreview\(form\)/);
  assert.match(script, /toLocaleDateString/);
  assert.match(script, /toLocaleTimeString/);
});

test("essential about content is visible without the motion runtime", () => {
  const page = readFileSync(resolve(root, "index.html"), "utf8");
  const about = page.match(/<section id="about"[\s\S]*?<\/section>/)?.[0];
  assert.ok(about, "About section is present in the authored HTML");
  assert.match(about, /About Smokey Mike/);
  assert.match(about, /alt="Smokey Mike"/);
  assert.doesNotMatch(about, /opacity:\s*0|visibility:\s*hidden|\shidden(?:=|\s|>)/);
});
