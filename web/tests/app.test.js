/**
 * Tests for web/app.js — scoped to changes introduced in this PR:
 *   • BUILTIN_KEY constant (was missing; app previously fell back to empty string)
 *   • store.key getter now falls back to BUILTIN_KEY instead of ""
 *
 * Run with:  node web/tests/app.test.js
 *
 * No third-party test runner required — uses Node.js built-in `assert`.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ---------- browser environment mock ------------------------------------ */

// Minimal localStorage shim (reusable across tests via reset()).
function makeLocalStorage() {
  const store = Object.create(null);
  return {
    _store: store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

// Minimal stub for APIs referenced at module parse time in app.js.
function buildContext(ls) {
  const ctx = {
    localStorage: ls,
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: {
      addEventListener: () => {},
      SpeechRecognition: undefined,
      webkitSpeechRecognition: undefined,
    },
    navigator: { mediaDevices: undefined },
    location: { origin: "https://example.com" },
    speechSynthesis: { cancel: () => {}, speak: () => {} },
    SpeechSynthesisUtterance: function () {},
    SpeechRecognition: undefined,
    webkitSpeechRecognition: undefined,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: async () => ({ ok: false, body: null }),
    URL,
    JSON,
    Promise,
  };
  // Allow self-referencing globals used by app.js.
  ctx.self = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

function loadApp(ls) {
  const ctx = buildContext(ls);
  vm.createContext(ctx);
  let src = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
  // In a vm sandbox, only `var` declarations are attached to the context object.
  // `const` and `let` are scoped to the script and not visible on ctx.  We
  // promote top-level declarations so that BUILTIN_KEY and store are testable.
  src = src.replace(/^(const|let)\s+/gm, "var ");
  // Wrap in a try/catch inside the vm so DOM-setup errors at the bottom of the
  // file (e.g. calling document.getElementById on absent nodes) don't abort the
  // test — we only care about the constants and store object at the top.
  const wrapped = `
    try { ${src} } catch (_e) { /* ignore DOM-setup errors in test context */ }
  `;
  vm.runInContext(wrapped, ctx);
  return ctx;
}

/* ---------- test helpers ------------------------------------------------ */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

/* ---------- suite: BUILTIN_KEY constant --------------------------------- */

console.log("\napp.js › BUILTIN_KEY constant");

{
  const ls = makeLocalStorage();
  const ctx = loadApp(ls);

  test("BUILTIN_KEY is defined", () => {
    assert.notStrictEqual(ctx.BUILTIN_KEY, undefined);
  });

  test("BUILTIN_KEY is a non-empty string", () => {
    assert.strictEqual(typeof ctx.BUILTIN_KEY, "string");
    assert.ok(ctx.BUILTIN_KEY.length > 0, "BUILTIN_KEY must not be empty");
  });

  test("BUILTIN_KEY starts with the NVIDIA API key prefix 'nvapi-'", () => {
    assert.ok(
      ctx.BUILTIN_KEY.startsWith("nvapi-"),
      `Expected BUILTIN_KEY to start with 'nvapi-', got: ${ctx.BUILTIN_KEY}`
    );
  });

  test("BUILTIN_KEY has minimum plausible length (> 20 chars)", () => {
    assert.ok(ctx.BUILTIN_KEY.length > 20, "BUILTIN_KEY appears too short to be valid");
  });

  test("BUILTIN_KEY contains no whitespace", () => {
    assert.ok(!/\s/.test(ctx.BUILTIN_KEY), "BUILTIN_KEY must not contain whitespace");
  });

  // Regression pin: catch accidental key rotation or truncation.
  test("BUILTIN_KEY matches the exact value shipped in this PR", () => {
    const expected = "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";
    assert.strictEqual(ctx.BUILTIN_KEY, expected,
      "BUILTIN_KEY changed — update this test only after a deliberate key rotation");
  });
}

/* ---------- suite: store.key getter fallback ---------------------------- */

console.log("\napp.js › store.key getter");

{
  // Case 1: nothing in localStorage → must return BUILTIN_KEY (not "").
  const ls1 = makeLocalStorage();
  const ctx1 = loadApp(ls1);

  test("store.key returns BUILTIN_KEY when localStorage has no entry", () => {
    const key = ctx1.store.key;
    assert.strictEqual(key, ctx1.BUILTIN_KEY,
      `Expected BUILTIN_KEY but got: '${key}'`);
  });

  test("store.key is non-empty even with no user-provided key (no zero-setup regression)", () => {
    assert.ok(ctx1.store.key.length > 0, "store.key must not be empty when nothing is stored");
  });

  test("store.key does NOT fall back to empty string (old behaviour removed)", () => {
    assert.notStrictEqual(ctx1.store.key, "",
      "store.key must fall back to BUILTIN_KEY, not to empty string");
  });
}

{
  // Case 2: user has saved a custom key → must return that key, not BUILTIN_KEY.
  const ls2 = makeLocalStorage();
  ls2.setItem("actig.key", "nvapi-customUserKey12345");
  const ctx2 = loadApp(ls2);

  test("store.key returns the user-provided key when one is stored", () => {
    assert.strictEqual(ctx2.store.key, "nvapi-customUserKey12345");
  });

  test("store.key does not override a saved key with BUILTIN_KEY", () => {
    assert.notStrictEqual(ctx2.store.key, ctx2.BUILTIN_KEY);
  });
}

{
  // Case 3: localStorage entry exists but is an empty string → should fall back.
  // The || operator treats "" as falsy, so BUILTIN_KEY should win.
  const ls3 = makeLocalStorage();
  ls3.setItem("actig.key", "");
  const ctx3 = loadApp(ls3);

  test("store.key falls back to BUILTIN_KEY when localStorage entry is empty string", () => {
    assert.strictEqual(ctx3.store.key, ctx3.BUILTIN_KEY,
      "Empty-string entry should be treated as absent (|| operator behaviour)");
  });
}

{
  // Case 4: store.key setter persists to localStorage; round-trip must work.
  const ls4 = makeLocalStorage();
  const ctx4 = loadApp(ls4);

  test("store.key setter persists to localStorage", () => {
    ctx4.store.key = "nvapi-roundtrip";
    assert.strictEqual(ls4.getItem("actig.key"), "nvapi-roundtrip");
  });

  test("store.key getter reads back what was written by the setter", () => {
    ctx4.store.key = "nvapi-setterRead";
    assert.strictEqual(ctx4.store.key, "nvapi-setterRead");
  });
}

/* ---------- summary ----------------------------------------------------- */

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);