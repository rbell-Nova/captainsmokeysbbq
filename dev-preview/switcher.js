/**
 * Floating switcher for testing the two halves of the event-ticketing
 * flow against each other (staff scanner <-> guest ticket QR) without
 * typing URLs by hand. Dev/testing aid only — see switcher.css header.
 */
(function () {
  "use strict";

  const PAGES = [
    { href: "/staff/check-in/", label: "Staff Check-In", hint: "Scanner, directory, and \"+ Register a Guest\"" },
    { href: "/register/", label: "Public Registration", hint: "The link guests self-serve from" },
    { href: "/ticket/demo/", label: "Guest Ticket (Demo)", hint: "Reopening a saved ticket link" },
  ];

  function currentPath() {
    return window.location.pathname.replace(/\/index\.html$/, "/");
  }

  function build() {
    const root = document.createElement("div");
    root.className = "dev-switcher";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "dev-switcher__toggle";
    toggle.textContent = "🔧 Test: Switch Page";
    root.appendChild(toggle);

    const menu = document.createElement("div");
    menu.className = "dev-switcher__menu hidden";

    const label = document.createElement("div");
    label.className = "dev-switcher__label";
    label.textContent = "Preview only — not live";
    menu.appendChild(label);

    PAGES.forEach((page) => {
      const link = document.createElement("a");
      link.className = "dev-switcher__link";
      if (currentPath().startsWith(page.href)) link.classList.add("is-current");
      link.href = page.href;
      link.innerHTML = `${page.label}<small>${page.hint}</small>`;
      menu.appendChild(link);
    });

    root.appendChild(menu);
    document.body.appendChild(root);

    toggle.addEventListener("click", () => menu.classList.toggle("hidden"));
    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) menu.classList.add("hidden");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
