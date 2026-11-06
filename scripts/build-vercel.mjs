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

function assetUrl(path) {
  const version = createHash("sha256").update(readFileSync(join(root, path))).digest("hex").slice(0, 12);
  return `/${path}?v=${version}`;
}

function copy(relativePath) {
  const source = join(root, relativePath);
  const destination = join(output, relativePath);
  if (!existsSync(source)) {
    throw new Error(`Required deployment asset is missing: ${relativePath}`);
  }
  copyTree(source, destination);
}

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
  // APFS can clone large media without duplicating blocks. Other filesystems
  // transparently fall back to a normal copy.
  copyFileSync(source, destination, constants.COPYFILE_FICLONE);
}

function replaceExactly(source, search, replacement, expectedCount, label) {
  const matches = source.split(search).length - 1;
  if (matches !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} match(es), found ${matches}`);
  }
  return source.split(search).join(replacement);
}

function replacePatternExactly(source, pattern, replacement, expectedCount, label) {
  const matches = source.match(pattern) || [];
  if (matches.length !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} match(es), found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

function patchHomepage() {
  const pagePath = join(output, "index.html");
  let page = readFileSync(pagePath, "utf8");

  page = replaceExactly(
    page,
    "</head>",
    `<link rel="stylesheet" href="${assetUrl("assets/css/reliability.css")}"/><script src="${assetUrl("assets/site-reliability.js")}" defer></script></head>`,
    1,
    "reliability assets",
  );

  const desktopMenuLink = '<a class="font-heading uppercase tracking-wide text-lg hover:text-primary transition-colors text-white drop-shadow-md" href="#menu">Menu</a>';
  page = replaceExactly(
    page,
    desktopMenuLink,
    '<a class="font-heading uppercase tracking-wide text-lg hover:text-primary transition-colors text-white drop-shadow-md" href="/menu/">Menu</a>',
    1,
    "desktop catering menu link",
  );

  page = replaceExactly(
    page,
    'href="/PDFs/CateringMenu-2025-Template.pdf" target="_blank" rel="noopener noreferrer"',
    'href="/menu/"',
    1,
    "full catering menu link",
  );

  page = replaceExactly(
    page,
    '<form class="space-y-6">',
    '<form class="space-y-6" action="https://formspree.io/f/xkovnkog" method="POST">',
    1,
    "booking form fallback",
  );
  page = replaceExactly(page, ' id="event-name"', ' id="event-name" minlength="2"', 1, "name length");
  page = replaceExactly(page, ' id="event-phone"', ' id="event-phone" minlength="10"', 1, "phone length");

  page = page.replace(
    /<video preload="none" src="([^"]+)" muted="" playsInline="" loop="" class=/g,
    '<video preload="none" data-src="$1" muted="" playsInline="" loop="" disablepictureinpicture="" disableremoteplayback="" controlslist="nodownload noplaybackrate nofullscreen noremoteplayback" class=',
  );
  if ((page.match(/<video preload="none" data-src=/g) || []).length !== 3) {
    throw new Error("video loading: expected three lazy video elements");
  }

  page = replaceExactly(
    page,
    '<div class="swiper-button-prev"></div>',
    '<button type="button" class="swiper-button-prev"></button>',
    2,
    "previous carousel buttons",
  );
  page = replaceExactly(
    page,
    '<div class="swiper-button-next"></div>',
    '<button type="button" class="swiper-button-next"></button>',
    2,
    "next carousel buttons",
  );

  const legionImage = '<div class="relative w-32 h-32"><img alt="American Legion Member" loading="lazy" decoding="async" data-nimg="fill" class="object-contain rounded-full" style="position:absolute;height:100%;width:100%;left:0;top:0;right:0;bottom:0;color:transparent" src="/assets/gallery/img2.webp"/></div>';
  page = replaceExactly(
    page,
    '</div></div><p class="text-sm text-gray-400 max-w-xs">Veteran owned and active in the American Legion.</p>',
    `</div>${legionImage}</div><p class="text-sm text-gray-400 max-w-xs">Veteran owned and active in the American Legion.</p>`,
    1,
    "American Legion footer badge",
  );

  const cashCheck = '<div class="flex flex-col items-center"><div class="bg-white text-black p-3 rounded-xl mb-2 w-12 h-12 flex items-center justify-center"><span class="font-bold text-sm">$</span></div><span class="text-sm">Cash / Check</span></div>';
  page = replaceExactly(page, "undefined</div>", `${cashCheck}</div>`, 1, "payment footer");

  page = replaceExactly(
    page,
    '<a href="mailto:captainsmokeysbbq@gmail.com" class="text-gray-400 hover:text-white mt-4">captainsmokeysbbq@gmail.com</a>',
    '<a href="mailto:captainsmokeysbbq@gmail.com" class="text-gray-400 hover:text-white mt-4">captainsmokeysbbq@gmail.com</a><a href="tel:+17749923466" class="text-gray-400 hover:text-white">774-992-3466</a>',
    1,
    "public phone number",
  );

  page = replaceExactly(page, ' id="event-name"', ' id="event-name" required=""', 1, "required name");
  page = replaceExactly(page, ' id="event-email"', ' id="event-email" required=""', 1, "required email");
  page = replaceExactly(page, ' id="event-phone"', ' id="event-phone" required=""', 1, "required phone");
  page = replaceExactly(page, ' id="event-people" type="number"', ' id="event-people" type="number" min="10" max="500" required=""', 1, "guest limits");
  page = replaceExactly(page, ' id="event-date"', ' id="event-date" required=""', 1, "required date");
  page = replaceExactly(page, ' id="event-time"', ' id="event-time" required=""', 1, "required time");

  const schedulePicker = `<fieldset class="event-schedule">
    <legend>Event schedule</legend>
    <div class="event-schedule__preview">
      <div class="event-schedule__calendar" aria-hidden="true">
        <span data-schedule-month>Date</span>
        <strong data-schedule-day>--</strong>
      </div>
      <div class="event-schedule__summary">
        <span>When should we fire up the smoker?</span>
        <strong id="schedule-summary">Choose a date and start time</strong>
      </div>
    </div>
    <div class="event-schedule__fields">
      <div class="event-schedule__field">
        <label for="event-date">Date</label>
        <div class="event-schedule__control">
          <input id="event-date" required="" type="date" name="date" autocomplete="off"/>
        </div>
      </div>
      <div class="event-schedule__field">
        <label for="event-time">Start time</label>
        <div class="event-schedule__control">
          <input id="event-time" required="" type="time" name="time" autocomplete="off"/>
        </div>
      </div>
    </div>
  </fieldset>`;
  page = replacePatternExactly(
    page,
    /<div class="w-full"><label for="event-date"[\s\S]*?name="date"\/><\/div><div class="w-full"><label for="event-time"[\s\S]*?name="time"\/><\/div>/g,
    schedulePicker,
    1,
    "combined event schedule",
  );

  page = replaceExactly(
    page,
    '<button aria-label="Toggle Mobile Menu"',
    '<button aria-label="Toggle Mobile Menu" aria-controls="mobile-menu" aria-expanded="false"',
    1,
    "mobile menu button",
  );
  const mobileMenu = '<nav id="mobile-menu" class="site-mobile-menu" hidden><a href="#video">Video</a><a href="/menu/">Menu</a><a href="#gallery">Photos</a><a href="#about">About</a><a href="#book">Book With Smokey Mike</a></nav><noscript><nav class="site-mobile-menu site-mobile-menu--noscript"><a href="#video">Video</a><a href="/menu/">Menu</a><a href="#gallery">Photos</a><a href="#about">About</a><a href="#book">Book With Smokey Mike</a></nav></noscript>';
  page = replaceExactly(page, "</div></header>", `</div>${mobileMenu}</header>`, 1, "mobile navigation");

  const delayedAccessibilityScript = /<script>\s*window\.addEventListener\('load',[\s\S]*?<\/script>/;
  if (!delayedAccessibilityScript.test(page)) {
    throw new Error("legacy delayed accessibility script was not found");
  }
  page = page.replace(delayedAccessibilityScript, "");

  const nextRuntimeScripts = page.match(/<script\b[^>]*src="\/_next\/[^"]+"[^>]*><\/script>/g) || [];
  if (nextRuntimeScripts.length < 5) {
    throw new Error(`Next.js runtime removal: expected at least five scripts, found ${nextRuntimeScripts.length}`);
  }
  page = page.replace(/<script\b[^>]*src="\/_next\/[^"]+"[^>]*><\/script>/g, "");

  const nextScriptPreloads = page.match(/<link(?=[^>]*\brel="preload")(?=[^>]*\bas="script")(?=[^>]*\bhref="\/_next\/)[^>]*>/g) || [];
  if (nextScriptPreloads.length !== 1) {
    throw new Error(`Next.js preload removal: expected one script preload, found ${nextScriptPreloads.length}`);
  }
  page = page.replace(/<link(?=[^>]*\brel="preload")(?=[^>]*\bas="script")(?=[^>]*\bhref="\/_next\/)[^>]*>/g, "");

  const flightScripts = page.match(/<script>[^<]*self\.__next_f[^<]*<\/script>/g) || [];
  if (flightScripts.length < 3) {
    throw new Error(`Next.js flight removal: expected at least three scripts, found ${flightScripts.length}`);
  }
  page = page.replace(/<script>[^<]*self\.__next_f[^<]*<\/script>/g, "");

  writeFileSync(pagePath, page);
}

function patchErrorPage() {
  const pagePath = join(output, "404.html");
  let page = readFileSync(pagePath, "utf8");
  page = page.replace(/<script\b[^>]*src="\/_next\/[^"]+"[^>]*><\/script>/g, "");
  page = page.replace(/<script>[^<]*self\.__next_f[^<]*<\/script>/g, "");
  writeFileSync(pagePath, page);
}

function patchMenuPage() {
  const pagePath = join(output, "menu/index.html");
  let page = readFileSync(pagePath, "utf8");
  page = replaceExactly(page, 'href="/assets/css/menu.css"', `href="${assetUrl("assets/css/menu.css")}"`, 1, "menu stylesheet");
  page = replaceExactly(page, 'href="/PDFs/CateringMenu-2025-Template.pdf"', `href="${assetUrl("PDFs/CateringMenu-2025-Template.pdf")}"`, 2, "menu PDF links");
  writeFileSync(pagePath, page);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const path of [
  "index.html",
  "menu",
  "404.html",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "PDFs",
  "_next/static/chunks/54e00be915a8c017.css",
  "_next/static/chunks/ea4898baeb701027.css",
  "_next/static/media",
  "register",
  "staff",
  "ticket",
  "assets/css",
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
]) {
  copy(path);
}

patchHomepage();
patchMenuPage();
patchErrorPage();

console.log(`Built deployable static site at ${output}`);
