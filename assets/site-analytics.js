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

  const ctaLocations = new Set([
    "header", "mobile_menu", "hero", "menu_section", "menu_hero",
    "menu_planning", "menu_footer", "contact",
  ]);
  const errorCategories = new Set(["network", "service"]);

  document.addEventListener("bookingaccepted", () => gtag("event", "generate_lead"));
  document.addEventListener("bookingerror", (event) => {
    const category = event.detail?.category;
    if (errorCategories.has(category)) {
      gtag("event", "booking_form_error", { error_category: category });
    }
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const url = new URL(link.href);
    const placement = link.dataset?.analyticsLocation;
    const parameters = { cta_location: ctaLocations.has(placement) ? placement : "other" };
    if (url.protocol === "tel:") gtag("event", "click_to_call", parameters);
    else if (url.protocol === "mailto:") gtag("event", "click_to_email", parameters);
    else if (url.origin === location.origin) {
      if (url.pathname === "/" && url.hash === "#book") gtag("event", "booking_cta_click", parameters);
      if (url.pathname === "/menu" || url.pathname === "/menu/") gtag("event", "menu_cta_click", parameters);
      if (url.pathname === "/PDFs/CateringMenu-2025-Template.pdf") gtag("event", "menu_pdf_click", parameters);
    }
  }, { capture: true });

  function observeBookingForm() {
    const form = document.querySelector("#book form");
    if (!form || !("IntersectionObserver" in window)) return;
    let inView = false;
    let reported = false;
    let timer;

    function updateVisibility() {
      clearTimeout(timer);
      if (reported || !inView || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (reported || !inView || document.visibilityState !== "visible") return;
        reported = true;
        gtag("event", "booking_form_view");
        observer.disconnect();
        document.removeEventListener("visibilitychange", updateVisibility);
      }, 1000);
    }

    const observer = new window.IntersectionObserver((entries) => {
      const entry = entries.filter((item) => item.target === form).at(-1);
      if (!entry) return;
      inView = entry.isIntersecting && entry.intersectionRatio >= 0.15;
      updateVisibility();
    }, { threshold: [0, 0.15] });
    observer.observe(form);
    document.addEventListener("visibilitychange", updateVisibility);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeBookingForm, { once: true });
  } else {
    observeBookingForm();
  }
})();
