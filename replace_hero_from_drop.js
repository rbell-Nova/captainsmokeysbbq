const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = __dirname;
const heroDir = path.join(root, 'assets', 'hero');
const sourcePath = path.join(heroDir, 'hero-backdrop-source.png');
const heroDesktop = path.join(root, 'assets', 'flag_wave.webp');
const heroMobile = path.join(root, 'assets', 'flag_wave_mobile.webp');

function findDroppedHeroImage() {
  const candidates = fs
    .readdirSync(root)
    .filter((name) => /\.(png|jpe?g|webp|heic)$/i.test(name))
    .filter((name) => name !== '.DS_Store')
    .map((name) => ({
      name,
      fullPath: path.join(root, name),
      stat: fs.statSync(path.join(root, name)),
    }))
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return candidates[0] || null;
}

async function main() {
  fs.mkdirSync(heroDir, { recursive: true });

  const dropped = findDroppedHeroImage();

  if (dropped) {
    fs.renameSync(dropped.fullPath, sourcePath);
    console.log(`Moved ${dropped.name} to ${path.relative(root, sourcePath)}`);
  } else if (fs.existsSync(sourcePath)) {
    console.log(`Using existing source ${path.relative(root, sourcePath)}`);
  } else {
    throw new Error(`Could not find a dropped image in the site root or ${path.relative(root, sourcePath)}.`);
  }

  const image = sharp(sourcePath);
  const meta = await image.metadata();
  console.log(`Source dimensions: ${meta.width}x${meta.height}`);

  await sharp(sourcePath)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 78, effort: 6 })
    .toFile(heroDesktop);

  await sharp(sourcePath)
    .resize({ width: 600, withoutEnlargement: true })
    .webp({ quality: 72, effort: 6 })
    .toFile(heroMobile);

  console.log(`Updated ${path.relative(root, heroDesktop)}`);
  console.log(`Updated ${path.relative(root, heroMobile)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
