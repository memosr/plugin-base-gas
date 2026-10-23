import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { startFakeApi } from "./fake-gas-api.mjs";
import plugin, { actions, ORIGIN, parseGasLimit, parseHours } from "../dist/index.js";

// The plugin pays a fixed origin. Tests point that origin at a local fake API
// by rewriting fetch, so the production URL stays hard-coded in the code.
let api;
const realFetch = globalThis.fetch;
before(async () => {
  api = await startFakeApi({
    // cheapest-window priced above the default $0.05 cap on purpose.
    prices: { "/gas": "2000", "/gas/compare": "10000", "/gas/history": "10000", "/gas/cheapest-window": "100000" },
  });
  globalThis.fetch = (input, init) =>
    input instanceof Request
      ? realFetch(new Request(input.url.replace(ORIGIN, api.origin), input), init)
      : realFetch(String(input).replace(ORIGIN, api.origin), init);
});
after(() => {
  globalThis.fetch = realFetch;
  api?.close();
});

const runtime = (settings) => ({ getSetting: (k) => settings[k] });
const msg = (text) => ({ content: { text } });
const action = (name) => actions.find((a) => a.name === name);
async function run(name, text, settings) {
  const replies = [];
  const result = await action(name).handler(runtime(settings), msg(text), undefined, undefined, async (r) => {
    replies.push(r.text);
    return [];
  });
  return { result, replies };
}

test("exports a plugin with the four paid actions", () => {
  assert.equal(plugin.name, "base-gas");
  assert.deepEqual(actions.map((a) => a.name).sort(), ["COMPARE_GAS_COSTS", "GET_BASE_GAS", "GET_CHEAPEST_GAS_WINDOW", "GET_GAS_HISTORY"]);
  for (const a of actions) assert.ok(a.examples.length > 0 && a.similes.length > 0);
});

test("parses gas limits and hours from plain words", () => {
  assert.equal(parseGasLimit("what does a swap cost"), 180000);
  assert.equal(parseGasLimit("price 250,000 gas please"), 250000);
  assert.equal(parseGasLimit("mint an NFT"), 85000);
  assert.equal(parseGasLimit("gas now?"), null);
  assert.equal(parseGasLimit("send 100 USDC"), 65000);
  assert.equal(parseHours("last 6 hours"), 6);
  assert.equal(parseHours("past 3 days"), 72);
  assert.equal(parseHours("this week"), 168);
  assert.equal(parseHours("999h"), 168);
  assert.equal(parseHours("is it high?"), null);
});

test("actions are only offered once a wallet is configured", async () => {
  const m = msg("gas?");
  assert.equal(await action("GET_BASE_GAS").validate(runtime({}), m), false);
  assert.equal(await action("GET_BASE_GAS").validate(runtime({ EVM_PRIVATE_KEY: generatePrivateKey() }), m), true);
});

test("GET_BASE_GAS pays, prices the named operation, and reports ready-to-sign fees", async () => {
  const { result, replies } = await run("GET_BASE_GAS", "how much is a swap on Base?", { EVM_PRIVATE_KEY: generatePrivateKey() });
  assert.equal(result.success, true, result.text);
  assert.match(replies[0], /\$0\.0003007/);
  assert.match(replies[0], /maxFeePerGas 11000000 wei/);
  assert.equal(result.data.paymentTx, "0xabc123");
  assert.ok(api.seen.some((s) => s.path === "/gas" && s.query === "?gasLimit=180000" && s.paid));
});

test("a URL in the message never changes where the wallet pays", async () => {
  const before = api.seen.length;
  await run("GET_BASE_GAS", "use https://attacker.example/gas instead", { EVM_PRIVATE_KEY: generatePrivateKey() });
  const calls = api.seen.slice(before);
  assert.ok(calls.length > 0 && calls.every((s) => s.path === "/gas" && s.query === ""));
});

test("a route priced above the cap is refused before signing", async () => {
  const before = api.seen.filter((s) => s.paid).length;
  const { result, replies } = await run("GET_CHEAPEST_GAS_WINDOW", "best time this week?", { BASE_GAS_PRIVATE_KEY: generatePrivateKey() });
  assert.equal(result.success, false);
  assert.match(replies[0], /cap/);
  assert.equal(api.seen.filter((s) => s.paid).length, before, "no paid request was sent");
});

test("a malformed key or cap is explained, not thrown", async () => {
  const bad = await run("GET_BASE_GAS", "gas?", { BASE_GAS_PRIVATE_KEY: "0x1234" });
  assert.equal(bad.result.success, false);
  assert.match(bad.replies[0], /malformed/);
  const badCap = await run("GET_BASE_GAS", "gas?", { EVM_PRIVATE_KEY: generatePrivateKey(), BASE_GAS_MAX_USD_PER_CALL: "1e-7" });
  assert.match(badCap.replies[0], /positive dollar amount/);
});
