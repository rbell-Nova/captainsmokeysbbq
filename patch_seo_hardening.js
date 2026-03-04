const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const siteUrl = 'https://captainsmokeysbbq.com/';
const ogImage =
  'https://captainsmokeysbbq.com/images/Smokey%20Mike%20smiling%20next%20to%20the%20smoker.jpg';

function writeIfChanged(filePath, content) {
  const prev = fs.readFileSync(filePath, 'utf8');
  if (prev !== content) {
    fs.writeFileSync(filePath, content);
    return true;
  }
  return false;
}

function patchIndexHtml() {
  const filePath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  const original = html;

  if (!html.includes('rel="canonical"')) {
    html = html.replace(
      '<meta name="theme-color" content="#000000"/>',
      '<meta name="theme-color" content="#000000"/><link rel="canonical" href="https://captainsmokeysbbq.com/"/><meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"/>'
    );
  }

  if (!html.includes('property="og:image:alt"')) {
    html = html.replace(
      '<meta property="og:image:height" content="630"/>',
      '<meta property="og:image:height" content="630"/><meta property="og:image:alt" content="Captain Smokey Mike smiling beside the smoker"/>'
    );
  }

  if (!html.includes('name="twitter:image:alt"')) {
    html = html.replace(
      '<meta name="twitter:image:height" content="630"/>',
      '<meta name="twitter:image:height" content="630"/><meta name="twitter:image:alt" content="Captain Smokey Mike smiling beside the smoker"/>'
    );
  }

  if (!html.includes('application/ld+json')) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'Caterer',
      name: "Captain Smokey's BBQ",
      url: siteUrl,
      image: ogImage,
      description:
        'Authentic slow-smoked BBQ catering with brisket, ribs, pulled pork, chicken, and classic sides.',
      servesCuisine: 'Barbecue',
    };

    html = html.replace(
      '</head>',
      `<script type="application/ld+json">${JSON.stringify(schema)}</script></head>`
    );
  }

  if (html !== original) {
    fs.writeFileSync(filePath, html);
    return true;
  }
  return false;
}

function patchRobotsTxt() {
  const filePath = path.join(ROOT, 'robots.txt');

  const normalized = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /private/',
    '',
    `Sitemap: ${siteUrl}sitemap.xml`,
    `Host: ${siteUrl.replace(/\/$/, '')}`,
    '',
  ].join('\n');

  return writeIfChanged(filePath, normalized);
}

function patchSitemap() {
  const filePath = path.join(ROOT, 'sitemap.xml');
  const indexStat = fs.statSync(path.join(ROOT, 'index.html'));
  const lastmod = indexStat.mtime.toISOString();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `<url>\n` +
    `<loc>${siteUrl}</loc>\n` +
    `<lastmod>${lastmod}</lastmod>\n` +
    `<changefreq>weekly</changefreq>\n` +
    `<priority>1.0</priority>\n` +
    `</url>\n` +
    `</urlset>\n`;

  return writeIfChanged(filePath, xml);
}

function patchNoindex404(fileRelativePath) {
  const filePath = path.join(ROOT, fileRelativePath);
  if (!fs.existsSync(filePath)) return false;

  let html = fs.readFileSync(filePath, 'utf8');
  const original = html;

  if (!html.includes('name="robots"') && html.includes('</head>')) {
    html = html.replace(
      '</head>',
      '<meta name="robots" content="noindex, nofollow"/></head>'
    );
  }

  if (html !== original) {
    fs.writeFileSync(filePath, html);
    return true;
  }
  return false;
}

function main() {
  const results = {
    index: patchIndexHtml(),
    robots: patchRobotsTxt(),
    sitemap: patchSitemap(),
    notFoundRoot: patchNoindex404('404.html'),
    notFoundFolder: patchNoindex404(path.join('404', 'index.html')),
    notFoundNext: patchNoindex404(path.join('_not-found', 'index.html')),
  };

  console.log('SEO hardening patch complete.');
  for (const [key, changed] of Object.entries(results)) {
    console.log(`${key}: ${changed ? 'updated' : 'unchanged'}`);
  }
}

main();
