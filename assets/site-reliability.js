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
    configureSchedulePreview(form);

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

  function configureSchedulePreview(form) {
    const date = form.querySelector('input[name="date"]');
    const time = form.querySelector('input[name="time"]');
    const month = form.querySelector("[data-schedule-month]");
    const day = form.querySelector("[data-schedule-day]");
    const summary = form.querySelector("#schedule-summary");
    if (!date || !time || !month || !day || !summary) return;

    const update = () => {
      let chosenDate;
      if (date.value) {
        const [year, monthIndex, dayOfMonth] = date.value.split("-").map(Number);
        chosenDate = new Date(year, monthIndex - 1, dayOfMonth);
        month.textContent = chosenDate.toLocaleDateString(undefined, { month: "short" });
        day.textContent = String(dayOfMonth);
      } else {
        month.textContent = "Date";
        day.textContent = "--";
      }

      const dateText = chosenDate
        ? chosenDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
        : "Choose a date";
      let timeText = "start time";
      if (time.value) {
        const [hours, minutes] = time.value.split(":").map(Number);
        const clock = new Date(2000, 0, 1, hours, minutes);
        timeText = clock.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      }
      summary.textContent = `${dateText} · ${timeText}`;
    };

    date.addEventListener("input", update);
    date.addEventListener("change", update);
    time.addEventListener("input", update);
    time.addEventListener("change", update);
    form.addEventListener("reset", () => requestAnimationFrame(update));
    update();
  }

  function loadVideo(video) {
    if (!video.src && video.dataset.src) {
      video.src = video.dataset.src;
      video.load();
    }
    if (video.paused) {
      video.play().catch(() => {});
    }
  }

  function prepareVideo(video) {
    video.controls = false;
    video.removeAttribute("controls");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.disablePictureInPicture = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("controlslist", "nodownload noplaybackrate nofullscreen noremoteplayback");
    video.setAttribute("disablepictureinpicture", "");
    video.setAttribute("disableremoteplayback", "");
  }

  function configureVideos() {
    const section = document.getElementById("video");
    if (!section) return;
    const videos = [...section.querySelectorAll("video")];
    if (videos.length === 0) return;
    let activeIndex = 0;
    let sectionVisible = false;

    const playActiveVideo = () => {
      videos.forEach((video, index) => {
        if (index === activeIndex && sectionVisible) loadVideo(video);
        else video.pause();
      });
    };

    videos.forEach((video) => {
      prepareVideo(video);
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

    section.addEventListener("carouselchange", (event) => {
      if (!Number.isInteger(event.detail?.index)) return;
      activeIndex = event.detail.index;
      playActiveVideo();
    });

    if (!("IntersectionObserver" in window)) {
      sectionVisible = true;
      playActiveVideo();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      sectionVisible = entries.some((entry) => entry.isIntersecting);
      playActiveVideo();
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
    const isVideoCarousel = sectionSelector === "#video";
    let activeIndex = 0;

    const nearestIndex = () => slides.reduce((nearest, slide, index) => {
      const nearestDistance = Math.abs(slides[nearest].offsetLeft - track.scrollLeft);
      const candidateDistance = Math.abs(slide.offsetLeft - track.scrollLeft);
      return candidateDistance < nearestDistance ? index : nearest;
    }, 0);

    const announceActiveSlide = () => {
      slides.forEach((slide, index) => slide.setAttribute("aria-hidden", String(index !== activeIndex)));
      pagination?.querySelectorAll(".site-carousel-dot").forEach((dot, index) => {
        dot.setAttribute("aria-current", index === activeIndex ? "true" : "false");
      });
      section.dispatchEvent(new CustomEvent("carouselchange", { detail: { index: activeIndex } }));
    };

    const moveTo = (index) => {
      activeIndex = (index + slides.length) % slides.length;
      track.scrollTo({ left: slides[activeIndex].offsetLeft, behavior: reducedMotion.matches ? "auto" : "smooth" });
      announceActiveSlide();
    };

    const previous = carousel.querySelector(".swiper-button-prev");
    const next = carousel.querySelector(".swiper-button-next");
    const pagination = carousel.querySelector(".swiper-pagination");
    for (const [button, label, direction] of [[previous, "Previous slide", -1], [next, "Next slide", 1]]) {
      if (!button) continue;
      button.setAttribute("aria-label", label);
      if (isVideoCarousel) {
        button.classList.add("site-carousel-arrow");
        const glyph = document.createElement("span");
        glyph.className = "site-carousel-arrow__glyph";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = direction < 0 ? "\u2039" : "\u203a";
        button.replaceChildren(glyph);
      }
      const move = () => moveTo(activeIndex + direction);
      button.addEventListener("click", move);
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          move();
        }
      });
    }

    if (pagination) {
      pagination.replaceChildren(...slides.map((slide, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "site-carousel-dot";
        dot.setAttribute("aria-label", `Go to slide ${index + 1}`);
        dot.addEventListener("click", () => moveTo(index));
        return dot;
      }));
    }

    let scrollFrame = 0;
    track.addEventListener("scroll", () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const nextIndex = nearestIndex();
        if (nextIndex === activeIndex) return;
        activeIndex = nextIndex;
        announceActiveSlide();
      });
    }, { passive: true });

    let pointerId;
    let pointerStart = 0;
    let scrollStart = 0;
    let dragging = false;
    track.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointerId = event.pointerId;
      pointerStart = event.clientX;
      scrollStart = track.scrollLeft;
      dragging = false;
      track.setPointerCapture?.(pointerId);
      track.classList.add("is-dragging");
    });
    track.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointerId) return;
      const distance = event.clientX - pointerStart;
      if (Math.abs(distance) > 6) dragging = true;
      if (!dragging) return;
      track.scrollLeft = scrollStart - distance;
      event.preventDefault();
    });
    const finishDrag = (event) => {
      if (event.pointerId !== pointerId) return;
      track.releasePointerCapture?.(pointerId);
      track.classList.remove("is-dragging");
      pointerId = undefined;
      if (dragging) moveTo(nearestIndex());
      dragging = false;
    };
    track.addEventListener("pointerup", finishDrag);
    track.addEventListener("pointercancel", finishDrag);
    announceActiveSlide();
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

  function configureAboutMotion() {
    const targets = [...document.querySelectorAll("#about [data-reveal]")];
    if (reducedMotion.matches || !("IntersectionObserver" in window) || targets.length === 0) return;
    const animations = new Set();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target;
        observer.unobserve(element);
        if (reducedMotion.matches || typeof element.animate !== "function") continue;

        // Content is visible in the source. Motion is an optional enhancement,
        // so it remains readable without JavaScript or when motion is reduced.
        const initialTransform = element.dataset.reveal === "left"
          ? "translateX(-50px)"
          : "translateX(50px)";
        const animation = element.animate([
          { opacity: 0, transform: initialTransform },
          { opacity: 1, transform: "translateX(0)" },
        ], { duration: 800, easing: "ease-out" });
        animations.add(animation);
        animation.onfinish = animation.oncancel = () => animations.delete(animation);
      }
    });
    targets.forEach((element) => observer.observe(element));
    reducedMotion.addEventListener("change", () => {
      if (!reducedMotion.matches) return;
      observer.disconnect();
      for (const animation of animations) animation.cancel();
      animations.clear();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    configureMobileMenu();
    configureCarousel("#video");
    configureCarousel("#menu");
    configureVideos();
    configureForm();
    configureAboutMotion();
  }, { once: true });
})();
