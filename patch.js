const fs = require('fs');

try {
  let html = fs.readFileSync('index.html', 'utf8');

  // 1. Accessibility: Mobile menu button
  html = html.replace('<button class="md:hidden relative z-50 text-primary">', '<button aria-label="Menu" class="md:hidden relative z-50 text-[#ff4040]">');

  // 2. Accessibility: Links (Socials)
  html = html.replace('<a class="hover:text-primary transition-colors" href="https://facebook.com">', '<a aria-label="Facebook" class="hover:text-[#ff4040] transition-colors" href="https://facebook.com">');
  html = html.replace('<a class="hover:text-primary transition-colors" href="https://instagram.com">', '<a aria-label="Instagram" class="hover:text-[#ff4040] transition-colors" href="https://instagram.com">');

  // 3. Accessibility: Form Labels & Inputs
  html = html.replace('name="date"/>', 'name="date" id="event-date"/>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Event Date</label>', '<label for="event-date" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Event Date</label>');

  html = html.replace('name="time"/>', 'name="time" id="event-time"/>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Event Time</label>', '<label for="event-time" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Event Time</label>');

  html = html.replace('name="name"/>', 'name="name" id="guest-name"/>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Name</label>', '<label for="guest-name" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Name</label>');

  html = html.replace('name="email"/>', 'name="email" id="guest-email"/>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Email</label>', '<label for="guest-email" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Email</label>');

  html = html.replace('name="phone"/>', 'name="phone" id="guest-phone"/>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Phone</label>', '<label for="guest-phone" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Phone</label>');

  html = html.replace('name="people"/>', 'name="people" id="guest-count"/>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Guest Count</label>', '<label for="guest-count" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Guest Count</label>');

  html = html.replace('name="message"></textarea>', 'name="message" id="event-message"></textarea>');
  html = html.replace('<label class="block text-sm font-bold uppercase tracking-wide text-primary mb-2">Message / Special Requests</label>', '<label for="event-message" class="block text-sm font-bold uppercase tracking-wide text-[#ff4040] mb-2">Message / Special Requests</label>');

  // 4. Accessibility: Contrast for text-primary on dark backgrounds
  html = html.replace(/text-primary/g, 'text-[#ff4040]');

  // 5. Performance: LCP Image (Hero Background)
  html = html.replace('<img src="/assets/flag_wave.webp" alt="Background" class="w-full h-full object-cover"/>', '<img src="/assets/flag_wave.webp" alt="Background" fetchpriority="high" decoding="sync" class="w-full h-full object-cover"/>');

  // 6. Performance: Priority logo preload
  if (html.includes('<link rel="preload" as="image" href="/assets/logo.webp"/>')) {
    html = html.replace('<link rel="preload" as="image" href="/assets/logo.webp"/>', '<link rel="preload" as="image" href="/assets/logo.webp" fetchpriority="high"/>');
  }
  if (html.includes('<link rel="preload" href="/assets/flag_wave.webp" as="image"/>')) {
    html = html.replace('<link rel="preload" href="/assets/flag_wave.webp" as="image"/>', '<link rel="preload" href="/assets/flag_wave.webp" as="image" fetchpriority="high"/>');
  }

  fs.writeFileSync('index.html', html);
  console.log('index.html patched!');
} catch (error) {
  console.error(error);
}
