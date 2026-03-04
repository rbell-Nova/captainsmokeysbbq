const fs = require('fs');
const path = require('path');

let html = fs.readFileSync('index.html', 'utf8');

// ── 1. Remove ALL mentions of "pit-smoked" (case-insensitive) ──────────────
// Replace with "slow-smoked" which is accurate and equally punchy
html = html.replace(/pit-smoked/gi, 'slow-smoked');
html = html.replace(/Pit-Smoked/g, 'Slow-Smoked');
html = html.replace(/Pit Smoked/gi, 'Slow Smoked');

// Also fix the meta description and keywords
html = html.replace(/pit-smoked/gi, 'slow-smoked');

// ── 2. Update Gallery heading from "Photo Gallery (8)" to on-brand copy ──────
// The gallery section has a h2 with text: Photo Gallery (<!-- -->8<!-- -->)
html = html.replace(
  /Photo Gallery \(<\!-- --\>\d+<\!-- --\>\)/g,
  'From the Smoker to Your Table'
);
// Also handle any h2 variant without the Next.js comment artifacts
html = html.replace(
  />Photo Gallery \(\d+\)</g,
  '>From the Smoker to Your Table'
);

// ── 3. Remove the American Legion photo card from the gallery grid ──────────
// The img2.webp card is the American Legion photo
// It appears in the main gallery grid:
html = html.replace(
  /<div class="h-64 relative rounded-xl overflow-hidden shadow-lg border-2 border-transparent hover:border-primary transition-all duration-300"><img loading="lazy" decoding="async" src="\/assets\/gallery\/img2\.webp" alt="American Legion Member" class="w-full h-full object-cover hover:scale-110 transition-transform duration-700"\/><\/div>/g,
  ''
);

fs.writeFileSync('index.html', html);
console.log('Copy and gallery patched!');

// ── 4. Patch hydrated Next.js bundle so client-side render matches the export ─
// The page is hydrated from a compiled chunk, which can override `index.html`.
// Patch only the gallery chunk so the footer American Legion badge remains.
const chunksDir = path.join('_next', 'static', 'chunks');
let bundlePatched = false;

if (fs.existsSync(chunksDir)) {
  for (const file of fs.readdirSync(chunksDir)) {
    if (!file.endsWith('.js')) continue;
    const chunkPath = path.join(chunksDir, file);
    let js = fs.readFileSync(chunkPath, 'utf8');
    const originalJs = js;

    if (js.includes('children:["Photo Gallery (",i.length,")"]') && js.includes('/assets/gallery/img2.webp')) {
      js = js.replace(
        'children:["Photo Gallery (",i.length,")"]',
        'children:"From the Smoker to Your Table"'
      );

      js = js.replace(
        '{id:3,src:"/assets/gallery/img2.webp",alt:"American Legion Member"},',
        ''
      );

      if (js !== originalJs) {
        fs.writeFileSync(chunkPath, js);
        bundlePatched = true;
        console.log(`Hydration bundle patched: ${chunkPath}`);
      }
    }
  }
}

// Quick verification search
const count = (html.match(/pit-smoked/gi) || []).length;
console.log('Remaining "pit-smoked" mentions:', count);
const hasLegion = html.includes('img2.webp');
console.log('img2.webp (American Legion) still present:', hasLegion);
console.log('Hydration gallery bundle patched:', bundlePatched);
