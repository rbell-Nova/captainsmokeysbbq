(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const formEndpoint = "https://formspree.io/f/xkovnkog";

  function ensureBookingStatus() {
    const form = document.querySelector('#book form[action="' + formEndpoint + '"]');
    if (!form) return null;
    let status = document.getElementById("booking-status");
    if (!status) {
      status = document.createElement("div");
      status.id = "booking-status";
      status.className = "booking-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.hidden = true;
      form.insertAdjacentElement("afterend", status);
    }
    return status;
  }

  function updateBookingStatus(state) {
    const status = ensureBookingStatus();
    if (!status) return;
    status.hidden = false;
    status.dataset.state = state;
    if (state === "sending") {
      status.textContent = "Sending your request…";
    } else if (state === "success") {
      status.textContent = "Message sent! The Captain has received your request and will be in touch shortly.";
    } else {
      status.textContent = "We couldn’t send your request. Your entries are still here—please try again, email captainsmokeysbbq@gmail.com, or call 774-992-3466.";
    }
  }

  function configureForm() {
    const form = document.querySelector("#book form");
    if (!form) return;
    form.action = formEndpoint;
    form.method = "POST";
    const date = form.querySelector('input[name="date"]');
    if (date) date.min = new Date().toISOString().slice(0, 10);
    const button = form.querySelector('button[type="submit"]');
    ensureBookingStatus();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      if (new Date(values.date) <= new Date()) {
        date?.setCustomValidity("Choose a future date.");
        date?.reportValidity();
        date?.addEventListener("input", () => date.setCustomValidity(""), { once: true });
        return;
      }
      if (button) button.disabled = true;
      updateBookingStatus("sending");
      try {
        const response = await fetch(formEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(values),
        });
        if (!response.ok) throw new Error("Booking request was not accepted");
        form.reset();
        updateBookingStatus("success");
      } catch (error) {
        console.error("Booking request failed", error);
        updateBookingStatus("error");
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  function loadVideo(video, manual = false) {
    if (!video.src && video.dataset.src) {
      video.src = video.dataset.src;
      video.load();
    }
    if ((manual || !reducedMotion.matches) && video.paused) {
      video.play().catch(() => {});
    }
  }

  function configureVideos() {
    const section = document.getElementById("video");
    if (!section) return;
    const videos = [...section.querySelectorAll("video")];
    videos.forEach((video) => {
      video.controls = true;
      video.addEventListener("pointerdown", () => loadVideo(video, true));
      video.addEventListener("keydown", () => loadVideo(video, true));
      video.addEventListener("error", () => {
        video.pause();
        if (video.parentElement?.querySelector(".media-fallback")) return;
        const message = document.createElement("p");
        message.className = "media-fallback";
        message.setAttribute("role", "status");
        message.textContent = "Video unavailable. The rest of the page and booking form are still available.";
        video.parentElement?.append(message);
      });
    });

    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadVideo(videos[0]);
      else videos.forEach((video) => video.pause());
    }, { threshold: 0.35 });
    observer.observe(section);
  }

  function configureCarousel(sectionSelector) {
    const section = document.querySelector(sectionSelector);
    const carousel = section?.querySelector(".swiper");
    const track = carousel?.querySelector(".swiper-wrapper");
    const slides = track ? [...track.children] : [];
    if (!carousel || !track || slides.length === 0) return;
    carousel.dataset.enhanced = "true";
    track.setAttribute("tabindex", "0");
    track.setAttribute("aria-label", sectionSelector === "#video" ? "BBQ videos" : "Menu highlights");

    const previous = carousel.querySelector(".swiper-button-prev");
    const next = carousel.querySelector(".swiper-button-next");
    const pagination = carousel.querySelector(".swiper-pagination");
    for (const [button, label, direction] of [[previous, "Previous slide", -1], [next, "Next slide", 1]]) {
      if (!button) continue;
      button.setAttribute("role", "button");
      button.setAttribute("tabindex", "0");
      button.setAttribute("aria-label", label);
      const move = () => track.scrollBy({ left: direction * slides[0].getBoundingClientRect().width, behavior: reducedMotion.matches ? "auto" : "smooth" });
      button.addEventListener("click", move);
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") move();
      });
    }

    if (pagination) {
      pagination.replaceChildren(...slides.map((slide, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "site-carousel-dot";
        dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
        dot.addEventListener("click", () => track.scrollTo({ left: slide.offsetLeft, behavior: reducedMotion.matches ? "auto" : "smooth" }));
        return dot;
      }));
    }
  }

  function configureMobileMenu() {
    const button = document.querySelector('button[aria-controls="mobile-menu"]');
    const menu = document.getElementById("mobile-menu");
    if (!button || !menu) return;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      menu.hidden = !open;
    });
    menu.addEventListener("click", (event) => {
      if (event.target instanceof HTMLAnchorElement) {
        button.setAttribute("aria-expanded", "false");
        menu.hidden = true;
      }
    });
  }

  document.addEventListener("play", (event) => {
    const video = event.target;
    if (video instanceof HTMLVideoElement && reducedMotion.matches && !video.matches(":focus")) video.pause();
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    configureMobileMenu();
    configureCarousel("#video");
    configureCarousel("#menu");
    configureVideos();
    configureForm();
  }, { once: true });
})();
