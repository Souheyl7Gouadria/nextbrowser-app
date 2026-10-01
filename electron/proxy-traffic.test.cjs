const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { configPath, loadBackendConfig, normalizeAPIBaseURL, sendNodeMavenInvite } = require("./proxy-traffic.cjs");

async function tempHome(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-proxy-traffic-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, ".config", "clawbrowser"), { recursive: true });
  return homeDir;
}

async function writeConfig(homeDir, payload) {
  await fs.writeFile(
    configPath({ homeDir, platform: "darwin", env: {} }),
    JSON.stringify(payload),
    { mode: 0o600 },
  );
}

test("loads the backend key without exposing it to the renderer", async (t) => {
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "private-key", api_base_url: "https://api.example.test/" });

  assert.deepEqual(await loadBackendConfig({ homeDir, platform: "darwin", env: {} }), {
    apiKey: "private-key",
    baseURL: "https://api.example.test",
  });
});

test("loads the key from the isolated Nextbrowser config directory", async (t) => {
  const homeDir = await tempHome(t);
  const nextbrowserConfigDir = path.join(homeDir, "Nextbrowser", "runtime", "config");
  await fs.mkdir(nextbrowserConfigDir, { recursive: true });
  await fs.writeFile(
    path.join(nextbrowserConfigDir, "config.json"),
    JSON.stringify({ api_key: "nextbrowser-key" }),
    { mode: 0o600 },
  );

  const config = await loadBackendConfig({
    homeDir,
    platform: "darwin",
    env: { NEXTBROWSER_CONFIG_DIR: nextbrowserConfigDir },
  });

  assert.equal(config.apiKey, "nextbrowser-key");
  assert.equal(config.baseURL, "https://api.nextbrowser.com");
});

test("normalizes the legacy dashboard host and rejects non-http URLs", () => {
  assert.equal(normalizeAPIBaseURL("https://app.nextbrowser.com/"), "https://api.nextbrowser.com");
  assert.throws(() => normalizeAPIBaseURL("file:///tmp/config.json"), /Unsupported Nextbrowser API URL/);
  assert.throws(() => normalizeAPIBaseURL("https://user:password@api.example.test"), /Unsupported Nextbrowser API URL/);
});

test("sends an invite through the authenticated backend without exposing the key to the renderer", async (t) => {
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "private-key", api_base_url: "https://api.example.test/" });
  let calls = 0;
  const result = await sendNodeMavenInvite({
    homeDir, platform: "darwin", env: {},
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://api.example.test/v1/proxy/traffic/invite");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.authorization, "Bearer private-key");
      assert.equal(options.body, undefined);
      return { ok: true, status: 200, json: async () => ({ email: "customer@example.com", invite_sent: true, expires_in_days: 7 }) };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { email: "customer@example.com", expiresInDays: 7 });
});

test("does not retry an invite during NodeMaven cooldown", async (t) => {
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "private-key" });
  let calls = 0;
  await assert.rejects(sendNodeMavenInvite({
    homeDir, platform: "darwin", env: {},
    fetchImpl: async () => { calls += 1; return { status: 429, ok: false }; },
  }), /10 minutes/);
  assert.equal(calls, 1);
});

test("offers password setup when NodeMaven has not enabled reseller invitations", async (t) => {
  const homeDir = await tempHome(t);
  await writeConfig(homeDir, { api_key: "private-key" });
  await assert.rejects(sendNodeMavenInvite({
    homeDir, platform: "darwin", env: {},
    fetchImpl: async () => ({ status: 503, ok: false, json: async () => ({ code: "invite_disabled" }) }),
  }), /not enabled yet/);
});
