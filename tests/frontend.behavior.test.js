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

test("API backend payload omits controller URL and authentication fields", () => {
  const moduleInstance = createModule({
    authMode: "api",
    controllerUrl: "https://attacker.example",
    username: "renderer-user",
    controllerPassword: "renderer-password",
    passwordField: "legacy-password",
    apiKey: "renderer-key",
    apiKeyHeader: "X-Custom-Key",
    password: "wifi-password"
  });

  const payload = moduleInstance.getBackendConfig();

  [
    "controllerUrl",
    "username",
    "controllerPassword",
    "passwordField",
    "apiKey",
    "apiKeyHeader",
    "password"
  ].forEach((field) => assert.equal(Object.hasOwn(payload, field), false));
  assert.equal(payload.instanceId, "module_1");
  assert.equal(payload.authMode, "api");
});

test("config mode retains WiFi password for backend QR generation", () => {
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
