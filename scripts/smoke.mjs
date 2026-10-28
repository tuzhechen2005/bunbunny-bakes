// Read-only deployment check: node scripts/smoke.mjs <baseUrl> (Node 22).
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

let base;
try {
  assert.equal(process.argv.length, 3);
  base = new URL(process.argv[2]);
  assert.ok(["http:", "https:"].includes(base.protocol));
  assert.ok(!base.username && !base.password && !base.search && !base.hash);
  assert.equal(base.pathname, "/");
} catch {
  console.error("✗ Usage: node scripts/smoke.mjs <http(s)://host[:port]> (no credentials)");
  process.exit(1);
}

const started = performance.now();
let requests = 0;
let passed = 0;
let failed = 0;
let products;

async function check(label, target, validate) {
  const start = performance.now();
  let response;
  try {
    assert.ok(target, "No imageUrl available from the menu");
    const url = new URL(target, base);
    assert.ok(["http:", "https:"].includes(url.protocol), "Expected an HTTP(S) URL");
    assert.ok(!url.username && !url.password, "URLs must not contain credentials");
    // Menu URLs are untrusted. Never request the paid endpoint, even as an image.
    const path = decodeURIComponent(url.pathname).replaceAll("\\", "/");
    assert.ok(!/\/api\/+assistant(?:[\/;]|$)/i.test(path), "Assistant endpoint is forbidden");
    assert.ok(requests < 10, "Request budget exhausted");
    requests += 1;
    response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      redirect: "manual", // No hidden requests, cookies, login, or redirect to assistant.
      signal: AbortSignal.timeout(15_000),
    });
    const detail = await validate(response);
    passed += 1;
    console.log(`✓ ${label} — HTTP ${response.status}, ${Math.round(performance.now() - start)} ms${detail ? `; ${detail}` : ""}`);
  } catch (error) {
    failed += 1;
    // Do not print response bodies or JSON parser errors (they could contain private data).
    const reason = error.code === "ERR_ASSERTION" ? error.message.split("\n")[0]
      : error instanceof SyntaxError ? "Invalid JSON or URL"
        : error.name === "TimeoutError" || error.name === "AbortError" ? "Request timed out"
          : "Request or response failed";
    console.log(`✗ ${label} — ${response ? `HTTP ${response.status}` : "HTTP n/a"}, ${Math.round(performance.now() - start)} ms; ${reason}`);
  } finally {
    if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
  }
}

function expect200(response) {
  assert.equal(response.status, 200, "Expected HTTP 200");
}

async function readJson(response) {
  expect200(response);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i, "Expected JSON content-type");
  const data = await response.json();
  assert.ok(data && typeof data === "object" && !Array.isArray(data), "Expected a JSON object");
  return data;
}

// Markers come from the page shells / metadata and src/copy.ts.
for (const [path, marker] of [
  ["/", "今日出炉，限量手作。"],
  ["/checkout", "确认预订"],
  ["/orders", "我的订单"],
  ["/game", "消除大面包"],
  ["/game/tu", "兔了个兔"],
]) {
  await check(`GET ${path}`, path, async (response) => {
    expect200(response);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, "Expected HTML content-type");
    const html = await response.text();
    assert.ok(html.includes("🐰的大面包") || html.includes(marker), "Missing brand or page marker");
  });
}

await check("GET /api/menu", "/api/menu", async (response) => {
  const menu = await readJson(response);
  assert.ok(Array.isArray(menu.products) && menu.products.length > 0, "Expected non-empty products array");
  products = menu.products;
  for (const [index, product] of products.entries()) {
    assert.ok(product && Array.isArray(product.pickupWeekdays), `Product ${index + 1}: missing pickupWeekdays array`);
    assert.ok(Object.hasOwn(product, "field") && product.field != null, `Product ${index + 1}: missing field`);
    console.log(`  ${JSON.stringify(product.name)} pickupWeekdays=${JSON.stringify(product.pickupWeekdays)}`);
  }
  return `${products.length} products`;
});

function expectMasked(row) {
  assert.ok(row && typeof row.wechatMasked === "string" && row.wechatMasked.includes("*"), "Missing or unmasked wechatMasked (value withheld)");
}

// Inspect every nested record, including lastWinner and allTime, without logging IDs.
function inspectPrivacy(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(key.toLowerCase() !== "wechatid", "Raw wechatId key leaked (value withheld)");
    if (key === "wechatMasked") expectMasked(value);
    inspectPrivacy(child);
  }
}

for (const path of ["/api/game/leaderboard", "/api/game/tu/leaderboard"]) {
  await check(`GET ${path}`, path, async (response) => {
    const board = await readJson(response);
    assert.ok(Object.hasOwn(board, "week") && board.week != null, "Missing week");
    assert.ok(Array.isArray(board.top), "Missing top array");
    assert.ok(Object.hasOwn(board, "allTime"), "Missing allTime key");
    board.top.forEach(expectMasked);
    if (board.allTime !== null) expectMasked(board.allTime);
    if (board.lastWinner != null) expectMasked(board.lastWinner);
    inspectPrivacy(board);
    return `${board.top.length} ranked; WeChat masking OK`;
  });
}

const imageUrl = products?.find((product) => typeof product?.imageUrl === "string" && product.imageUrl.trim())?.imageUrl;
await check("GET first product image", imageUrl, async (response) => {
  expect200(response);
  assert.match(response.headers.get("content-type") ?? "", /^image\/[^\s;]+/i, "Expected image content-type");
  await response.arrayBuffer();
});

await check("GET /admin (anonymous)", "/admin", async (response) => {
  if (response.status === 200) return;
  assert.ok([301, 302, 303, 307, 308].includes(response.status), "Expected HTTP 200 or login redirect");
  const location = response.headers.get("location");
  assert.ok(location, "Redirect missing Location");
  const login = new URL(location, new URL("/admin", base));
  assert.ok(login.origin === base.origin && !login.username && !login.password && /^\/admin\/login\/?$/.test(login.pathname), "Expected redirect to same-origin /admin/login");
  return "login redirect (not followed)";
});

console.log("SKIP /api/assistant — paid endpoint; no request sent.");
console.log(`Summary: ${passed} passed, ${failed} failed; ${requests}/10 GET requests; ${Math.round(performance.now() - started)} ms.`);
process.exitCode = failed ? 1 : 0;
