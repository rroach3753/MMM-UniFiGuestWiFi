const test = require("node:test");
const assert = require("node:assert/strict");

let moduleDefinition;
global.Module = {
  register(name, definition) {
    assert.equal(name, "MMM-UniFiGuestWiFi");
    moduleDefinition = definition;
  }
};

require("../MMM-UniFiGuestWiFi");
delete global.Module;

function createModule(config) {
  return {
    ...moduleDefinition,
    config: {
      ...moduleDefinition.defaults,
      ...config
    },
    instanceId: "module_1"
  };
}

test("backend payload omits all server policy and controller authentication fields", () => {
  const moduleInstance = createModule({
    authMode: "api",
    site: "attacker-site",
    verifySSL: false,
    controllerUrl: "https://attacker.example",
    username: "renderer-user",
    controllerPassword: "renderer-password",
    passwordField: "legacy-password",
    apiKey: "renderer-key",
    apiKeyHeader: "X-Custom-Key",
    password: "wifi-password",
    showPassword: true,
    includeHotspotPassword: true
  });

  const payload = moduleInstance.getBackendConfig();

  [
    "controllerUrl",
    "username",
    "controllerPassword",
    "passwordField",
    "apiKey",
    "apiKeyHeader",
    "authMode",
    "site",
    "verifySSL",
    "showPassword",
    "includeHotspotPassword"
  ].forEach((field) => assert.equal(Object.hasOwn(payload, field), false));
  assert.equal(payload.instanceId, "module_1");
  assert.equal(payload.password, "wifi-password");
});

test("WiFi password remains available for config-mode fallback processing", () => {
  const moduleInstance = createModule({
    authMode: "config",
    password: "wifi-password",
    isHidden: true
  });

  const payload = moduleInstance.getBackendConfig();

  assert.equal(payload.password, "wifi-password");
  assert.equal(payload.isHidden, true);
  assert.equal(Object.hasOwn(payload, "controllerPassword"), false);
});
