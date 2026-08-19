/**
 * Pure-function unit tests for dsh-stats-hud's browser bundle.
 *
 * lib/client.js is a hand-written loader bundle that registers itself via
 * window.__ModuleLoader__.load(). We evaluate it inside a Node VM with a stub
 * loader, run the captured factory with a stub require, and exercise the
 * helpers it exposes through the test-only `__test` export (gated behind the
 * DSH_HUD_TEST env var — never present in a browser context).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

function loadBundle() {
	let captured = null;
	const sandbox = {
		window: { __ModuleLoader__: { load: (desc) => { captured = desc.factory; } } },
		process: { env: { DSH_HUD_TEST: "1" } }
	};
	vm.createContext(sandbox);
	vm.runInContext(src, sandbox);
	assert.notEqual(captured, null, "loader factory was not captured");
	const mod = captured((id) => {
		if (id === "react") return { memo: (fn) => fn };
		throw new Error(`unexpected require: ${id}`);
	});
	assert.ok(mod.__test, "test-only __test export is missing (DSH_HUD_TEST gate)");
	return mod.__test;
}

const { formatTokens, formatDuration, formatTps, tierOf, billedInputTokens, cacheHitPercent } = loadBundle();

test("formatTokens", () => {
	assert.equal(formatTokens(0), "0");
	assert.equal(formatTokens(517), "517");
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1000), "1K");
	assert.equal(formatTokens(12200), "12.2K");
	assert.equal(formatTokens(517000), "517K");
	assert.equal(formatTokens(999499), "999K");
	assert.equal(formatTokens(999500), "1M"); // rounding rolls over into the next unit
	assert.equal(formatTokens(999999), "1M");
	assert.equal(formatTokens(1000000), "1M");
	assert.equal(formatTokens(1200000), "1.2M");
});

test("formatDuration", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(45200), "45.2s");
	assert.equal(formatDuration(59900), "59.9s");
	assert.equal(formatDuration(60000), "1m0s");
	assert.equal(formatDuration(162000), "2m42s");
});

test("formatTps", () => {
	assert.equal(formatTps(9.95), "10");
	assert.equal(formatTps(99.94), "99.9");
	assert.equal(formatTps(100), "100");
	assert.equal(formatTps(146.2), "146");
});

test("tierOf", () => {
	assert.equal(tierOf(Infinity, 750), "hidden");
	assert.equal(tierOf(Infinity, 1200), "full");
	assert.equal(tierOf(180, 1200), "full");
	assert.equal(tierOf(179, 1200), "mini");
});

test("billedInputTokens", () => {
	const usage = { uncachedInputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 25 };
	assert.equal(billedInputTokens(usage), 175);
});

test("cacheHitPercent", () => {
	const usage = { uncachedInputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 50 };
	assert.equal(cacheHitPercent(usage), 25);
	assert.equal(cacheHitPercent({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
});
