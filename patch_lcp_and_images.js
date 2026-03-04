const fs = require('fs');
const sharp = require('sharp');
const path = require('path');

async function optimize() {
    console.log('Resizing flag_wave.webp for mobile...');
    await sharp('assets/flag_wave.webp')
        .resize({ width: 600 })
        .webp({ quality: 75, effort: 6 })
        .toFile('assets/flag_wave_mobile.webp');
    console.log('Mobile LCP asset created.');

    let html = fs.readFileSync('index.html', 'utf8');

    // 1. Remove exactly the preloaded gallery images in the head
    html = html.replace(/<link rel="preload" as="image" href="\/assets\/gallery\/img\d\.webp"\/>/g, '');

    // 2. Upgrade LCP image to responsive srcset and use asynchronous decoding
    const lcpOld = `<img src="/assets/flag_wave.webp" alt="Background" fetchpriority="high" decoding="sync" class="w-full h-full object-cover"/>`;
    const lcpNew = `<img src="/assets/flag_wave.webp" srcset="/assets/flag_wave_mobile.webp 600w, /assets/flag_wave.webp 1200w" sizes="100vw" alt="Background" fetchpriority="high" decoding="async" class="w-full h-full object-cover"/>`;
    html = html.replace(lcpOld, lcpNew);
    
    // 3. Fix the <link preload> the head to use the new responsive imagesrcset
    const preloadOld = `<link rel="preload" href="/assets/flag_wave.webp" as="image" fetchpriority="high"/>`;
    const preloadNew = `<link rel="preload" as="image" fetchpriority="high" imagesrcset="/assets/flag_wave_mobile.webp 600w, /assets/flag_wave.webp 1200w" imagesizes="100vw"/>`;
    html = html.replace(preloadOld, preloadNew);

    // 4. Ensure below-the-fold gallery images are securely lazy-loaded
    html = html.replace(/<img src="\/assets\/gallery\/img(\d)\.webp"/g, '<img loading="lazy" decoding="async" src="/assets/gallery/img$1.webp"');

    // 5. Tell browser not to aggressively preload the videos! Videos usually destroy mobile bandwidth on initial render
    html = html.replace(/<video src="\/assets\/videos\/(.*?)\.mp4"/g, '<video preload="none" src="/assets/videos/$1.mp4"');

    fs.writeFileSync('index.html', html);
    console.log('LCP HTML patching complete!');
}

optimize().catch(console.error);
