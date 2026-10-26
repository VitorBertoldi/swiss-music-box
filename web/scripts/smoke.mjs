// Visual smoke test: renders every scene and some street-level views in headless Chrome.
//
//   npx vite --port 5173 &      (the dev server supports the range requests PMTiles needs)
//   node scripts/smoke.mjs http://localhost:5173/ ../explorations/screens
//
// Talks to Chrome over the DevTools protocol (Node >= 22 has a global WebSocket), so it
// needs no test framework. Prints console errors and the frame rate of each shot.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9333;
const VIEWPORTS = [
	{ name: "1080p", width: 1920, height: 1080 },
	{ name: "4k", width: 3840, height: 2160 },
];
/**
 * Each shot: an optional `?view=` (longitude,latitude,zoom,pitch,bearing), the keys to press
 * (scene number, camera letter, P for projector), and the timetable minute to play from.
 * A `still` shot is paused at exactly that minute, so a close-up finds its vehicle.
 */
const SHOTS = [
	{ name: "living-map-0730", keys: ["1", "o"], minute: 450 },
	{ name: "living-map-1700", keys: ["1", "o"], minute: 1020 },
	{ name: "long-exposure-1700", keys: ["2", "o"], minute: 1020 },
	{ name: "calibration", keys: ["3", "o"], minute: 450 },
	{ name: "street-zurich-hb", view: "8.5402,47.3779,16,60,-30", keys: ["1"], minute: 450 },
	{ name: "street-bern", view: "7.4392,46.949,15.5,55,20", keys: ["1"], minute: 780 },
	{ name: "gotthard-north-portal", view: "8.66,46.82,13.5,45,160", keys: ["1"], minute: 1020 },
	{ name: "follow-a-train", view: "7.4392,46.949,13,0,0", keys: ["1", "g"], minute: 480 },
	{ name: "tour-projector-0700", keys: ["1", "t", "p"], minute: 420 },
	{ name: "terrain-alps", view: "7.98,46.58,13,70,160", keys: ["1"], minute: 450, still: true },
	// Vehicle kinds up close at 12:08, each view centred on a vehicle of that kind in the 21 Oct data.
	{ name: "kind-ic-train", view: "8.49324,47.39049,16.5,60,-70", keys: ["1"], minute: 728, still: true },
	{ name: "kind-ic-train-z15-top", view: "8.49324,47.39049,15,0,0", keys: ["1"], minute: 728, still: true },
	{ name: "kind-ic-train-flat", view: "8.49324,47.39049,16.5,60,-70", keys: ["1", "e"], minute: 728, still: true },
	{ name: "kind-ic-train-z18", view: "8.49324,47.39049,18.5,62,-40", keys: ["1"], minute: 728, still: true },
	{ name: "kind-boat", view: "8.54956,47.33436,16.5,55,165", keys: ["1"], minute: 728, still: true },
	{ name: "kind-cable-car", view: "8.01392,46.62175,17.5,65,-150", keys: ["1"], minute: 728, still: true },
	{ name: "kind-funicular", view: "7.67875,46.64029,17,60,-103", keys: ["1"], minute: 728, still: true },
];
/** `SMOKE_ONLY=kind-` renders only the shots whose name starts with that, for quick iteration. */
const ONLY = process.env.SMOKE_ONLY ?? "";
const PLAY_MS = 2500; // long enough for trails to form and the scene crossfade to finish
const STILL_PLAY_MS = 500; // a still shot plays briefly first: the first Play starts the outputs

const [, , url = "http://localhost:4173/", outDir = "screens"] = process.argv;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
	mkdirSync(outDir, { recursive: true });
	const chrome = spawn(
		CHROME,
		[
			"--headless=new",
			`--remote-debugging-port=${DEBUG_PORT}`,
			"--enable-unsafe-swiftshader",
			"--autoplay-policy=no-user-gesture-required",
			"--user-data-dir=/tmp/smb-smoke-profile",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	try {
		const page = await connect();
		await page.send("Runtime.enable");
		await page.send("Page.enable");
		for (const viewport of VIEWPORTS) {
			await page.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
			for (const shot of SHOTS.filter((candidate) => candidate.name.startsWith(ONLY))) {
				const address = shot.view === undefined ? url : `${url}?view=${shot.view}`;
				await page.send("Page.navigate", { url: address });
				await waitFor(
					page,
					"document.querySelector('#stage canvas') !== null && document.getElementById('scenes').children.length > 0",
				);
				await page.evaluate("document.body.classList.add('hide-panel')");
				for (const key of shot.keys) await page.key(key);
				await shoot(page, viewport, shot);
			}
		}
		console.log(page.errors.length ? `console errors:\n  ${page.errors.join("\n  ")}` : "no console errors");
		process.exitCode = page.errors.length ? 1 : 0;
	} finally {
		chrome.kill();
	}
}

async function shoot(page, viewport, shot) {
	await seek(page, shot.minute);
	await page.key(" ");
	if (shot.still) {
		await sleep(STILL_PLAY_MS);
		await page.key(" ");
		await seek(page, shot.minute);
	}
	await sleep(PLAY_MS);
	const readout = await page.evaluate(
		"[document.getElementById('clock').textContent, document.getElementById('rate').textContent, document.getElementById('caption').textContent].join(' ')",
	);
	const fps = await page.evaluate(
		"new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => (++n, performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(n)); requestAnimationFrame(f); })",
	);
	const file = join(outDir, `${shot.name}-${viewport.name}.png`);
	const { data } = await page.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(file, Buffer.from(data, "base64"));
	console.log(`${file}  ${readout}  ${fps} fps (software WebGL)`);
}

async function seek(page, minute) {
	await page.evaluate(`(() => {
		const scrub = document.getElementById("scrub");
		scrub.value = ${minute};
		scrub.dispatchEvent(new Event("change"));
	})()`);
}

async function connect() {
	let target;
	for (let attempt = 0; attempt < 50 && !target; attempt++) {
		await sleep(200);
		try {
			const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
			target = targets.find((candidate) => candidate.type === "page");
		} catch {
			// Chrome is still starting.
		}
	}
	if (!target) throw new Error("Chrome did not start");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve) => socket.addEventListener("open", resolve));
	let nextId = 0;
	const pending = new Map();
	const errors = [];
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		pending.get(message.id)?.(message);
		pending.delete(message.id);
		if (message.method === "Runtime.exceptionThrown")
			errors.push(message.params.exceptionDetails.exception?.description ?? "exception");
		if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
			errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
		}
	});
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			const id = ++nextId;
			pending.set(id, (message) => resolve(message.result ?? {}));
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) =>
		(await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result
			?.value;
	const key = async (text) => {
		const code = text === " " ? "Space" : /\d/.test(text) ? `Digit${text}` : `Key${text.toUpperCase()}`;
		await send("Input.dispatchKeyEvent", { type: "keyDown", key: text, code, text });
		await send("Input.dispatchKeyEvent", { type: "keyUp", key: text, code });
	};
	return { send, evaluate, key, errors };
}

async function waitFor(page, condition, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	while (!(await page.evaluate(condition))) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for: ${condition}`);
		await sleep(250);
	}
}

await main();
