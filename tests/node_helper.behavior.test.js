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

function mockHttpsResponse(chunks) {
  const originalRequest = https.request;

  https.request = (url, options, responseCallback) => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
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
  process.env.UNIFI_GUEST_WIFI_USERNAME = "server-user";
  process.env.UNIFI_GUEST_WIFI_PASSWORD = "server-password";
  process.env.UNIFI_GUEST_WIFI_API_KEY = "server-key";

  try {
    const config = helper.normalizeConfig({
      username: "renderer-user",
      controllerPassword: "renderer-password",
      apiKey: "renderer-key"
    });

    assert.equal(config.username, "server-user");
    assert.equal(config.controllerPassword, "server-password");
    assert.equal(config.apiKey, "server-key");
  } finally {
    const values = {
      UNIFI_GUEST_WIFI_USERNAME: previousUsername,
      UNIFI_GUEST_WIFI_PASSWORD: previousPassword,
      UNIFI_GUEST_WIFI_API_KEY: previousApiKey
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