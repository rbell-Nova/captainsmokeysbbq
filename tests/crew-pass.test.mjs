import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function bytes(value) {
  return Array.from(Buffer.from(value), (byte) => (byte > 127 ? byte - 256 : byte));
}

function bufferFromBytes(value) {
  return Buffer.from(Array.from(value, (byte) => (byte < 0 ? byte + 256 : byte)));
}

function createAppsScriptContext() {
  const properties = new Map([["ACCESS_KEY", "manager-secret"]]);
  const scriptProperties = {
    getProperty: (key) => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value)),
    deleteProperty: (key) => properties.delete(key),
    setProperties: (values) => Object.entries(values).forEach(([key, value]) => properties.set(key, String(value))),
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: "sha256" },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (_algorithm, value) => bytes(crypto.createHash("sha256").update(String(value)).digest()),
    computeHmacSha256Signature: (value, key) => bytes(crypto.createHmac("sha256", String(key)).update(String(value)).digest()),
    base64EncodeWebSafe: (value) => bufferFromBytes(value).toString("base64url"),
    base64DecodeWebSafe: (value) => bytes(Buffer.from(String(value), "base64url")),
    newBlob: (value) => {
      const data = typeof value === "string" ? Buffer.from(value) : bufferFromBytes(value);
      return {
        getBytes: () => bytes(data),
        getDataAsString: () => data.toString("utf8"),
      };
    },
  };

  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    PropertiesService: { getScriptProperties: () => scriptProperties },
    Utilities,
  });
  const source = fs.readFileSync(new URL("backend/apps-script/Code.gs", root), "utf8");
  vm.runInContext(source, context);
  return { context, properties };
}

function testBackendCrewPass() {
  const { context, properties } = createAppsScriptContext();
  const created = context.createCrewPass_();

  assert.match(created.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.match(created.invite, /^cp_[A-Za-z0-9_-]+$/);
  assert.ok(Date.parse(created.expiresAt) > Date.now());

  const byCode = context.redeemCrewPass_({ code: created.code.toLowerCase() });
  const byQr = context.redeemCrewPass_({ invite: created.invite });
  assert.ok(context.verifyCrewToken_(byCode.crewToken));
  assert.ok(context.verifyCrewToken_(byQr.crewToken));
  assert.doesNotThrow(() => context.requireAccess_({ crewToken: byCode.crewToken }));
  assert.doesNotThrow(() => context.requireAccess_({ key: "manager-secret" }));
  assert.throws(() => context.requireManagerAccess_({ key: byCode.crewToken }), /manager access key/i);
  assert.throws(() => context.redeemCrewPass_({ code: "NOPE-0000" }), /not valid/i);

  const tampered = `${byCode.crewToken.slice(0, -1)}x`;
  assert.equal(context.verifyCrewToken_(tampered), false);

  context.revokeCrewPasses_();
  assert.equal(context.verifyCrewToken_(byCode.crewToken), false);

  context.createCrewPass_();
  properties.set("CREW_INVITE_EXPIRES_AT", String(Date.now() - 1));
  assert.throws(() => context.redeemCrewPass_({ invite: created.invite }), /expired/i);
}

async function testRepositoryAuthRouting() {
  const urls = [];
  let auth = { crewToken: "crew-device-token" };
  const context = vm.createContext({
    console,
    URL,
    Promise,
    setTimeout,
    fetch: async (url) => {
      urls.push(String(url));
      return { json: async () => ({ ok: true, data: {} }) };
    },
    window: { EventTicketing: {} },
  });
  const source = fs.readFileSync(new URL("assets/event-ticketing/repository.js", root), "utf8");
  vm.runInContext(source, context);
  const repo = context.window.EventTicketing.createAppsScriptRepository("https://example.test/exec", () => auth);

  await repo.getAttendees();
  let called = new URL(urls.pop());
  assert.equal(called.searchParams.get("crewToken"), "crew-device-token");
  assert.equal(called.searchParams.has("key"), false);

  await repo.redeemCrewPass({ code: "ABCD-EFGH" });
  called = new URL(urls.pop());
  assert.equal(called.searchParams.get("code"), "ABCD-EFGH");
  assert.equal(called.searchParams.has("crewToken"), false);

  auth = { key: "manager-secret", crewToken: "crew-device-token" };
  await repo.createCrewPass();
  called = new URL(urls.pop());
  assert.equal(called.searchParams.get("key"), "manager-secret");
  assert.equal(called.searchParams.has("crewToken"), false);
}

function testDomReferences() {
  const html = fs.readFileSync(new URL("staff/check-in/index.html", root), "utf8");
  const app = fs.readFileSync(new URL("staff/assets/js/check-in-app.js", root), "utf8");
  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]));
  const referenced = Array.from(app.matchAll(/el\("([^"]+)"\)/g), (match) => match[1]);
  const missing = referenced.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `Missing HTML ids: ${missing.join(", ")}`);
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\(STORAGE_KEYS\.accessKey/);
}

testBackendCrewPass();
await testRepositoryAuthRouting();
testDomReferences();
console.log("Crew Pass tests passed.");
