import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../assets/site-reliability.js", import.meta.url), "utf8");

class Element {
  children = [];
  dataset = {};
  attributes = new Map();
  listeners = new Map();
  selectors = new Map();
  classes = new Set();
  classList = {
    add: (...names) => names.forEach((name) => this.classes.add(name)),
    remove: (...names) => names.forEach((name) => this.classes.delete(name)),
    contains: (name) => this.classes.has(name),
  };
  scrollLeft = 0;

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    if (event.bubbles) this.parentElement?.dispatchEvent(event);
  }
  emit(type, values = {}) {
    this.dispatchEvent({ type, bubbles: true, preventDefault() {}, ...values });
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) { return this.selectors.get(selector) || null; }
  querySelectorAll(selector) {
    if (selector === ".site-carousel-dot") return this.children;
    return this.selectors.get(selector) || [];
  }
  replaceChildren(...children) {
    this.children = children;
    children.forEach((child) => { child.parentElement = this; });
  }
  scrollTo(options) { this.scrollRequest = options; }
  setPointerCapture() {}
  releasePointerCapture() {}
}

function createPlayer({ reducedMotion = false } = {}) {
  const document = new Element();
  document.hidden = false;
  document.createElement = () => new Element();
  const section = new Element();
  const carousel = new Element();
  const track = new Element();
  const previous = new Element();
  const next = new Element();
  const pagination = new Element();
  document.selectors.set("#video", section);
  document.getElementById = (id) => id === "video" ? section : null;
  section.selectors.set(".swiper", carousel);
  carousel.selectors = new Map([
    [".swiper-wrapper", track], [".swiper-button-prev", previous],
    [".swiper-button-next", next], [".swiper-pagination", pagination],
  ]);
  section.replaceChildren(carousel);
  carousel.replaceChildren(track, previous, next, pagination);
  const videos = Array.from({ length: 3 }, () => {
    const video = new Element();
    Object.assign(video, {
      paused: true, loop: true, src: "", dataset: { src: "/clip.mp4" }, playCalls: 0,
      load() {},
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
      pause() { this.paused = true; },
    });
    return video;
  });
  track.replaceChildren(...videos.map((video, index) => {
    const slide = new Element();
    slide.offsetLeft = index * 1000;
    slide.selectors.set("video", video);
    slide.replaceChildren(video);
    return slide;
  }));
  section.selectors.set("video", videos);

  let observer;
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(target) { this.target = target; }
  }
  runInNewContext(script, {
    document,
    window: { matchMedia: () => ({ matches: reducedMotion }), IntersectionObserver },
    IntersectionObserver,
    CustomEvent: class {
      constructor(type, options) { this.type = type; Object.assign(this, options); }
    },
    requestAnimationFrame: (callback) => { callback(); return 1; },
    cancelAnimationFrame() {},
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, due: now + delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  document.emit("DOMContentLoaded");
  return {
    document, section, carousel, track, previous, next, pagination, videos,
    observed: () => observer.target,
    visible: (isIntersecting) => observer.callback([{ isIntersecting }]),
    advanceTime(ms) {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.due > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
  };
}

test("visible videos autoplay and advance at completion, including wrapping to the first", () => {
  const player = createPlayer();
  const { videos, track } = player;
  assert.equal(player.observed(), player.carousel);
  assert.ok(videos.every((video) => video.paused && !video.loop && video.muted && !video.controls));
  player.visible(true);
  assert.deepEqual(videos.map((video) => video.paused), [false, true, true]);

  videos[0].emit("ended");
  assert.equal(track.scrollRequest.left, 1000);
  assert.deepEqual(videos.map((video) => video.paused), [true, false, true]);
  track.scrollLeft = 200;
  track.emit("scroll");
  assert.equal(videos[0].playCalls, 1, "intermediate smooth scrolling must not replay the finished clip");
  assert.equal(videos[1].paused, false);
  track.scrollLeft = 1000;
  track.emit("scroll");

  videos[0].emit("ended");
  assert.equal(track.scrollRequest.left, 1000, "an inactive video's event must not advance the player");
  videos[1].emit("ended");
  assert.equal(track.scrollRequest.left, 2000);
  videos[2].emit("ended");
  assert.equal(track.scrollRequest.left, 0);
  assert.deepEqual(videos.map((video) => video.paused), [false, true, true]);
});

test("mouse controls stay visible only while the cursor is over the player", () => {
  const player = createPlayer();
  const { carousel } = player;
  assert.equal(carousel.classList.contains("is-hovered"), false);
  assert.equal(carousel.classList.contains("is-controls-visible"), false);
  carousel.emit("pointerenter", { pointerType: "mouse" });
  player.advanceTime(6000);
  assert.equal(carousel.classList.contains("is-hovered"), true);
  carousel.emit("pointerleave", { pointerType: "mouse" });
  assert.equal(carousel.classList.contains("is-hovered"), false);
});

test("touch controls appear after contact and hide five seconds after the last interaction", () => {
  const player = createPlayer();
  const { carousel, track, next } = player;
  const touch = { pointerType: "touch", pointerId: 1, clientX: 150 };
  carousel.emit("pointerenter", touch);
  assert.equal(carousel.classList.contains("is-controls-visible"), false);
  track.emit("pointerdown", touch);
  assert.equal(carousel.classList.contains("is-controls-visible"), true);
  player.advanceTime(4999);
  track.emit("pointermove", touch);
  player.advanceTime(4999);
  assert.equal(carousel.classList.contains("is-controls-visible"), true);
  track.emit("pointerup", touch);
  player.advanceTime(4999);
  next.emit("pointerdown", touch);
  next.emit("pointerup", touch);
  next.emit("click");
  player.advanceTime(2000);
  player.videos[1].emit("ended");
  player.advanceTime(2999);
  assert.equal(carousel.classList.contains("is-controls-visible"), true);
  player.advanceTime(1);
  assert.equal(carousel.classList.contains("is-controls-visible"), false);
  assert.equal(carousel.classList.contains("is-hovered"), false);
});

test("offscreen and background videos pause; returning or tapping retries active playback", () => {
  const player = createPlayer();
  const { videos, document } = player;
  player.visible(true);
  player.next.emit("click");
  player.visible(false);
  assert.ok(videos.every((video) => video.paused));
  player.visible(true);
  assert.equal(videos[1].paused, false);
  document.hidden = true;
  document.emit("visibilitychange");
  assert.ok(videos.every((video) => video.paused));
  document.hidden = false;
  document.emit("visibilitychange");
  assert.equal(videos[1].paused, false);
  videos[1].paused = true;
  player.carousel.emit("pointerup", { pointerType: "touch" });
  assert.equal(videos[1].paused, false);
});

test("arrows, pagination, swipes, and keyboard navigation preserve playback with reduced motion", () => {
  const player = createPlayer({ reducedMotion: true });
  const { track, videos } = player;
  player.visible(true);
  player.previous.emit("click");
  assert.equal(track.scrollRequest.left, 2000);
  assert.equal(track.scrollRequest.behavior, "auto");
  track.emit("keydown", { key: "ArrowRight" });
  assert.equal(track.scrollRequest.left, 0);
  player.pagination.children[1].emit("click");
  assert.equal(videos[1].paused, false);
  track.scrollLeft = 1000;
  track.emit("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 900 });
  track.emit("pointermove", { pointerType: "touch", pointerId: 1, clientX: 100 });
  track.emit("scroll");
  track.emit("pointerup", { pointerType: "touch", pointerId: 1 });
  assert.equal(track.scrollRequest.left, 2000);
  assert.deepEqual(videos.map((video) => video.paused), [true, true, false]);
});
