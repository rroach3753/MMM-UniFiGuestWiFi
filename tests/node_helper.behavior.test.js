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
      const originalSetInterval = global.setInterval;
      const originalClearInterval = global.clearInterval;
      const createdTimers = [];
      const clearedTimers = [];

      global.setInterval = (callback, interval) => {
        const timer = { callback, interval, id: createdTimers.length + 1 };
        createdTimers.push(timer);
        return timer;
      };
      global.clearInterval = (timer) => clearedTimers.push(timer);
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
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
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