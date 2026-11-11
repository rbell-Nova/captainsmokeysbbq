import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const readScript = (name) => readFileSync(new URL("../assets/" + name, import.meta.url), "utf8");
const analytics = readScript("site-analytics.js");
const booking = readScript("site-reliability.js");

function page(hostname = "captainsmokeysbbq.com") {
  const listeners = new Map();
  const scripts = [];
  const window = { matchMedia: () => ({ matches: true }) };
  const document = {
    head: { append: (script) => scripts.push(script) },
    createElement: () => ({}),
    addEventListener: (type, fn) => listeners.set(type, fn),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
  };
  const context = { window, document, location: new URL("https://" + hostname), URL, Event };
  runInNewContext(analytics, context);
  const events = () => Array.from(window.dataLayer || []).filter(([type]) => type === "event").map((args) => [...args]);
  return { context, scripts, events };
}

test("public links report distinct actions without contact details or preview traffic", () => {
  const { context, scripts, events } = page();
  assert.equal(scripts.length, 1);
  for (const href of ["tel:+15555555555", "mailto:example@example.com", "/#book", "/PDFs/CateringMenu-2025-Template.pdf?v=1", "/menu", "/#gallery"]) {
    const link = { href: new URL(href, context.location).href };
    context.document.dispatchEvent({ type: "click", target: { closest: () => link } });
  }
  assert.deepEqual(events(), ["click_to_call", "click_to_email", "booking_cta_click", "menu_pdf_click"].map((name) => ["event", name]));
  assert.equal(page("preview.vercel.app").scripts.length, 0);
});

test("only an accepted booking emits one lead and no submitted fields", async () => {
  const { context, events } = page();
  const status = { dataset: {} };
  let submit, accepted = false;
  const form = {
    querySelector: () => null,
    reportValidity: () => true,
    reset() {},
    addEventListener: (type, handler) => { if (type === "submit") submit = handler; },
  };
  Object.assign(context.document, {
    querySelector: (selector) => selector.startsWith("#book form") ? form : null,
    querySelectorAll: () => [],
    getElementById: (id) => id === "booking-status" ? status : null,
  });
  Object.assign(context, {
    fetch: async () => ({ ok: accepted }),
    FormData: class { *[Symbol.iterator]() { yield ["date", "2099-01-01"]; yield ["email", "guest@example.com"]; } },
    console: { error() {} },
  });
  runInNewContext(booking, context);
  context.document.dispatchEvent(new Event("DOMContentLoaded"));
  await submit({ preventDefault() {} });
  assert.equal(status.dataset.state, "error");
  assert.deepEqual(events(), []);
  accepted = true;
  await submit({ preventDefault() {} });
  assert.equal(status.dataset.state, "success");
  assert.deepEqual(events(), [["event", "generate_lead"]]);
});
