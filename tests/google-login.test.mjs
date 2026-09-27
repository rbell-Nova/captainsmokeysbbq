// Manager sign-in with Google (backend/apps-script/Code.gs).
//
//   node tests/google-login.test.mjs
//
// Google's tokeninfo endpoint is faked; every claim check is exercised.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";
const bytes = (v) => Array.from(Buffer.from(v), (b) => (b > 127 ? b - 256 : b));
const fromBytes = (v) => Buffer.from(Array.from(v, (b) => (b < 0 ? b + 256 : b)));
const FAKE_ID_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";

function backend({ props = {}, tokeninfo } = {}) {
  const properties = new Map(Object.entries({
    ACCESS_KEY: "manager-secret",
    GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID,
    MANAGER_EMAILS: "manager@example.com",
    ...props,
  }).filter(([, v]) => v !== null));
  const fetches = [];
  const context = vm.createContext({
    console, Date, JSON, Math,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => properties.get(k) || null,
      setProperty: (k, v) => properties.set(k, String(v)),
      deleteProperty: (k) => properties.delete(k),
      setProperties: (o) => Object.entries(o).forEach(([k, v]) => properties.set(k, String(v))),
    }) },
    UrlFetchApp: { fetch: (url, opts) => {
      fetches.push({ url, opts });
      const [code, body] = typeof tokeninfo === "function" ? tokeninfo(url) : [200, tokeninfo];
      return { getResponseCode: () => code, getContentText: () => JSON.stringify(body) };
    } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      getUuid: () => crypto.randomUUID(),
      computeDigest: (_a, v) => bytes(crypto.createHash("sha256").update(String(v)).digest()),
      computeHmacSha256Signature: (v, k) => bytes(crypto.createHmac("sha256", String(k)).update(String(v)).digest()),
      base64EncodeWebSafe: (v) => fromBytes(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
      base64DecodeWebSafe: (v) => {
        const t = String(v);
        if (t.length % 4 !== 0 || /[^A-Za-z0-9_=-]/.test(t)) throw new Error("Could not decode string.");
        return bytes(Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
      },
      newBlob: (v) => {
        const d = typeof v === "string" ? Buffer.from(v) : fromBytes(v);
        return { getBytes: () => bytes(d), getDataAsString: () => d.toString("utf8") };
      },
    },
  });
  vm.runInContext(fs.readFileSync(new URL("backend/apps-script/Code.gs", root), "utf8"), context);
  return { api: context, properties, fetches };
}

const goodClaims = (over = {}) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, email: "Manager@Example.com", email_verified: "true",
  exp: String(Math.floor(Date.now() / 1000) + 3600), given_name: "Ryan", ...over,
});

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("an allowlisted, verified Google account gets a manager session", () => {
  const { api, fetches } = backend({ tokeninfo: goodClaims() });
  const result = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  assert.equal(result.email, "manager@example.com", "email is normalized to lowercase");
  assert.equal(result.name, "Ryan");
  assert.ok(Date.parse(result.expiresAt) > Date.now() + 11 * 3600e3, "about a 12-hour session");
  assert.match(fetches[0].url, /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/);
  assert.equal(fetches[0].opts.muteHttpExceptions, true);
  assert.doesNotThrow(() => api.requireAccess_({ managerToken: result.managerToken }), "staff actions");
  assert.doesNotThrow(() => api.requireManagerAccess_({ managerToken: result.managerToken }), "manager actions");
});

for (const [label, claims, pattern] of [
  ["wrong audience (another app's token)", goodClaims({ aud: "evil.apps.googleusercontent.com" }), /sign-in failed/],
  ["unverified email", goodClaims({ email_verified: "false" }), /sign-in failed/],
  ["wrong issuer", goodClaims({ iss: "https://evil.example" }), /sign-in failed/],
  ["expired token", goodClaims({ exp: String(Math.floor(Date.now() / 1000) - 5) }), /sign-in failed/],
  ["missing email", goodClaims({ email: "" }), /sign-in failed/],
  ["account not on the allowlist", goodClaims({ email: "stranger@gmail.com" }), /stranger@gmail\.com isn't a manager/],
]) {
  test(`rejects ${label}`, () => {
    const { api } = backend({ tokeninfo: claims });
    assert.throws(() => api.googleLogin_({ idToken: FAKE_ID_TOKEN }), pattern);
  });
}

test("Google rejecting the token (non-200) fails closed", () => {
  const { api } = backend({ tokeninfo: () => [400, { error: "invalid_token" }] });
  assert.throws(() => api.googleLogin_({ idToken: FAKE_ID_TOKEN }), /sign-in failed/);
});

test("malformed ID tokens never reach Google", () => {
  const { api, fetches } = backend({ tokeninfo: goodClaims() });
  for (const bad of ["", "not-a-jwt", "a.b", "a.b.c.d", FAKE_ID_TOKEN + "&action=x", "x".repeat(5000)]) {
    assert.throws(() => api.googleLogin_({ idToken: bad }), /sign-in failed/);
  }
  assert.equal(fetches.length, 0);
});

test("not configured → clear message, falls back to the access key", () => {
  for (const props of [{ GOOGLE_OAUTH_CLIENT_ID: null }, { MANAGER_EMAILS: null }, { MANAGER_EMAILS: " , " }]) {
    const { api } = backend({ props, tokeninfo: goodClaims() });
    assert.throws(() => api.googleLogin_({ idToken: FAKE_ID_TOKEN }), /isn't set up yet/);
    assert.doesNotThrow(() => api.requireManagerAccess_({ key: "manager-secret" }));
  }
});

test("a second manager can be added with a comma-separated list", () => {
  const { api } = backend({ props: { MANAGER_EMAILS: "manager@example.com, second-manager@example.com" },
    tokeninfo: goodClaims({ email: "second-manager@example.com" }) });
  assert.equal(api.googleLogin_({ idToken: FAKE_ID_TOKEN }).email, "second-manager@example.com");
});

test("removing an email from MANAGER_EMAILS revokes that session immediately", () => {
  const { api, properties } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  properties.set("MANAGER_EMAILS", "someone-else@gmail.com");
  assert.throws(() => api.requireManagerAccess_({ managerToken }), /sign-in has expired/);
  assert.throws(() => api.requireAccess_({ managerToken }), /sign-in has expired/);
});

test("tampered or expired manager tokens are rejected", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  const [payload, sig] = managerToken.split(".");
  const forged = Buffer.from(JSON.stringify({ v: 2, r: "manager", e: "stranger@gmail.com", exp: Date.now() + 1e9, id: "x" }))
    .toString("base64url");
  assert.equal(api.verifyManagerToken_(`${forged}.${sig}`), "", "payload swap breaks the signature");
  assert.equal(api.verifyManagerToken_(`${payload}.${sig.slice(0, -2)}AA`), "");
  const expired = api.issueManagerToken_("manager@example.com", Date.now() - 1);
  assert.equal(api.verifyManagerToken_(expired), "");
});

test("crew passes and manager sessions can't be swapped", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  api.createCrewPass_();
  const crewToken = api.issueCrewToken_();
  assert.equal(api.verifyCrewToken_(managerToken), false, "manager token is not a crew token");
  assert.equal(api.verifyManagerToken_(crewToken), "", "crew token is not a manager token");
  assert.throws(() => api.requireManagerAccess_({ managerToken: crewToken }), /sign-in has expired/);
  assert.throws(() => api.requireManagerAccess_({ crewToken }), /manager access key/);
  assert.doesNotThrow(() => api.requireAccess_({ crewToken }), "crew still works for staff actions");
});

test("version/role fields alone keep the token types apart", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const sign = (payload) => {
    const encoded = api.base64UrlText_(JSON.stringify(payload));
    return `${encoded}.${api.signCrewPayload_(encoded)}`;
  };
  const exp = Date.now() + 3600e3;
  // Correctly signed, allowlisted email, but crew version → not a manager session.
  assert.equal(api.verifyManagerToken_(sign({ v: 1, r: "manager", e: "manager@example.com", exp })), "");
  assert.equal(api.verifyManagerToken_(sign({ v: 2, r: "crew", e: "manager@example.com", exp })), "");
  // Correctly signed, current crew generation, but manager version → not a crew pass.
  assert.equal(api.verifyCrewToken_(sign({ v: 2, r: "manager", e: "x", g: api.ensureCrewGeneration_(), exp })), false);
});

test("Revoke All Crew Devices does not sign managers out", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  const { managerToken } = api.googleLogin_({ idToken: FAKE_ID_TOKEN });
  api.revokeCrewPasses_();
  assert.doesNotThrow(() => api.requireManagerAccess_({ managerToken }));
});

test("access key still works as a backup; wrong key is still rejected", () => {
  const { api } = backend({ tokeninfo: goodClaims() });
  assert.doesNotThrow(() => api.requireManagerAccess_({ key: "manager-secret" }));
  assert.throws(() => api.requireManagerAccess_({ key: "nope" }), /Invalid manager access key/);
  assert.throws(() => api.requireAccess_({}), /crew pass is missing/);
});

test("googleLogin is routed publicly in doGet/doPost", () => {
  const src = fs.readFileSync(new URL("backend/apps-script/Code.gs", root), "utf8");
  assert.match(src, /case "googleLogin":\s*\n(?:\s*\/\/.*\n)*\s*data = googleLogin_\(input\);/);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n${err.stack}`);
  }
}
if (failed) {
  console.error(`${failed} Google login test(s) failed.`);
  process.exit(1);
}
console.log(`Google login tests passed (${tests.length}).`);
