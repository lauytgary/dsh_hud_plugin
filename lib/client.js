/**
 * dsh-stats-hud — browser half.
 *
 * A sci-fi HUD showing session stats as game-style level bars, rendered as a
 * vertical column fixed to the far right edge of the window.
 *
 *   CLOCK        local time 24h + PEAK / OFF-PEAK rate badge
 *                (peak = Beijing 09:00-12:00 / 14:00-18:00, converted from local)
 *   STEPS        segmented bar          (steps, 100 = full, turns in label)
 *   LLM / TOOLS  dual charge bar        (labels above the bar, violet/blue segments)
 *   THROUGHPUT   speedometer gauge      (tokens/s, redline auto-scales 200→300→400...)
 *   CACHE HIT    mana bar               (cache-hit %, 0-100%)
 *   CONTEXT      rolling-token rows     (CACHE HIT / CACHE MISSED / OUTPUT, odometer drums)
 *
 * Registered into the conversation composer dock slot (its only purpose is to
 * receive the session-scoped hooks); the panel itself is position:fixed and
 * takes no layout space, so the stock stats line stays untouched.
 */
window.__ModuleLoader__.load({
	id: "dsh-stats-hud",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region formatters (mirrors the stock StatsLine helpers)
		/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
		function formatTokens(n) {
			const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
			if (n < 1e3) return String(n);
			if (n < 1e6) return `${scaled(n / 1e3)}K`;
			return `${scaled(n / 1e6)}M`;
		}
		/** Compact duration: 45.2s under a minute, 2m42s from there on. */
		function formatDuration(ms) {
			const s = ms / 1e3;
			if (s < 60) return `${Math.round(s * 10) / 10}s`;
			const whole = Math.round(s);
			return `${Math.floor(whole / 60)}m${whole % 60}s`;
		}
		/** One decimal under 100, integer from there on. */
		function formatTps(v) {
			return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
		}
		/** Sum of the three disjoint prompt-side billing buckets. */
		function billedInputTokens(usage) {
			return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
		}
		/** Cache-hit share of billed prompt input, or null when nothing was billed. */
		function cacheHitPercent(usage) {
			const denominator = billedInputTokens(usage);
			return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100);
		}
		//#endregion
		//#region labels (all-English LLM terminology)
		const L = {
			steps: "STEPS",
			turn: "TURN",
			llm: "LLM",
			tools: "TOOLS",
			throughput: "THROUGHPUT",
			tokPerS: "tok/s",
			cacheHit: "CACHE HIT",
			occupancy: "CONTEXT USAGE",
			context: "CONTEXT",
			sysPrompt: "SYS PROMPT",
			toolsSeg: "TOOLS",
			messagesSeg: "MESSAGES",
			cacheHitRow: "CACHE HIT",
			cacheMissed: "CACHE MISSED",
			output: "OUTPUT",
			miniSteps: "Step",
			miniTurn: "Turn",
			miniHit: "HIT",
			miniMiss: "MISS",
			miniOut: "OUT",
			peak: "DS API PEAK",
			offPeak: "DS API OFF PEAK",
			peakShort: "PEAK",
			offPeakShort: "OFF PEAK"
		};
		//#endregion
		//#region styles
		const CSS_ID = "dsh-stats-hud/styles";
		const CSS = `
.gsh-root{--gsh-cyan:#4dd7ff;--gsh-violet:#c084fc;--gsh-blue:#5b8cff;--gsh-green:#4ade80;--gsh-amber:#ffb454;--gsh-red:#ff6b6b;--gsh-magenta:#f472b6;box-sizing:border-box;position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:900;pointer-events:none;display:flex;flex-direction:column;gap:9px;padding:10px 10px 11px;border:1px solid rgba(100,170,255,.28);border-radius:12px;background:linear-gradient(180deg,rgba(14,22,44,.92),rgba(7,11,26,.94));box-shadow:0 0 14px rgba(70,140,255,.14),inset 0 0 22px rgba(70,140,255,.05);font-family:var(--dsw-font-family,Inter,system-ui,sans-serif)}
.gsh-root::before,.gsh-root::after{content:"";position:absolute;width:10px;height:10px;pointer-events:none}
.gsh-root::before{top:-1px;left:-1px;border-top:2px solid var(--gsh-cyan);border-left:2px solid var(--gsh-cyan);border-top-left-radius:3px}
.gsh-root::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--gsh-cyan);border-right:2px solid var(--gsh-cyan);border-bottom-right-radius:3px}
.gsh-root.gsh-running{box-shadow:0 0 18px rgba(70,140,255,.28),inset 0 0 22px rgba(70,140,255,.08);animation:gsh-border-pulse 1.6s ease-in-out infinite}
@keyframes gsh-border-pulse{50%{border-color:rgba(160,215,255,.6)}}
.gsh-root.gsh-full{width:164px}
.gsh-root.gsh-mini{width:88px;gap:7px;padding:8px 8px 9px}
.gsh-root.gsh-mini .gsh-roll-label{font-size:7px;letter-spacing:.5px;width:26px}
.gsh-root.gsh-hidden{display:none}
.gsh-clock{flex:none;display:flex;flex-direction:column;align-items:center;gap:1px;border:1px solid;border-radius:7px;padding:4px 0 3px}
.gsh-clock-time{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:16px;font-weight:600;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:.5px}
.gsh-clock-rate{font-size:8px;letter-spacing:1.2px;line-height:1.3}
.gsh-clock.gsh-peak{border-color:rgba(255,159,67,.5);background:rgba(255,159,67,.14);box-shadow:inset 0 0 12px rgba(255,159,67,.1)}
.gsh-clock.gsh-peak .gsh-clock-time{color:#ff9f43;text-shadow:0 0 8px rgba(255,159,67,.65)}
.gsh-clock.gsh-peak .gsh-clock-rate{color:rgba(255,185,120,.95)}
.gsh-clock.gsh-off{border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.11);box-shadow:inset 0 0 12px rgba(74,222,128,.08)}
.gsh-clock.gsh-off .gsh-clock-time{color:var(--gsh-green);text-shadow:0 0 8px rgba(74,222,128,.6)}
.gsh-clock.gsh-off .gsh-clock-rate{color:rgba(140,235,170,.9)}
.gsh-inst{flex:none;display:flex;flex-direction:column;gap:4px;min-width:0}
.gsh-inst-head{display:flex;align-items:baseline;justify-content:space-between;gap:6px;min-width:0}
.gsh-title{font-size:9px;letter-spacing:1.2px;color:rgba(150,200,255,.8);white-space:nowrap}
.gsh-value{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11px;color:#e6f2ff;font-variant-numeric:tabular-nums;white-space:nowrap}
.gsh-channel-head{display:flex;justify-content:space-between;gap:6px;min-width:0}
.gsh-channel-cell{display:flex;flex-direction:column;gap:1px;min-width:0}
.gsh-channel-cell.gsh-right{align-items:flex-end}
.gsh-title-llm{color:var(--gsh-violet)}
.gsh-title-tool{color:var(--gsh-blue)}
.gsh-value-llm{color:var(--gsh-violet);font-size:12px}
.gsh-value-tool{color:var(--gsh-blue);font-size:12px}
.gsh-track{position:relative;height:10px;border-radius:5px;background:rgba(40,60,110,.55);overflow:hidden;border:1px solid rgba(90,150,255,.22);box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
.gsh-dual{display:flex;height:100%;gap:1px;box-sizing:border-box}
.gsh-dual .gsh-llm{background:linear-gradient(180deg,var(--gsh-violet),#7c5cd6);box-shadow:0 0 6px rgba(192,132,252,.5)}
.gsh-dual .gsh-tool{background:linear-gradient(180deg,var(--gsh-blue),#3f63c9);box-shadow:0 0 6px rgba(91,140,255,.5)}
.gsh-fill{height:100%;border-radius:4px;transition:width .45s ease,flex-grow .45s ease}
.gsh-ctx-wrap{position:relative;display:flex;flex-direction:column;gap:4px;pointer-events:auto;cursor:default}
.gsh-ctx-segs{display:flex;height:100%;gap:1px;box-sizing:border-box;transition:width .45s ease}
.gsh-ctx-sys{background:linear-gradient(180deg,#9aa4b8,#6b7488)}
.gsh-ctx-tools{background:linear-gradient(180deg,var(--gsh-blue),#3f63c9);box-shadow:0 0 5px rgba(91,140,255,.45)}
.gsh-ctx-msg{background:linear-gradient(180deg,var(--gsh-violet),#7c5cd6);box-shadow:0 0 5px rgba(192,132,252,.45)}
.gsh-ctx-red{background:linear-gradient(90deg,#d64545,var(--gsh-red));box-shadow:0 0 8px rgba(255,107,107,.6)}
.gsh-ctx-tip{display:none;position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);z-index:10;flex-direction:column;gap:3px;padding:6px 8px;border:1px solid rgba(100,170,255,.35);border-radius:8px;background:rgba(8,12,26,.97);box-shadow:0 0 12px rgba(70,140,255,.25);pointer-events:none;white-space:nowrap}
.gsh-ctx-wrap:hover .gsh-ctx-tip{display:flex}
.gsh-ctx-tip-row{display:flex;align-items:center;gap:6px;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:9px;color:rgba(200,220,255,.9)}
.gsh-ctx-tip-dot{flex:none;width:6px;height:6px;border-radius:50%}
.gsh-ctx-tip-dot-sys{background:#9aa4b8}
.gsh-ctx-tip-dot-tools{background:var(--gsh-blue)}
.gsh-ctx-tip-dot-msg{background:var(--gsh-violet)}
.gsh-ctx-tip-val{margin-left:auto;padding-left:12px;font-variant-numeric:tabular-nums;color:#e6f2ff}
.gsh-focus{background:linear-gradient(90deg,#3fae63,var(--gsh-green));box-shadow:0 0 6px rgba(74,222,128,.45)}
.gsh-focus.gsh-warn{background:linear-gradient(90deg,#d6a23f,var(--gsh-amber));box-shadow:0 0 6px rgba(255,180,84,.45)}
.gsh-focus.gsh-bad{background:linear-gradient(90deg,#d64545,var(--gsh-red));box-shadow:0 0 6px rgba(255,107,107,.45)}
.gsh-running .gsh-fill{animation:gsh-fill-pulse 1.4s ease-in-out infinite}
@keyframes gsh-fill-pulse{50%{filter:brightness(1.35)}}
.gsh-gauge{flex:none;display:flex;flex-direction:column;align-items:center;gap:0}
.gsh-gauge-head{display:flex;justify-content:center;width:100%}
.gsh-gauge-read{display:flex;justify-content:center;align-items:baseline;gap:4px;width:100%;margin-top:-6px}
.gsh-needle{transition:transform .45s cubic-bezier(.2,.8,.3,1)}
.gsh-roll{flex:none;display:flex;flex-direction:column;gap:3px}
.gsh-roll-row{display:flex;align-items:center;gap:5px;min-width:0}
.gsh-roll-label{font-size:8px;letter-spacing:1px;flex:none;width:84px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gsh-roll-hit{color:var(--gsh-green)}
.gsh-roll-miss{color:var(--gsh-amber)}
.gsh-roll-out{color:var(--gsh-magenta)}
.gsh-roll-steps{color:var(--gsh-cyan)}
.gsh-roll-turn{color:rgba(170,210,255,.85)}
.gsh-roll-value{display:inline-flex;align-items:center;flex:none;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:13px;color:#e6f2ff;font-variant-numeric:tabular-nums}
.gsh-drum{position:relative;display:inline-block;width:9px;height:15px;overflow:hidden;vertical-align:bottom;background:rgba(255,255,255,.05);border-radius:2px;box-shadow:inset 0 0 4px rgba(0,0,0,.6)}
.gsh-drum::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(180deg,rgba(255,255,255,.18),transparent);pointer-events:none;z-index:2}
.gsh-drum::after{content:"";position:absolute;bottom:0;left:0;right:0;height:5px;background:linear-gradient(0deg,rgba(0,0,0,.55),transparent);pointer-events:none;z-index:2}
.gsh-strip{display:flex;flex-direction:column;transition:transform .5s cubic-bezier(.25,1.12,.36,1)}
.gsh-drum-digit{flex:none;height:15px;line-height:15px;text-align:center;width:9px}
.gsh-drum-digit:nth-child(odd){background:rgba(255,255,255,.03)}
.gsh-char{display:inline-block;height:15px;line-height:15px}
`;
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-stats-hud";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region instruments
		/** Local 24h clock with DeepSeek peak/off-peak rate badge (Beijing 09-12 / 14-18 = PEAK). Mini tier uses the short badge text. */
		function LocalClock({ mini = false }) {
			const [now, setNow] = react.useState(() => new Date());
			react.useEffect(() => {
				const id = setInterval(() => setNow(new Date()), 1000);
				return () => clearInterval(id);
			}, []);
			const hh = String(now.getHours()).padStart(2, "0");
			const mm = String(now.getMinutes()).padStart(2, "0");
			const bjMin = ((now.getTime() + 8 * 3600e3) / 60000) % 1440;
			const peak = (bjMin >= 540 && bjMin < 720) || (bjMin >= 840 && bjMin < 1080);
			const rate = mini ? (peak ? L.peakShort : L.offPeakShort) : (peak ? L.peak : L.offPeak);
			return react.createElement("div", { className: `gsh-clock${peak ? " gsh-peak" : " gsh-off"}` },
				react.createElement("span", { className: "gsh-clock-time" }, `${hh}:${mm}`),
				react.createElement("span", { className: "gsh-clock-rate" }, rate));
		}
		/** Rolling steps / turns rows (odometer drums, like the CONTEXT rows). */
		function MissionRolling({ steps, turns }) {
			return react.createElement("div", { className: "gsh-roll" },
				react.createElement("div", { className: "gsh-roll-row" },
					react.createElement("span", { className: "gsh-roll-label gsh-roll-steps" }, L.steps),
					react.createElement(RollingValue, { value: steps })),
				react.createElement("div", { className: "gsh-roll-row" },
					react.createElement("span", { className: "gsh-roll-label gsh-roll-turn" }, L.turn),
					react.createElement(RollingValue, { value: turns })));
		}
		/**
		 * Dual charge bar: LLM (violet) + TOOLS (blue), labels stacked over the
		 * values, one column per segment, directly above the bar. Segment widths
		 * follow the raw LLM:TOOLS time ratio (no full-scale cap), so the bar
		 * always reads the proportion between the two.
		 */
		function ChannelBar({ llmMs, toolMs }) {
			const total = llmMs + toolMs;
			const llmShare = total > 0 ? llmMs / total * 100 : 0;
			return react.createElement("div", { className: "gsh-inst" },
				react.createElement("div", { className: "gsh-channel-head" },
					react.createElement("div", { className: "gsh-channel-cell" },
						react.createElement("span", { className: "gsh-title gsh-title-llm" }, L.llm),
						react.createElement("span", { className: "gsh-value gsh-value-llm" }, formatDuration(llmMs))),
					react.createElement("div", { className: "gsh-channel-cell gsh-right" },
						react.createElement("span", { className: "gsh-title gsh-title-tool" }, L.tools),
						react.createElement("span", { className: "gsh-value gsh-value-tool" }, formatDuration(toolMs)))),
				react.createElement("div", { className: "gsh-track" },
					react.createElement("div", { className: "gsh-dual" },
						react.createElement("div", { className: "gsh-fill gsh-llm", style: { flexGrow: llmShare } }),
						react.createElement("div", { className: "gsh-fill gsh-tool", style: { flexGrow: 100 - llmShare } }))));
		}
		/** Semicircular speedometer; redline auto-scales in 100 tok/s steps (200→300→400...). */
		function SpeedGauge({ tps }) {
			let redline = 200;
			while (tps > redline) redline += 100;
			const pct = Math.min(tps / redline, 1);
			const angle = pct * 180;
			const needle = `rotate(${angle - 90} 50 52)`;
			const half = Math.round(redline / 2);
			const tick = (deg, major, label) => {
				const rad = deg * Math.PI / 180;
				const outer = major ? 42 : 38;
				const inner = major ? 31 : 34;
				const x1 = 50 + inner * Math.cos(rad);
				const y1 = 52 - inner * Math.sin(rad);
				const x2 = 50 + outer * Math.cos(rad);
				const y2 = 52 - outer * Math.sin(rad);
				const lx = 50 + 49 * Math.cos(rad);
				const ly = 52 - 49 * Math.sin(rad);
				return react.createElement("g", { key: deg },
					react.createElement("line", { x1, y1, x2, y2, stroke: major ? "rgba(160,215,255,.75)" : "rgba(120,180,255,.35)", strokeWidth: major ? 1.6 : 1 }),
					label !== void 0 && react.createElement("text", {
						x: lx,
						y: ly + 2.5,
						textAnchor: "middle",
						fontSize: 6.5,
						fill: "rgba(150,200,255,.75)",
						fontFamily: "ui-monospace,Menlo,monospace"
					}, label));
			};
			return react.createElement("div", { className: "gsh-gauge" },
				react.createElement("div", { className: "gsh-gauge-head" },
					react.createElement("span", { className: "gsh-title" }, L.throughput)),
				react.createElement("svg", { viewBox: "0 0 100 62", width: "118", height: "68", style: { display: "block", margin: "-2px auto 0" } },
					react.createElement("defs", null,
						react.createElement("linearGradient", { id: "gsh-arc", x1: "0", y1: "0", x2: "1", y2: "0" },
							react.createElement("stop", { offset: "0%", stopColor: "#4dd7ff" }),
							react.createElement("stop", { offset: "100%", stopColor: "#c084fc" }))),
					react.createElement("path", { d: "M 8 52 A 42 42 0 0 1 92 52", fill: "none", stroke: "rgba(40,60,110,.6)", strokeWidth: 4.5, strokeLinecap: "round" }),
					react.createElement("path", {
						d: "M 8 52 A 42 42 0 0 1 92 52",
						fill: "none",
						stroke: "url(#gsh-arc)",
						strokeWidth: 4.5,
						strokeLinecap: "round",
						pathLength: 100,
						strokeDasharray: `${Math.max(pct * 100, 0.001)} 100`
					}),
					[0, 45, 90, 135, 180].map((deg) => tick(deg, deg % 90 === 0, deg % 90 === 0 ? String(deg === 180 ? 0 : deg === 90 ? half : redline) : void 0)),
					react.createElement("line", {
						className: "gsh-needle",
						x1: 50,
						y1: 52,
						x2: 50,
						y2: 18,
						stroke: tps > redline ? "#ff6b6b" : "#e6f2ff",
						strokeWidth: 1.8,
						strokeLinecap: "round",
						transform: needle,
						style: { filter: "drop-shadow(0 0 3px rgba(230,242,255,.6))" }
					}),
					react.createElement("circle", { cx: 50, cy: 52, r: 3, fill: "#0a1020", stroke: "#e6f2ff", strokeWidth: 1.4 })),
				react.createElement("div", { className: "gsh-gauge-read" },
					react.createElement("span", { className: "gsh-value", style: { fontSize: 13, color: tps > redline ? "#ff6b6b" : "#e6f2ff" } }, tps > 0 ? formatTps(tps) : "—"),
					react.createElement("span", { className: "gsh-sub" }, L.tokPerS)));
		}
		/**
		 * Percent bar with graded colors.
		 * mode "low-bad":  lower is worse  (cache hit:  <50 red, <80 yellow, else green)
		 * mode "high-bad": higher is worse (occupancy: <60 green, <85 yellow, else red)
		 */
		/** Simple graded percent bar (cache-hit style: lower is worse). */
		function PercentBar({ label, percent }) {
			const grade = percent < 50 ? "gsh-bad" : percent < 80 ? "gsh-warn" : "";
			return react.createElement("div", { className: "gsh-inst" },
				react.createElement("div", { className: "gsh-inst-head" },
					react.createElement("span", { className: "gsh-title" }, label),
					react.createElement("span", { className: "gsh-value" }, `${percent}%`)),
				react.createElement("div", { className: "gsh-track" },
					react.createElement("div", { className: `gsh-fill gsh-focus ${grade}`, style: { width: `${percent}%` } })));
		}
		/**
		 * Context-window usage bar: three segments (sys prompt gray, tools blue,
		 * messages purple) whose widths follow the contextBreakdown token ratio.
		 * At ≥80% occupancy the whole bar turns solid red. Hovering the bar shows
		 * the three token counts (only this wrapper opts back into pointer events;
		 * the rest of the panel stays click-through).
		 */
		function ContextUsageBar({ pressure, breakdown }) {
			const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			if (usedTokens === void 0 || !(pressure?.contextWindow > 0)) return null;
			const percent = Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100));
			const over = percent >= 80;
			const sys = breakdown?.systemTokens ?? 0;
			const tools = breakdown?.toolsTokens ?? 0;
			const messages = breakdown?.messageTokens ?? 0;
			const total = sys + tools + messages;
			const seg = (v) => total > 0 ? v / total * 100 : 0;
			const tipRow = (label, value, dotClass) => react.createElement("div", { className: "gsh-ctx-tip-row" },
				react.createElement("span", { className: `gsh-ctx-tip-dot ${dotClass}` }),
				label,
				react.createElement("span", { className: "gsh-ctx-tip-val" }, formatTokens(value)));
			return react.createElement("div", { className: "gsh-ctx-wrap" },
				react.createElement("div", { className: "gsh-inst-head" },
					react.createElement("span", { className: "gsh-title" }, L.occupancy),
					react.createElement("span", { className: "gsh-value" }, `${percent}%`)),
				react.createElement("div", { className: "gsh-track" },
					over
						? react.createElement("div", { className: "gsh-fill gsh-ctx-red", style: { width: `${percent}%` } })
						: react.createElement("div", { className: "gsh-ctx-segs", style: { width: `${percent}%` } },
							sys > 0 && react.createElement("div", { className: "gsh-fill gsh-ctx-sys", style: { flexGrow: seg(sys) } }),
							tools > 0 && react.createElement("div", { className: "gsh-fill gsh-ctx-tools", style: { flexGrow: seg(tools) } }),
							messages > 0 && react.createElement("div", { className: "gsh-fill gsh-ctx-msg", style: { flexGrow: seg(messages) } }))),
				react.createElement("div", { className: "gsh-ctx-tip" },
					tipRow(L.sysPrompt, sys, "gsh-ctx-tip-dot-sys"),
					tipRow(L.toolsSeg, tools, "gsh-ctx-tip-dot-tools"),
					tipRow(L.messagesSeg, messages, "gsh-ctx-tip-dot-msg")));
		}
		//#endregion
		//#region rolling counter
		const DRUM = "012345678901234567890123456789";
		const DRUM_H = 15;
		/**
		 * Odometer-style rolling value: each digit is a drum of 0-9; digits roll
		 * upward on increase (carry wraps through 9→0) and downward on decrease.
		 * On first mount every drum spins up from 0 to its digit. Non-digit
		 * characters ('.', 'K', 'M') are static cells. Drum windows are shaded
		 * top/bottom and banded so the motion reads as a mechanical counter.
		 */
		function RollingValue({ value }) {
			const [spun, setSpun] = react.useState(false);
			react.useEffect(() => {
				setSpun(true);
			}, []);
			const ref = react.useRef(null);
			if (ref.current === null) ref.current = { prevValue: value, prevText: null };
			const text = formatTokens(value);
			const state = ref.current;
			const dir = value >= state.prevValue ? "up" : "down";
			const prevDigits = state.prevText === null ? null : (state.prevText.match(/\d/g) ?? null);
			const digits = text.match(/\d/g) ?? [];
			const digitCount = digits.length;
			let seen = 0;
			const cells = [...text].map((ch) => {
				if (/\d/.test(ch)) {
					const fromRight = digitCount - 1 - seen;
					seen += 1;
					const digit = Number(ch);
					let prevDigit;
					if (!spun && state.prevText === null) {
						prevDigit = 0; // mount: spin up from zero
					} else if (prevDigits !== null && prevDigits[prevDigits.length - 1 - fromRight] !== void 0) {
						prevDigit = Number(prevDigits[prevDigits.length - 1 - fromRight]);
					} else {
						prevDigit = digit;
					}
					let idx = 10 + digit;
					if (dir === "up" && prevDigit > digit) idx += 10;
					if (dir === "down" && prevDigit < digit) idx -= 10;
					const start = !spun && state.prevText === null ? -(10 * DRUM_H) : void 0;
					return { type: "digit", ch, idx, start };
				}
				return { type: "static", ch };
			});
			state.prevValue = value;
			state.prevText = text;
			return react.createElement("span", { className: "gsh-roll-value" },
				cells.map((cell, i) => cell.type === "digit"
					? react.createElement("span", { key: i, className: "gsh-drum" },
						react.createElement("span", {
							className: "gsh-strip",
							style: { transform: `translateY(${(cell.start ?? -cell.idx * DRUM_H)}px)` }
						}, [...DRUM].map((d, k) => react.createElement("span", { key: k, className: "gsh-drum-digit" }, d))))
					: react.createElement("span", { key: i, className: "gsh-char" }, cell.ch)));
		}
		/** Three rolling-token rows: CACHE HIT / CACHE MISSED / OUTPUT. */
		function RollingTokens({ hit, missed, output }) {
			return react.createElement("div", { className: "gsh-roll" },
				react.createElement("div", { className: "gsh-roll-row" },
					react.createElement("span", { className: "gsh-roll-label gsh-roll-hit" }, L.cacheHitRow),
					react.createElement(RollingValue, { value: hit })),
				react.createElement("div", { className: "gsh-roll-row" },
					react.createElement("span", { className: "gsh-roll-label gsh-roll-miss" }, L.cacheMissed),
					react.createElement(RollingValue, { value: missed })),
				react.createElement("div", { className: "gsh-roll-row" },
					react.createElement("span", { className: "gsh-roll-label gsh-roll-out" }, L.output),
					react.createElement(RollingValue, { value: output })));
		}
		//#endregion
		//#region panel
		/**
		 * Responsive tier.
		 * The window width decides the floor (never vanish on a normal desktop
		 * window), the measured free space right of the chat column only decides
		 * full vs mini (the full panel needs 164px + 12px margin = 176px):
		 *   width < 800        → hidden (too cramped even for the mini strip)
		 *   space >= 180       → full
		 *   otherwise          → mini (even if the strip slightly overlaps the
		 *                        chat on narrow windows — it is click-through)
		 */
		function tierOf(space, width) {
			if (width < 800) return "hidden";
			return space >= 180 ? "full" : "mini";
		}
		/**
		 * Locate the centered composer card from any element inside its bar.
		 * The dock slot renders as a SIBLING of the card (both children of the
		 * full-width composer bar), so `closest()` can never find the card —
		 * walk up until an ancestor contains it.
		 */
		function findComposerCard(el) {
			let node = el;
			while (node !== null && node !== document.body && node !== document.documentElement) {
				const card = node.querySelector("[data-composer-card]");
				if (card !== null) return card;
				node = node.parentElement;
			}
			return null;
		}
		/**
		 * Measure the free space right of the chat column (anchor = the centered
		 * composer card). Falls back to "full" whenever the anchor cannot be
		 * found or anything throws, so the HUD can never disappear because of a
		 * measurement failure.
		 */
		function useTier(rootRef) {
			const [tier, setTier] = react.useState("full");
			const [space, setSpace] = react.useState(null);
			react.useLayoutEffect(() => {
				let ro = null;
				const measure = () => {
					const el = rootRef.current;
					const anchor = el === null ? null : findComposerCard(el)
						?? el.closest('[data-slot="conversation.composer.dock"]')?.parentElement
						?? null;
					const rect = anchor === null ? null : anchor.getBoundingClientRect();
					const space = rect === null ? Number.POSITIVE_INFINITY : Math.max(0, window.innerWidth - rect.right);
					setSpace(space);
					setTier(tierOf(space, window.innerWidth));
				};
				const cleanup = () => {
					ro?.disconnect();
					window.removeEventListener("resize", measure);
				};
				try {
					measure();
					if (typeof ResizeObserver !== "undefined") {
						ro = new ResizeObserver(measure);
						const anchor = rootRef.current === null ? null : findComposerCard(rootRef.current);
						if (anchor !== null) ro.observe(anchor);
						ro.observe(document.body);
					}
					window.addEventListener("resize", measure);
				} catch (error) {
					console.error("[dsh-stats-hud] tier measurement failed:", error);
					setTier("full");
				}
				return cleanup;
			}, [rootRef]);
			return [tier, space];
		}
		/** One compact rolling row for the mini tier (short label + drums). */
		function MiniRow({ label, value, cls }) {
			return react.createElement("div", { className: "gsh-roll-row" },
				react.createElement("span", { className: `gsh-roll-label ${cls}` }, label),
				react.createElement(RollingValue, { value }));
		}
		const GameStatsPanel = react.memo(function GameStatsPanel({ useSession, useProjection }) {
			const usage = useProjection("tokenUsage");
			const stats = useProjection("sessionStats");
			const pressure = useProjection("contextPressure");
			const breakdown = useProjection("contextBreakdown");
			const running = useSession((s) => s.running) ?? false;
			const rootRef = react.useRef(null);
			const [tier, space] = useTier(rootRef);
			if (stats === void 0 || stats.steps <= 0) return null;
			const billed = usage !== void 0 ? billedInputTokens(usage) : 0;
			const output = usage !== void 0 ? usage.outputTokens : 0;
			if (billed <= 0 && output <= 0) return null;
			const tps = stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1e3) : 0;
			const hit = usage !== void 0 ? cacheHitPercent(usage) : null;
			const hitTokens = usage !== void 0 ? usage.cacheReadTokens : 0;
			const missedTokens = usage !== void 0 ? usage.uncachedInputTokens + usage.cacheWriteTokens : 0;
			const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens;
			const hasPressure = usedTokens !== void 0 && pressure?.contextWindow > 0;
			const mini = tier === "mini";
			return react.createElement("div", {
				ref: rootRef,
				"data-tier": tier,
				"data-space": space === null ? "" : String(Math.round(space)),
				className: `gsh-root gsh-${tier}${running ? " gsh-running" : ""}`
			},
				react.createElement(LocalClock, { mini }),
				mini
					? react.createElement(react.Fragment, null,
						react.createElement(MiniRow, { label: L.miniSteps, value: stats.steps, cls: "gsh-roll-steps" }),
						react.createElement(MiniRow, { label: L.miniTurn, value: stats.turns, cls: "gsh-roll-turn" }),
						react.createElement(MiniRow, { label: L.miniHit, value: hitTokens, cls: "gsh-roll-hit" }),
						react.createElement(MiniRow, { label: L.miniMiss, value: missedTokens, cls: "gsh-roll-miss" }),
						react.createElement(MiniRow, { label: L.miniOut, value: output, cls: "gsh-roll-out" }))
					: react.createElement(react.Fragment, null,
						react.createElement(MissionRolling, { steps: stats.steps, turns: stats.turns }),
						react.createElement(ChannelBar, { llmMs: stats.llmMs, toolMs: stats.toolMs }),
						react.createElement(SpeedGauge, { tps }),
						hasPressure ? react.createElement(ContextUsageBar, { pressure, breakdown }) : null,
						hit !== null ? react.createElement(PercentBar, { label: L.cacheHit, percent: hit }) : null,
						react.createElement("div", { className: "gsh-inst" },
							react.createElement("div", { className: "gsh-inst-head" },
								react.createElement("span", { className: "gsh-title" }, L.context)),
							react.createElement(RollingTokens, { hit: hitTokens, missed: missedTokens, output }))));
		});
		//#endregion
		//#region registration
		/** Services the plugin's apply reads off ctx (the context proxy throws on undeclared access). */
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.register({
				name: "conversation.composer.dock",
				id: "dsh-stats-hud",
				order: 1
			}, GameStatsPanel);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
