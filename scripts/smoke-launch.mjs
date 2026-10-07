import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const timeoutMs = Number(process.env.SMOKE_LAUNCH_TIMEOUT_MS ?? 90_000);

function executableFor(target) {
  if (!target.endsWith(".app")) return target;
  const plist = path.join(target, "Contents", "Info.plist");
  const name = execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", plist], { encoding: "utf8" }).trim();
  return path.join(target, "Contents", "MacOS", name);
}

async function pageTarget(port) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find((target) => target.type === "page") ?? null;
  } catch {
    return null;
  }
}

const target = process.argv[2];
if (!target) throw new Error("Usage: node scripts/smoke-launch.mjs <path to .app or executable>");

const executable = executableFor(path.resolve(target));
const userDataDir = mkdtempSync(path.join(tmpdir(), "nextbrowser-smoke-"));
const child = spawn(executable, [`--user-data-dir=${userDataDir}`, "--remote-debugging-port=0"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
let port = null;
let exited = null;
const exitedPromise = new Promise((resolve) => child.on("exit", (code, signal) => resolve((exited = { code, signal }))));
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output += chunk;
    port ??= output.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//)?.[1] ?? null;
  });
}

let page = null;
const deadline = Date.now() + timeoutMs;
while (!exited && !page && Date.now() < deadline) {
  if (port) page = await pageTarget(port);
  if (!page) await new Promise((resolve) => setTimeout(resolve, 500));
}

const crashed = exited;
if (!crashed) child.kill();
await Promise.race([exitedPromise, new Promise((resolve) => setTimeout(resolve, 10_000))]);
try {
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
} catch {
  // Windows helpers can hold profile files a moment after the main process exits.
}

if (!page) {
  const reason = crashed
    ? `exited during startup (code ${crashed.code}, signal ${crashed.signal})`
    : `opened no window within ${timeoutMs} ms`;
  process.stderr.write(`${path.basename(executable)} ${reason}.\n${output.slice(-4000)}\n`);
  process.exit(1);
}
process.stdout.write(`${path.basename(executable)} opened ${page.url}\n`);
