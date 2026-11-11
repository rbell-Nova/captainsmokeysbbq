(() => {
  "use strict";

  if (!["captainsmokeysbbq.com", "www.captainsmokeysbbq.com"].includes(location.hostname)) return;

  const measurementId = "G-55F7S5SYXY";
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag("js", new Date());
  gtag("config", measurementId);
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
  document.head.append(tag);

  document.addEventListener("bookingaccepted", () => gtag("event", "generate_lead"));
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const url = new URL(link.href);
    if (url.protocol === "tel:") gtag("event", "click_to_call");
    else if (url.protocol === "mailto:") gtag("event", "click_to_email");
    else if (url.origin === location.origin) {
      if (url.pathname === "/" && url.hash === "#book") gtag("event", "booking_cta_click");
      if (url.pathname === "/PDFs/CateringMenu-2025-Template.pdf") gtag("event", "menu_pdf_click");
    }
  }, { capture: true });
})();
