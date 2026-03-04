const fs = require('fs');

try {
  let html = fs.readFileSync('original_index.html', 'utf8');

  // Replace .png and .jpg paths with .webp across the entire file
  html = html.replace(/\/assets\/(.*?)\.(png|jpg|jpeg)/gi, '/assets/$1.webp');

  // Inject a style block right before </head> to override aesthetics without touching classes!
  const styleBlock = `
<style id="aesthetic-fixes">
  /* Fix Navigation Header Overlap (Make it solid immediately) */
  header { background-color: rgb(24 24 27) !important; }
  
  /* Fix Hero Clipping (push content down so it doesn't overlap the header) */
  main > section:first-of-type { padding-top: 5rem !important; }
  main > section:first-of-type h1 { margin-top: 2rem !important; }
  
  /* Additional Contrast Support */
  .text-primary { color: #ff4040 !important; }
</style>
`;
  html = html.replace('</head>', styleBlock + '</head>');

  // Add fetchpriority to hero background image
  html = html.replace('<link rel="preload" href="/assets/flag_wave.webp" as="image"/>', '<link rel="preload" href="/assets/flag_wave.webp" as="image" fetchpriority="high"/>');
  html = html.replace('<img src="/assets/flag_wave.webp" alt="Background" class="w-full h-full object-cover"/>', '<img src="/assets/flag_wave.webp" alt="Background" fetchpriority="high" decoding="sync" class="w-full h-full object-cover"/>');

  // Inject a small vanilla JS script at the end of <body> to apply accessibility labels AFTER hydration
  const a11yScript = `
<script>
  window.addEventListener('load', () => {
    setTimeout(() => {
      try {
        const menuBtn = document.querySelector('button.md\\\\:hidden');
        if (menuBtn) { menuBtn.setAttribute('aria-label', 'Menu'); menuBtn.style.color = '#ff4040'; }
        
        document.querySelectorAll('a[href*="facebook"]').forEach(el => el.setAttribute('aria-label', 'Facebook'));
        document.querySelectorAll('a[href*="instagram"]').forEach(el => el.setAttribute('aria-label', 'Instagram'));
        
        const inputs = ['date', 'time', 'name', 'email', 'phone', 'people', 'message'];
        inputs.forEach(name => {
          const el = document.querySelector('[name="' + name + '"]');
          if (el) {
            el.id = 'event-' + name;
            if (el.previousElementSibling && el.previousElementSibling.tagName === 'LABEL') {
              el.previousElementSibling.setAttribute('for', 'event-' + name);
              el.previousElementSibling.style.color = '#ff4040';
            }
          }
        });
      } catch (e) {
        console.error('A11y script error', e);
      }
    }, 500); 
  });
</script>
`;
  html = html.replace('</body>', a11yScript + '</body>');

  fs.writeFileSync('index.html', html);
  console.log('Fixed index.html safely!');
} catch (e) {
  console.error(e);
}
