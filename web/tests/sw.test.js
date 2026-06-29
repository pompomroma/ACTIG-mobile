/**
 * Tests for web/sw.js — scoped to changes introduced in this PR:
 *   • CACHE version bumped from "actig-v4" to "actig-v5"
 *
 * Run with:  node web/tests/sw.test.js
 *
 * No third-party test runner required — uses Node.js built-in `assert`.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ---------- service-worker environment mock ----------------------------- */

function buildSwContext() {
  const listeners = {};
  const deletedCaches = [];
  const openedCaches = {};
  const cacheStore = {};

  const caches = {
    open(name) {
      if (!cacheStore[name]) {
        cacheStore[name] = {
          _items: {},
          addAll(urls) {
            urls.forEach((u) => { this._items[u] = true; });
            return Promise.resolve();
          },
        };
      }
      openedCaches[name] = cacheStore[name];
      return Promise.resolve(cacheStore[name]);
    },
    keys() { return Promise.resolve(Object.keys(cacheStore)); },
    delete(name) {
      deletedCaches.push(name);
      delete cacheStore[name];
      return Promise.resolve(true);
    },
    match(req) {
      for (const c of Object.values(cacheStore)) {
        const url = typeof req === "string" ? req : req.url;
        if (c._items && c._items[url]) return Promise.resolve({ url });
      }
      return Promise.resolve(undefined);
    },
  };

  const ctx = {
    self: null,
    caches,
    fetch: async (req) => ({ ok: true, url: typeof req === "string" ? req : req.url }),
    URL,
    Promise,
    JSON,
    console,
    location: { origin: "https://example.com" },
    addEventListener(event, handler) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    skipWaiting() {},
    clients: { claim: () => Promise.resolve() },
    // test-only references
    _listeners: listeners,
    _deletedCaches: deletedCaches,
    _openedCaches: openedCaches,
    _cacheStore: cacheStore,
  };
  ctx.self = ctx;
  ctx.globalThis = ctx;
  return ctx;
}

function loadSw() {
  const ctx = buildSwContext();
  vm.createContext(ctx);
  let src = fs.readFileSync(path.resolve(__dirname, "../sw.js"), "utf8");
  // In a vm sandbox, only `var` declarations are attached to the context object.
  // `const` and `let` are scoped to the script and not visible on ctx.  We
  // promote top-level declarations so that CACHE and SHELL are testable.
  src = src.replace(/^(const|let)\s+/gm, "var ");
  vm.runInContext(src, ctx);
  return ctx;
}

/* ---------- test runner ------------------------------------------------- */

let passed = 0;
let failed = 0;
const asyncTests = [];

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

function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

/* ---------- suite: CACHE version --------------------------------------- */

console.log("\nsw.js › CACHE version");

{
  const ctx = loadSw();

  test("CACHE is defined", () => {
    assert.notStrictEqual(ctx.CACHE, undefined);
  });

  test("CACHE is a string", () => {
    assert.strictEqual(typeof ctx.CACHE, "string");
  });

  // Core PR assertion: the version must be "actig-v5".
  test("CACHE equals 'actig-v5' (bumped from actig-v4 in this PR)", () => {
    assert.strictEqual(ctx.CACHE, "actig-v5",
      `Expected 'actig-v5' but got '${ctx.CACHE}'`);
  });

  // Regression: old cache name must no longer be in use.
  test("CACHE is not the old 'actig-v4' value", () => {
    assert.notStrictEqual(ctx.CACHE, "actig-v4",
      "CACHE still references the old version — bump was reverted or not applied");
  });

  test("CACHE follows the 'actig-vN' naming convention", () => {
    assert.match(ctx.CACHE, /^actig-v\d+$/,
      `CACHE '${ctx.CACHE}' does not match expected 'actig-vN' pattern`);
  });
}

/* ---------- suite: SHELL asset list ------------------------------------ */

console.log("\nsw.js › SHELL asset list");

{
  const ctx = loadSw();

  test("SHELL is defined", () => {
    assert.notStrictEqual(ctx.SHELL, undefined);
  });

  test("SHELL is an array", () => {
    assert.ok(Array.isArray(ctx.SHELL), "SHELL must be an array");
  });

  test("SHELL is non-empty", () => {
    assert.ok(ctx.SHELL.length > 0, "SHELL must contain at least one entry");
  });

  test("SHELL contains ./index.html", () => {
    assert.ok(ctx.SHELL.includes("./index.html"));
  });

  test("SHELL contains ./app.js", () => {
    assert.ok(ctx.SHELL.includes("./app.js"));
  });

  test("SHELL contains ./styles.css", () => {
    assert.ok(ctx.SHELL.includes("./styles.css"));
  });

  test("SHELL contains ./speech.js and ./studio.js", () => {
    assert.ok(ctx.SHELL.includes("./speech.js"), "speech.js missing from SHELL");
    assert.ok(ctx.SHELL.includes("./studio.js"), "studio.js missing from SHELL");
  });

  test("SHELL contains ./manifest.webmanifest", () => {
    assert.ok(ctx.SHELL.includes("./manifest.webmanifest"));
  });

  test("SHELL contains all three icon assets", () => {
    assert.ok(ctx.SHELL.includes("./icons/icon-192.png"), "icon-192 missing");
    assert.ok(ctx.SHELL.includes("./icons/icon-512.png"), "icon-512 missing");
    assert.ok(ctx.SHELL.includes("./icons/apple-touch-icon.png"), "apple-touch-icon missing");
  });

  test("SHELL has exactly 10 entries", () => {
    assert.strictEqual(ctx.SHELL.length, 10,
      `Expected 10 SHELL entries, got ${ctx.SHELL.length}`);
  });

  test("All SHELL entries are non-empty strings", () => {
    ctx.SHELL.forEach((entry, i) => {
      assert.strictEqual(typeof entry, "string", `Entry at index ${i} is not a string`);
      assert.ok(entry.length > 0, `Entry at index ${i} is an empty string`);
    });
  });
}

/* ---------- suite: fetch event (synchronous assertions) ---------------- */

console.log("\nsw.js › fetch event (API bypass)");

{
  const ctx = loadSw();

  test("fetch event listener is registered", () => {
    assert.ok(ctx._listeners.fetch && ctx._listeners.fetch.length > 0,
      "No 'fetch' event listener registered");
  });

  test("fetch handler does NOT intercept api.nvidia.com requests (network-only)", () => {
    const handler = ctx._listeners.fetch[0];
    let responded = false;
    handler({
      request: { url: "https://integrate.api.nvidia.com/v1/chat/completions" },
      respondWith: () => { responded = true; },
    });
    assert.strictEqual(responded, false,
      "respondWith was called for api.nvidia.com — API calls must bypass the cache");
  });

  test("fetch handler intercepts same-origin requests with respondWith", () => {
    const handler = ctx._listeners.fetch[0];
    let responded = false;
    handler({
      request: { url: "https://example.com/app.js" },
      respondWith: () => { responded = true; },
    });
    assert.strictEqual(responded, true,
      "respondWith was NOT called for a same-origin request — cache-first logic broken");
  });

  test("fetch handler does NOT intercept external CDN requests", () => {
    const handler = ctx._listeners.fetch[0];
    let responded = false;
    handler({
      request: { url: "https://cdn.jsdelivr.net/three.js" },
      respondWith: () => { responded = true; },
    });
    assert.strictEqual(responded, false,
      "respondWith was called for an external CDN — only same-origin should be intercepted");
  });

  // Boundary: any URL whose hostname *contains* "api.nvidia.com" is bypassed.
  test("fetch handler bypasses subdomain of api.nvidia.com", () => {
    const handler = ctx._listeners.fetch[0];
    let responded = false;
    handler({
      request: { url: "https://other.api.nvidia.com/endpoint" },
      respondWith: () => { responded = true; },
    });
    assert.strictEqual(responded, false,
      "A subdomain of api.nvidia.com should also be bypassed");
  });
}

/* ---------- suite: install event (async) ------------------------------- */

console.log("\nsw.js › install event");

testAsync("install event is registered", async () => {
  const ctx = loadSw();
  assert.ok(ctx._listeners.install && ctx._listeners.install.length > 0,
    "No 'install' event listener registered");
});

testAsync("install event opens the current CACHE (actig-v5)", async () => {
  const ctx = loadSw();
  const handler = ctx._listeners.install[0];
  await new Promise((resolve) => { handler({ waitUntil: (p) => p.then(resolve) }); });
  assert.ok(Object.keys(ctx._openedCaches).includes("actig-v5"),
    "Install did not open the 'actig-v5' cache");
});

testAsync("install event pre-caches all SHELL assets", async () => {
  const ctx = loadSw();
  const handler = ctx._listeners.install[0];
  await new Promise((resolve) => { handler({ waitUntil: (p) => p.then(resolve) }); });
  const cache = ctx._openedCaches["actig-v5"];
  assert.ok(cache, "actig-v5 cache was not opened during install");
  ctx.SHELL.forEach((url) => {
    assert.ok(cache._items[url], `${url} was not added to the cache during install`);
  });
});

/* ---------- suite: activate event (async) ------------------------------ */

console.log("\nsw.js › activate event");

testAsync("activate event is registered", async () => {
  const ctx = loadSw();
  assert.ok(ctx._listeners.activate && ctx._listeners.activate.length > 0,
    "No 'activate' event listener registered");
});

testAsync("activate deletes old cache versions (actig-v4, actig-v3)", async () => {
  const ctx = loadSw();
  ctx._cacheStore["actig-v4"] = { _items: {} };
  ctx._cacheStore["actig-v3"] = { _items: {} };
  const handler = ctx._listeners.activate[0];
  await new Promise((resolve) => { handler({ waitUntil: (p) => p.then(resolve) }); });
  assert.ok(ctx._deletedCaches.includes("actig-v4"),
    "'actig-v4' was not deleted during activate");
  assert.ok(ctx._deletedCaches.includes("actig-v3"),
    "'actig-v3' was not deleted during activate");
});

testAsync("activate does not delete the current CACHE (actig-v5)", async () => {
  const ctx = loadSw();
  ctx._cacheStore["actig-v5"] = { _items: {} };
  ctx._cacheStore["actig-v4"] = { _items: {} };
  const handler = ctx._listeners.activate[0];
  await new Promise((resolve) => { handler({ waitUntil: (p) => p.then(resolve) }); });
  assert.ok(!ctx._deletedCaches.includes("actig-v5"),
    "Current cache 'actig-v5' was incorrectly deleted during activate");
});

/* ---------- run async tests then print summary ------------------------- */

(async () => {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      console.log(`  ✓  ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗  ${name}`);
      console.error(`     ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();