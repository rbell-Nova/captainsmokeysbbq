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

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, process.env.OUTPUT_DIRECTORY || "dist");

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

function patchHomepage() {
  const pagePath = join(output, "index.html");
  let page = readFileSync(pagePath, "utf8");

  page = replaceExactly(
    page,
    "</head>",
    '<link rel="stylesheet" href="/assets/css/reliability.css"/><script src="/assets/site-reliability.js" defer></script></head>',
    1,
    "reliability assets",
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
    '<video preload="none" data-src="$1" muted="" playsInline="" loop="" controls="" class=',
  );
  if ((page.match(/<video preload="none" data-src=/g) || []).length !== 3) {
    throw new Error("video loading: expected three lazy video elements");
  }

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

  page = replaceExactly(
    page,
    '<button aria-label="Toggle Mobile Menu"',
    '<button aria-label="Toggle Mobile Menu" aria-controls="mobile-menu" aria-expanded="false"',
    1,
    "mobile menu button",
  );
  const mobileMenu = '<nav id="mobile-menu" class="site-mobile-menu" hidden><a href="#video">Video</a><a href="#menu">Menu</a><a href="#gallery">Photos</a><a href="#about">About</a><a href="#book">Book With Smokey Mike</a></nav><noscript><nav class="site-mobile-menu site-mobile-menu--noscript"><a href="#video">Video</a><a href="#menu">Menu</a><a href="#gallery">Photos</a><a href="#about">About</a><a href="#book">Book With Smokey Mike</a></nav></noscript>';
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

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const path of [
  "index.html",
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
patchErrorPage();

console.log(`Built deployable static site at ${output}`);
