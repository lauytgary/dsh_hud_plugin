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

const { formatTokens, formatDuration, formatTps, tierOf, billedInputTokens, cacheHitPercent, isDsApiPeak } = loadBundle();

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

/**
 * DeepSeek API peak windows (official docs): peak = Mon-Fri 01:00-04:00 /
 * 06:00-10:00 UTC, i.e. Beijing (UTC+8) Mon-Fri 09:00-12:00 / 14:00-18:00.
 * Weekends and every other hour are off-peak. All instants below are built
 * from UTC stamps and named by their Beijing wall clock.
 * Fixed dates: 2026-08-17 = Monday, 2026-08-22 = Saturday, 2026-08-23 = Sunday.
 */
test("isDsApiPeak: Mon-Fri Beijing 09-12 / 14-18", () => {
	// Monday Beijing 08:59 (UTC 00:59) -> off-peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 0, 59))), false);
	// Monday Beijing 09:00 (UTC 01:00) -> peak opens
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 1, 0))), true);
	// Monday Beijing 11:59 (UTC 03:59) -> still peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 3, 59))), true);
	// Monday Beijing 12:00 (UTC 04:00) -> peak closes
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 4, 0))), false);
	// Monday Beijing 13:59 (UTC 05:59) -> off-peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 5, 59))), false);
	// Monday Beijing 14:00 (UTC 06:00) -> peak reopens
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 6, 0))), true);
	// Monday Beijing 17:59 (UTC 09:59) -> still peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 9, 59))), true);
	// Monday Beijing 18:00 (UTC 10:00) -> peak closes
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 10, 0))), false);
	// Monday Beijing 23:30 (UTC 15:30) -> off-peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 17, 15, 30))), false);
});

test("isDsApiPeak: weekends are fully off-peak", () => {
	// Saturday Beijing 10:00 / 15:00 (inside the weekday windows)
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 22, 2, 0))), false);
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 22, 7, 0))), false);
	// Sunday Beijing 09:00 / 17:59 (window edges)
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 23, 1, 0))), false);
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 23, 9, 59))), false);
});

test("isDsApiPeak: weekday follows the Beijing calendar, not UTC", () => {
	// Beijing Monday 01:00 == UTC Sunday 17:00 -> still off-peak (01:00 is outside the windows; pins the Beijing-day semantics at the UTC day boundary)
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 16, 17, 0))), false);
	// Beijing Sunday 01:00 == UTC Saturday 17:00 -> off-peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 22, 17, 0))), false);
	// Beijing Friday 18:00 (UTC 10:00) -> off-peak
	assert.equal(isDsApiPeak(new Date(Date.UTC(2026, 7, 21, 10, 0))), false);
});
