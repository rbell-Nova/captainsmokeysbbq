const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Require sharp (assuming we will npm install it first)
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.log("Installing sharp...");
  execSync('npm install sharp --no-save', { stdio: 'inherit' });
  sharp = require('sharp');
}

const BASE_DIR = __dirname;
const ASSETS_DIR = path.join(BASE_DIR, 'assets');
const HTML_FILE = path.join(BASE_DIR, 'index.html');
const JS_CHUNKS_DIR = path.join(BASE_DIR, '_next', 'static', 'chunks');

// Max widths for responsive sizes
const MAX_WIDTH = 1200;

async function processImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png'].includes(ext)) {
    // Determine new filename
    const newFileName = path.basename(filePath, ext) + '.webp';
    const newFilePath = path.join(path.dirname(filePath), newFileName);
    
    // We will resize down large images but preserve aspect ratio, 
    // and convert to WebP with aggressive optimization.
    try {
      console.log(`Optimizing ${filePath}...`);
      await sharp(filePath)
        .resize(MAX_WIDTH, null, { withoutEnlargement: true })
        .webp({ quality: 75, effort: 6 })
        .toFile(newFilePath);
        
      console.log(`Created ${newFilePath}`);
      return { 
        oldPath: path.relative(BASE_DIR, filePath).replace(/\\/g, '/'), 
        newPath: path.relative(BASE_DIR, newFilePath).replace(/\\/g, '/') 
      };
    } catch (err) {
      console.error(`Error processing ${filePath}:`, err);
    }
  }
  return null;
}

async function findImages(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(await findImages(filePath));
    } else {
      results.push(filePath);
    }
  }
  return results;
}

async function updateReferences(mappings) {
  // Update index.html
  if (fs.existsSync(HTML_FILE)) {
    let htmlContent = fs.readFileSync(HTML_FILE, 'utf8');
    let replaced = false;
    for (const mapping of mappings) {
      const regex = new RegExp('/' + mapping.oldPath.replace(/\./g, '\\.'), 'g');
      if (regex.test(htmlContent)) {
        htmlContent = htmlContent.replace(regex, '/' + mapping.newPath);
        replaced = true;
      }
    }
    if (replaced) {
      fs.writeFileSync(HTML_FILE, htmlContent);
      console.log(`Updated references in ${HTML_FILE}`);
    }
  }
  
  // Update JS chunks
  if (fs.existsSync(JS_CHUNKS_DIR)) {
    const chunks = fs.readdirSync(JS_CHUNKS_DIR);
    for (const chunk of chunks) {
      const chunkPath = path.join(JS_CHUNKS_DIR, chunk);
      if (chunk.endsWith('.js') && fs.statSync(chunkPath).isFile()) {
        let jsContent = fs.readFileSync(chunkPath, 'utf8');
        let replaced = false;
        for (const mapping of mappings) {
          const regex = new RegExp('/' + mapping.oldPath.replace(/\./g, '\\.'), 'g');
          if (regex.test(jsContent)) {
            jsContent = jsContent.replace(regex, '/' + mapping.newPath);
            replaced = true;
          }
        }
        if (replaced) {
          fs.writeFileSync(chunkPath, jsContent);
          console.log(`Updated references in ${chunkPath}`);
        }
      }
    }
  }
}

async function main() {
  console.log("Finding images...");
  const images = await findImages(ASSETS_DIR);
  const mappings = [];
  
  for (const img of images) {
    const mapping = await processImage(img);
    if (mapping) {
      mappings.push(mapping);
    }
  }
  
  console.log("Updating HTML/JS references...");
  await updateReferences(mappings);
  
  console.log("Images optimized and references updated successfully.");
}

main().catch(console.error);
