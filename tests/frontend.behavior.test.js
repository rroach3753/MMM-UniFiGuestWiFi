const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

test("QR color options reach the backend without exposing server policy", () => {
  const moduleInstance = createModule({ colorDark: "#123456", colorLight: "#abcdef" });
  assert.equal(moduleInstance.getBackendConfig().colorDark, "#123456");
  assert.equal(moduleInstance.getBackendConfig().colorLight, "#abcdef");
});

test("styles stay scoped to the guest WiFi module", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "MMM-UniFiGuestWiFi.css"), "utf8");
  for (const match of css.matchAll(/(?:^|[{},])\s*(\.[\w-][^{},]*)\s*(?=[{,])/g)) {
    assert.ok(match[1].startsWith(".mmm-unifi-guestwifi"), match[1]);
  }
});

test("renders the active voucher or the guest portal password fallback", () => {
  const originalDocument = global.document;
  global.document = {
    createElement() {
      return {
        children: [],
        textContent: "",
        appendChild(child) { this.children.push(child); }
      };
    }
  };
  const moduleInstance = createModule({ includeHotspotPassword: true });
  moduleInstance.updateDom = () => {};
  function text(element) {
    return element ? [element.textContent, ...element.children.map(text)].join(" ") : "";
  }
  try {
    moduleInstance.socketNotificationReceived("UNIFI_GUESTWIFI_DATA", {
      instanceId: "module_1", ssid: "Discovered Hotspot", qrString: "WIFI:S:Discovered Hotspot;;",
      voucherCode: "guest-voucher", voucherStatus: "active", hotspotPassword: null
    });
    assert.match(text(moduleInstance.createVoucherSection()), /guest-voucher/);
    assert.doesNotMatch(text(moduleInstance.createQRCodeSection()), /Portal Password:/);
    moduleInstance.socketNotificationReceived("UNIFI_GUESTWIFI_DATA", {
      instanceId: "module_1", ssid: "Renamed Hotspot", qrString: "WIFI:S:Renamed Hotspot;;",
      voucherCode: null, voucherStatus: "none", hotspotPassword: "guest-portal-password"
    });
    assert.match(text(moduleInstance.createQRCodeSection()), /Portal Password: guest-portal-password/);
    assert.doesNotMatch(text(moduleInstance.createVoucherSection()), /guest-voucher/);
    moduleInstance.socketNotificationReceived("UNIFI_GUESTWIFI_DATA", {
      instanceId: "module_1", ssid: "Working WiFi", warning: "Unable to retrieve vouchers.",
      voucherStatus: "unavailable"
    });
    assert.match(text(moduleInstance.getDom()), /Unable to retrieve vouchers/);
    assert.match(text(moduleInstance.getDom()), /Working WiFi/);
    moduleInstance.stop();
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});
