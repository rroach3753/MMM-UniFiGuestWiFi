const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const Module = require("node:module");
const https = require("node:https");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "node_helper") {
    return {
      create(definition) {
        return definition;
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const helper = require("../node_helper");
Module._load = originalLoad;

test("malformed socket configurations produce sanitized errors instead of rejected promises", async () => {
  const originalSend = helper.sendSocketNotification;
  const sent = [];
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
  try {
    for (const payload of [
      [],
      { instanceId: { toString: null } },
      { ssid: { toString: null } },
      { requestTimeout: { valueOf: null, toString: null } }
    ]) {
      await assert.doesNotReject(helper.handleConfig(payload));
      assert.equal(sent.at(-1).notification, "UNIFI_GUESTWIFI_ERROR");
      assert.equal(sent.at(-1).payload.error, "Unable to retrieve UniFi guest WiFi details.");
    }
  } finally {
    helper.sendSocketNotification = originalSend;
  }
});

test("socket configurations retain at most sixteen polls and coalesce duplicate work", async () => {
  const originalNormalize = helper.normalizeConfig;
  const originalFetch = helper.getAPIBasedWiFi;
  const originalSchedule = helper.scheduleRefresh;
  const originalSend = helper.sendSocketNotification;
  const completions = [];
  const sent = [];
  helper.refreshTimers = Object.create(null);
  helper.requestStates = new Map();
  helper.normalizeConfig = (config) => ({ ...config, authMode: "api", refreshInterval: 60000 });
  helper.getAPIBasedWiFi = () => new Promise((resolve) => completions.push(resolve));
  helper.scheduleRefresh = () => {};
  helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
  try {
    const pending = [];
    for (let index = 0; index < 18; index++) {
      pending.push(helper.handleConfig({ instanceId: `instance-${index}` }));
    }
    await helper.handleConfig({ instanceId: "instance-0" });
    assert.equal(helper.requestStates.size, 16);
    assert.equal(completions.length, 16);
    completions.forEach((complete) => complete({ ssid: "Guest" }));
    await Promise.all(pending);
    await helper.handleConfig({ instanceId: "instance-0", ssid: "Attacker" });
    assert.equal(completions.length, 16);
    assert.equal(sent.at(-1).payload.ssid, "Guest");
    const refresh = helper.handleConfig({ instanceId: "instance-0" }, true);
    assert.equal(completions.length, 17);
    await helper.handleConfig({ instanceId: "instance-0" }, true);
    assert.equal(completions.length, 17);
    completions.at(-1)({ ssid: "Updated Guest" });
    await refresh;
    assert.equal(sent.at(-1).payload.ssid, "Updated Guest");
    const stoppedRefresh = helper.handleConfig({ instanceId: "instance-0" }, true);
    const beforeStop = sent.length;
    helper.stop();
    completions.at(-1)({ ssid: "Stale" });
    await stoppedRefresh;
    assert.equal(sent.length, beforeStop);
    assert.equal(helper.requestStates.size, 0);
  } finally {
    helper.normalizeConfig = originalNormalize;
    helper.getAPIBasedWiFi = originalFetch;
    helper.scheduleRefresh = originalSchedule;
    helper.sendSocketNotification = originalSend;
    helper.requestStates = new Map();
  }
});

test("guest passwords use automatic controller discovery without a fixed SSID in API and auto modes", async () => {
  const names = ["UNIFI_GUEST_WIFI_AUTH_MODE", "UNIFI_GUEST_WIFI_URL",
    "UNIFI_GUEST_WIFI_ALLOW_WIFI_PASSWORD"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = helper.fetchFirstSuccessfulNetworkRecords;
  const originalStandard = helper.mapWiFiStandard;
  process.env.UNIFI_GUEST_WIFI_AUTH_MODE = "api";
  process.env.UNIFI_GUEST_WIFI_URL = "https://trusted.example";
  process.env.UNIFI_GUEST_WIFI_ALLOW_WIFI_PASSWORD = "true";
  let guestName = "Trusted Guest";
  helper.fetchFirstSuccessfulNetworkRecords = async () => [
    { name: "Private Staff", purpose: "corporate", passwd: "staff-secret" },
    { name: "TRUSTED GUEST", purpose: "corporate", passwd: "wrong-case-secret" },
    { name: guestName, portal_enabled: true, passwd: "guest-secret" }
  ];
  helper.mapWiFiStandard = async () => null;
  try {
    for (const mode of ["api", "auto"]) {
      process.env.UNIFI_GUEST_WIFI_AUTH_MODE = mode;
      const config = helper.normalizeConfig({ ssid: "Private Staff", apiSsid: "Private Staff" });
      assert.equal(Object.hasOwn(config, "apiSsid"), false);
      const wifi = await helper.getAPIBasedWiFi(config);
      assert.equal(wifi.ssid, guestName);
      assert.equal(wifi.password, "guest-secret");
    }
    guestName = "Renamed Wireless";
    const renamed = await helper.getAPIBasedWiFi(helper.normalizeConfig({}));
    assert.equal(renamed.ssid, "Renamed Wireless");
    assert.equal(renamed.password, "guest-secret");
    const discovered = await helper.fetchHotspotOrGuestNetworks({ ssid: "Private Staff" });
    assert.deepEqual(discovered.map((network) => network.name), ["Renamed Wireless"]);
  } finally {
    helper.fetchFirstSuccessfulNetworkRecords = originalFetch;
    helper.mapWiFiStandard = originalStandard;
    Object.entries(previous).forEach(([name, value]) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});

test("active vouchers take precedence and the guest portal password is the no-voucher fallback", async () => {
  const originalVouchers = helper.fetchVoucherEndpoints;
  const originalPassword = helper.fetchHotspotPassword;
  let vouchers = [{ code: "guest-voucher", status: "active" }];
  let passwordFetches = 0;
  helper.fetchVoucherEndpoints = async () => vouchers;
  helper.fetchHotspotPassword = async () => { passwordFetches++; return "guest-portal-password"; };
  const config = { site: "default", includeVouchers: true, includeHotspotPassword: true };
  try {
    assert.deepEqual(await helper.getVoucherData(config), {
      voucherCode: "guest-voucher", voucherStatus: "active", hotspotPassword: null
    });
    assert.equal(passwordFetches, 0);
    for (const unavailable of [[], [{ code: "expired-voucher", status: "expired" }]]) {
      vouchers = unavailable;
      assert.deepEqual(await helper.getVoucherData(config), {
        voucherCode: null, voucherStatus: "none", hotspotPassword: "guest-portal-password"
      });
    }
    assert.equal(passwordFetches, 2);
  } finally {
    helper.fetchVoucherEndpoints = originalVouchers;
    helper.fetchHotspotPassword = originalPassword;
  }
});

test("portal password parsing never treats unrelated settings passwords as guest secrets", async () => {
  const originalRequest = helper.requestJson;
  const config = { site: "default", authMode: "apikey", apiKey: "server-key" };
  try {
    for (const unrelated of [
      { data: [{ key: "smtp", password: "smtp-secret" }] },
      { data: [{ password: "unscoped-secret" }] },
      { data: [{ key: "guest_access", smtp: { password: "smtp-secret" } }] }
    ]) {
      helper.requestJson = async (_method, _config, endpoint) => {
        if (endpoint.endsWith("/guest_access")) return { data: [{ key: "smtp", password: "smtp-secret" }] };
        return unrelated;
      };
      assert.equal(await helper.fetchHotspotPassword(config), null);
    }
    helper.requestJson = async (_method, _config, endpoint) => {
      if (endpoint.endsWith("/guest_access")) return {};
      return { data: [{ key: "smtp", password: "smtp-secret" }, { key: "guest_access", x_password: "portal-secret" }] };
    };
    assert.equal(await helper.fetchHotspotPassword(config), "portal-secret");
    helper.requestJson = async () => ({ data: [{ portal_customized: { password: "scoped-secret" } }] });
    assert.equal(await helper.fetchHotspotPassword(config), "scoped-secret");
  } finally {
    helper.requestJson = originalRequest;
  }
});

function mockHttpsResponse(chunks, statusCode = 200) {
  const originalRequest = https.request;

  https.request = (url, options, responseCallback) => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.headers = {};
      responseCallback(response);
      chunks.forEach((chunk) => response.emit("data", chunk));
      response.emit("end");
    };
    return request;
  };

  return () => {
    https.request = originalRequest;
  };
}

test("controller responses continue parsing below the size limit", async () => {
  const restore = mockHttpsResponse([Buffer.from('{"data":[{"name":"Guest"}]}')]);

  try {
    const response = await helper.requestJson("GET", {
      controllerUrl: "https://unifi.example",
      verifySSL: true,
      requestTimeout: 10000
    }, "/api/test");

    assert.deepEqual(response.data, [{ name: "Guest" }]);
  } finally {
    restore();
  }
});

test("controller responses reject bodies over 1 MB", async () => {
  const restore = mockHttpsResponse([Buffer.alloc(1048577, "x")]);

  try {
    await assert.rejects(
      helper.requestJson("GET", {
        controllerUrl: "https://unifi.example",
        verifySSL: true,
        requestTimeout: 10000
      }, "/api/test"),
      /Response body exceeded 1 MB limit/
    );
  } finally {
    restore();
  }
});

test("server UniFi credentials take precedence over renderer config", () => {
  const previousUsername = process.env.UNIFI_GUEST_WIFI_USERNAME;
  const previousPassword = process.env.UNIFI_GUEST_WIFI_PASSWORD;
  const previousApiKey = process.env.UNIFI_GUEST_WIFI_API_KEY;
  const previousUrl = process.env.UNIFI_GUEST_WIFI_URL;
  process.env.UNIFI_GUEST_WIFI_USERNAME = "server-user";
  process.env.UNIFI_GUEST_WIFI_PASSWORD = "server-password";
  process.env.UNIFI_GUEST_WIFI_API_KEY = "server-key";
  process.env.UNIFI_GUEST_WIFI_URL = "https://trusted.example:8443";

  try {
    const config = helper.normalizeConfig({
      controllerUrl: "https://attacker.example",
      username: "renderer-user",
      controllerPassword: "renderer-password",
      apiKey: "renderer-key"
    });

    assert.equal(config.username, "server-user");
    assert.equal(config.controllerPassword, "server-password");
    assert.equal(config.apiKey, "server-key");
    assert.equal(config.controllerUrl, "https://trusted.example:8443");
  } finally {
    const values = {
      UNIFI_GUEST_WIFI_USERNAME: previousUsername,
      UNIFI_GUEST_WIFI_PASSWORD: previousPassword,
      UNIFI_GUEST_WIFI_API_KEY: previousApiKey,
      UNIFI_GUEST_WIFI_URL: previousUrl
    };
    Object.entries(values).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

test("server UniFi login and API-key authentication reject plaintext HTTP", () => {
  const environmentNames = [
    "UNIFI_GUEST_WIFI_URL",
    "UNIFI_GUEST_WIFI_USERNAME",
    "UNIFI_GUEST_WIFI_PASSWORD",
    "UNIFI_GUEST_WIFI_API_KEY"
  ];
  const previousValues = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]])
  );
  process.env.UNIFI_GUEST_WIFI_URL = "http://unifi.local";

  try {
    process.env.UNIFI_GUEST_WIFI_USERNAME = "server-user";
    process.env.UNIFI_GUEST_WIFI_PASSWORD = "server-password";
    delete process.env.UNIFI_GUEST_WIFI_API_KEY;
    assert.throws(() => helper.normalizeConfig({}), /HTTPS origin/);

    delete process.env.UNIFI_GUEST_WIFI_USERNAME;
    delete process.env.UNIFI_GUEST_WIFI_PASSWORD;
    process.env.UNIFI_GUEST_WIFI_API_KEY = "server-key";
    assert.throws(() => helper.normalizeConfig({}), /HTTPS origin/);
  } finally {
    Object.entries(previousValues).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

test("renderer controller destinations, credentials, and policy are never trusted", () => {
  const environmentNames = [
    "UNIFI_GUEST_WIFI_USERNAME",
    "UNIFI_USERNAME",
    "UNIFI_GUEST_WIFI_PASSWORD",
    "UNIFI_PASSWORD",
    "UNIFI_GUEST_WIFI_API_KEY",
    "UNIFI_API_KEY",
    "UNIFI_GUEST_WIFI_URL",
    "UNIFI_URL",
    "UNIFI_GUEST_WIFI_AUTH_MODE",
    "UNIFI_GUEST_WIFI_SITE",
    "UNIFI_GUEST_WIFI_VERIFY_SSL",
    "UNIFI_GUEST_WIFI_ALLOW_WIFI_PASSWORD",
    "UNIFI_GUEST_WIFI_ALLOW_VOUCHERS",
    "UNIFI_GUEST_WIFI_ALLOW_HOTSPOT_PASSWORD"
  ];
  const previousValues = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]])
  );
  environmentNames.forEach((name) => delete process.env[name]);

  try {
    const config = helper.normalizeConfig({
      authMode: "config",
      controllerUrl: "https://attacker.example",
      username: "renderer-user",
      controllerPassword: "renderer-password",
      passwordField: "legacy-password",
      apiKey: "renderer-key",
      site: "attacker-site",
      verifySSL: false,
      showPassword: true,
      includeHotspotPassword: true
    });

    assert.equal(config.authMode, "config");
    assert.equal(config.controllerUrl, "");
    assert.equal(config.username, "");
    assert.equal(config.controllerPassword, "");
    assert.equal(config.passwordField, "");
    assert.equal(config.apiKey, "");
    assert.equal(config.site, "default");
    assert.equal(config.verifySSL, true);
    assert.equal(config.showPassword, false);
    assert.equal(config.includeVouchers, false);
    assert.equal(config.includeHotspotPassword, false);
  } finally {
    Object.entries(previousValues).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

test("server UniFi credentials require a trusted server URL", () => {
  const previousUsername = process.env.UNIFI_GUEST_WIFI_USERNAME;
  const previousUrl = process.env.UNIFI_GUEST_WIFI_URL;
  const previousSharedUrl = process.env.UNIFI_URL;
  process.env.UNIFI_GUEST_WIFI_USERNAME = "server-user";
  delete process.env.UNIFI_GUEST_WIFI_URL;
  delete process.env.UNIFI_URL;

  try {
    assert.throws(
      () => helper.normalizeConfig({ controllerUrl: "https://attacker.example" }),
      /UNIFI_GUEST_WIFI_URL or UNIFI_URL is required/
    );
  } finally {
    const values = {
      UNIFI_GUEST_WIFI_USERNAME: previousUsername,
      UNIFI_GUEST_WIFI_URL: previousUrl,
      UNIFI_URL: previousSharedUrl
    };
    Object.entries(values).forEach(([name, value]) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

test("refresh intervals are finite integers clamped to safe bounds", () => {
      assert.equal(helper.normalizeConfig({ refreshInterval: 1 }).refreshInterval, 60000);
      assert.equal(helper.normalizeConfig({ refreshInterval: 60000.9 }).refreshInterval, 60000);
      assert.equal(helper.normalizeConfig({ refreshInterval: 90000 }).refreshInterval, 90000);
      assert.equal(helper.normalizeConfig({ refreshInterval: Infinity }).refreshInterval, 300000);
      assert.equal(helper.normalizeConfig({ refreshInterval: 999999999 }).refreshInterval, 86400000);
});

test("refresh timers are replaced by stable instance ID", () => {
      const originalSetTimeout = global.setTimeout;
      const originalClearTimeout = global.clearTimeout;
      const createdTimers = [];
      const clearedTimers = [];

      global.setTimeout = (callback, interval) => {
        const timer = { callback, interval, id: createdTimers.length + 1 };
        createdTimers.push(timer);
        return timer;
      };
      global.clearTimeout = (timer) => clearedTimers.push(timer);
      helper.refreshTimers = {};

      try {
        helper.scheduleRefresh({
          instanceId: "module_1",
          controllerUrl: "https://trusted.example",
          site: "default",
          ssid: "First"
        }, 1);
        helper.scheduleRefresh({
          instanceId: "module_1",
          controllerUrl: "https://trusted.example",
          site: "changed",
          ssid: "Second"
        }, 999999999);

        assert.deepEqual(Object.keys(helper.refreshTimers), ["module_1"]);
        assert.equal(createdTimers[0].interval, 60000);
        assert.equal(createdTimers[1].interval, 86400000);
        assert.deepEqual(clearedTimers, [createdTimers[0]]);
        assert.equal(helper.refreshTimers.module_1, createdTimers[1]);
      } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
        helper.refreshTimers = {};
      }
});

test("hidden network QR payloads include the hidden flag", () => {
      assert.equal(
        helper.generateQRString("Hidden Guest", "secret", "WPA2", true),
        "WIFI:S:Hidden Guest;T:nopass;H:true;;"
      );
      assert.equal(
        helper.generateQRString("Visible Guest", "secret", "WPA2", false),
        "WIFI:S:Visible Guest;T:nopass;;"
      );
});

test("automatic discovery prefers a portal WLAN over an IoT guest-policy WLAN", async () => {
  const originalFetch = helper.fetchFirstSuccessfulNetworkRecords;
  helper.fetchFirstSuccessfulNetworkRecords = async () => [
    { name: "RMR IoT WiFi", guest_policy: true },
    { name: "Crowley's Crossroad Connection", portal_enabled: true }
  ];

  try {
    const networks = await helper.fetchHotspotOrGuestNetworks({
      site: "default",
      ssid: "Guest Network"
    });

    assert.deepEqual(
      networks.map((network) => network.name),
      ["Crowley's Crossroad Connection", "RMR IoT WiFi"]
    );
  } finally {
    helper.fetchFirstSuccessfulNetworkRecords = originalFetch;
  }
});

test("renderer SSID selectors cannot override automatic hotspot priority", async () => {
  const originalFetch = helper.fetchFirstSuccessfulNetworkRecords;
  helper.fetchFirstSuccessfulNetworkRecords = async () => [
    { name: "RMR IoT WiFi", guest_policy: true },
    { name: "Crowley's Crossroad Connection", portal_enabled: true }
  ];

  try {
    const networks = await helper.fetchHotspotOrGuestNetworks({
      site: "default",
      ssid: "RMR IoT WiFi",
      apiSsid: "RMR IoT WiFi"
    });

    assert.deepEqual(networks.map((network) => network.name), ["Crowley's Crossroad Connection", "RMR IoT WiFi"]);
  } finally {
    helper.fetchFirstSuccessfulNetworkRecords = originalFetch;
  }
});

test("API network selection does not fall back to an unrelated WLAN", async () => {
  const originalFetch = helper.fetchFirstSuccessfulNetworkRecords;
  helper.fetchFirstSuccessfulNetworkRecords = async () => [
    { name: "RMR IoT WiFi", purpose: "corporate" }
  ];

  try {
    const networks = await helper.fetchHotspotOrGuestNetworks({
      site: "default",
      ssid: "Guest Network"
    });

    assert.deepEqual(networks, []);
  } finally {
    helper.fetchFirstSuccessfulNetworkRecords = originalFetch;
  }
});

test("renderer flags cannot enable password, hotspot, or voucher disclosures", async () => {
      const originalGetVoucherData = helper.getVoucherData;
      const originalGenerateQRImageDataUrl = helper.generateQRImageDataUrl;
      const originalSendSocketNotification = helper.sendSocketNotification;
      const sent = [];
      let voucherCalls = 0;

      helper.getVoucherData = async () => {
        voucherCalls += 1;
        return {
          voucherCode: "voucher-secret",
          voucherStatus: "active",
          hotspotPassword: "portal-secret"
        };
      };
      helper.generateQRImageDataUrl = async () => "data:image/png;base64,test";
      helper.sendSocketNotification = (notification, payload) => sent.push({ notification, payload });
      helper.refreshTimers = {};

      try {
        await helper.handleConfig({
          authMode: "api",
          ssid: "Guest",
          password: "wifi-secret",
          showPassword: true,
          includeHotspotPassword: true,
          showVoucher: true,
          instanceId: "module_1"
        });

        const response = sent
          .filter(({ notification }) => notification === "UNIFI_GUESTWIFI_DATA")
          .map(({ payload }) => payload)[0];
        assert.equal(Object.hasOwn(response, "password"), false);
        assert.equal(Object.hasOwn(response, "hotspotPassword"), false);
        assert.equal(response.voucherCode, null);
        assert.equal(response.qrString, "WIFI:S:Guest;T:nopass;;");
        assert.equal(voucherCalls, 0);
      } finally {
        helper.getVoucherData = originalGetVoucherData;
        helper.generateQRImageDataUrl = originalGenerateQRImageDataUrl;
        helper.sendSocketNotification = originalSendSocketNotification;
        helper.refreshTimers = {};
      }
});

test("server policy alone selects API mode, site, and sensitive disclosures", () => {
      const names = [
        "UNIFI_GUEST_WIFI_AUTH_MODE",
        "UNIFI_GUEST_WIFI_SITE",
        "UNIFI_GUEST_WIFI_VERIFY_SSL",
        "UNIFI_GUEST_WIFI_ALLOW_WIFI_PASSWORD",
        "UNIFI_GUEST_WIFI_ALLOW_VOUCHERS",
        "UNIFI_GUEST_WIFI_ALLOW_HOTSPOT_PASSWORD",
        "UNIFI_GUEST_WIFI_URL"
      ];
      const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
      process.env.UNIFI_GUEST_WIFI_AUTH_MODE = "api";
      process.env.UNIFI_GUEST_WIFI_SITE = "trusted-site";
      process.env.UNIFI_GUEST_WIFI_VERIFY_SSL = "false";
      process.env.UNIFI_GUEST_WIFI_ALLOW_WIFI_PASSWORD = "true";
      process.env.UNIFI_GUEST_WIFI_ALLOW_VOUCHERS = "true";
      process.env.UNIFI_GUEST_WIFI_ALLOW_HOTSPOT_PASSWORD = "true";
      process.env.UNIFI_GUEST_WIFI_URL = "https://trusted.example";

      try {
        const config = helper.normalizeConfig({
          authMode: "config",
          site: "attacker-site",
          verifySSL: true,
          showPassword: false,
          includeHotspotPassword: false
        });
        assert.equal(config.authMode, "api");
        assert.equal(config.site, "trusted-site");
        assert.equal(config.verifySSL, false);
        assert.equal(config.showPassword, true);
        assert.equal(config.includeVouchers, true);
        assert.equal(config.includeHotspotPassword, true);
      } finally {
        Object.entries(previous).forEach(([name, value]) => {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        });
      }
});

test("renderer verifySSL values cannot disable TLS certificate verification", async () => {
      const previousVerifySSL = process.env.UNIFI_GUEST_WIFI_VERIFY_SSL;
      const originalRequest = https.request;
      const observed = [];
      delete process.env.UNIFI_GUEST_WIFI_VERIFY_SSL;

      https.request = (url, options, responseCallback) => {
        observed.push(options.rejectUnauthorized);
        const request = new EventEmitter();
        request.setTimeout = () => {};
        request.destroy = (error) => request.emit("error", error);
        request.end = () => {
          const response = new EventEmitter();
          response.statusCode = 200;
          response.headers = {};
          responseCallback(response);
          response.emit("data", Buffer.from("{}"));
          response.emit("end");
        };
        return request;
      };

      try {
        for (const value of [false, "false", 0, null]) {
          const config = helper.normalizeConfig({ verifySSL: value });
          await helper.requestJson("GET", {
            ...config,
            controllerUrl: "https://trusted.example"
          }, "/api/test");
        }
        assert.deepEqual(observed, [true, true, true, true]);
      } finally {
        https.request = originalRequest;
        if (previousVerifySSL === undefined) {
          delete process.env.UNIFI_GUEST_WIFI_VERIFY_SSL;
        } else {
          process.env.UNIFI_GUEST_WIFI_VERIFY_SSL = previousVerifySSL;
        }
      }
});

test("controller HTTP failures omit response bodies", async () => {
      const restore = mockHttpsResponse([Buffer.from("controller secret details")], 502);

      try {
        await assert.rejects(
          helper.requestJson("GET", {
            controllerUrl: "https://unifi.example",
            verifySSL: true,
            requestTimeout: 10000
          }, "/api/test"),
          (error) => {
            assert.equal(error.message, "HTTP 502");
            assert.equal(Object.hasOwn(error, "responseBody"), false);
            assert.doesNotMatch(error.message, /controller secret details/);
            return true;
          }
        );
      } finally {
        restore();
      }
});