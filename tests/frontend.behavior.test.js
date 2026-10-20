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

test("renders WiFi standard and encryption without a separator vertically and on separate horizontal rows", () => {
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
  function text(element) {
    return element ? [element.textContent, ...element.children.map(text)].join(" ") : "";
  }
  function findByClass(element, className) {
    if (element.className === className) return element;
    for (const child of element.children) {
      const match = findByClass(child, className);
      if (match) return match;
    }
    return null;
  }

  try {
    for (const layoutVertical of [true, false]) {
      const moduleInstance = createModule({ layoutVertical });
      moduleInstance.dataState = {
        loading: false,
        ssid: "Guest Network",
        securityType: "WPA2",
        wifiStandard: "WiFi 6"
      };

      const dom = moduleInstance.getDom();
      const securityMetaRow = findByClass(dom, "security-meta-row");
      const securityMetaText = text(securityMetaRow);

      assert.match(text(dom), /Network: Guest Network/);
      assert.match(securityMetaText, /WiFi Standard: WiFi 6/);
      assert.match(securityMetaText, /WiFi Encryption: WPA2/);
      assert.equal(securityMetaRow.children[0].className, "security-meta-item wifi-standard-row");
      assert.doesNotMatch(securityMetaText, /\|/);
      if (layoutVertical) {
        assert.equal(securityMetaRow.children.length, 2);
        assert.equal(securityMetaRow.children[1].className, "security-meta-item security-row");
      } else {
        assert.equal(securityMetaRow.children.length, 2);
        assert.equal(securityMetaRow.children[1].className, "security-meta-item security-row");
      }
      moduleInstance.stop();
    }
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});

test("places the voucher or password fallback beside horizontal network details", () => {
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
  function text(element) {
    return element ? [element.textContent, ...element.children.map(text)].join(" ") : "";
  }
  function findByClass(element, className) {
    if (element.className === className) return element;
    for (const child of element.children) {
      const match = findByClass(child, className);
      if (match) return match;
    }
    return null;
  }

  try {
    const moduleInstance = createModule({
      layoutVertical: false,
      includeHotspotPassword: true
    });

    moduleInstance.dataState = {
      loading: false,
      ssid: "Guest Network",
      securityType: "WPA2",
      wifiStandard: "WiFi 6",
      voucherCode: "guest-voucher",
      hotspotPassword: null,
      qrString: "WIFI:S:Guest Network;;"
    };
    let dom = moduleInstance.getDom();
    let infoSection = findByClass(dom, "info-section");
    let voucherSection = findByClass(infoSection, "voucher-section");

    assert.ok(voucherSection);
    assert.match(text(infoSection), /Voucher Code: guest-voucher/);
    assert.equal(voucherSection.children[0].textContent, "Voucher Code:");
    assert.equal(voucherSection.children[1].className, "voucher-code");
    assert.equal(findByClass(dom, "qr-section").children.some((child) => /Portal Password:/.test(text(child))), false);

    moduleInstance.dataState.voucherCode = null;
    moduleInstance.dataState.hotspotPassword = "guest-portal-password";
    dom = moduleInstance.getDom();
    infoSection = findByClass(dom, "info-section");
    voucherSection = findByClass(infoSection, "voucher-section");

    assert.ok(voucherSection);
    assert.match(text(voucherSection), /Password: guest-portal-password/);
    assert.equal(voucherSection.children[0].textContent, "Password:");
    assert.equal(voucherSection.children[1].className, "voucher-code");
    assert.doesNotMatch(text(findByClass(dom, "qr-section")), /guest-portal-password/);
    moduleInstance.stop();
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});
