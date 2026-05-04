const NodeHelper = require("node_helper");
const http = require("node:http");
const https = require("node:https");
const QRCode = require("qrcode");
const { URL } = require("node:url");

function normalizeBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
  }

  return Boolean(value);
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeString(value, fallback) {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function limitUtf8Bytes(value, maxBytes) {
  const text = String(value == null ? "" : value);
  let result = "";
  let usedBytes = 0;

  for (const char of text) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (usedBytes + charBytes > maxBytes) {
      break;
    }

    result += char;
    usedBytes += charBytes;
  }

  return result;
}

function resolveControllerPassword(config) {
  return normalizeString(
    config.controllerPassword,
    normalizeString(config.passwordField, "")
  );
}

function hasCustomizedFallbackConfig(config) {
  const ssid = normalizeString(config.ssid, "");
  const password = normalizeString(config.password, "");
  const securityType = normalizeString(config.securityType, "WPA").toUpperCase();

  // Ignore module defaults and require an explicit fallback config.
  const isDefaultPlaceholder = (
    ssid === "Guest Network" &&
    password === "guestpass123" &&
    securityType === "WPA"
  );

  return Boolean(ssid) && !isDefaultPlaceholder;
}

module.exports = NodeHelper.create({
  start() {
    this.refreshTimers = {};
    this.sessionCookies = [];
    console.log("[MMM-UniFiGuestWiFi] Node helper started");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "UNIFI_GUESTWIFI_CONFIG") {
      this.handleConfig(payload || {});
    }
  },

  async handleConfig(config) {
    const normalizedConfig = this.normalizeConfig(config || {});
    const authMode = normalizedConfig.authMode;
    let wifiData;
    let voucherData = {
      voucherCode: null,
      voucherStatus: null,
      hotspotPassword: null
    };

    try {
      if (authMode === "config") {
        wifiData = this.getConfigBasedWiFi(normalizedConfig);
      } else {
        try {
          wifiData = await this.getAPIBasedWiFi(normalizedConfig);
        } catch (error) {
          console.error("[MMM-UniFiGuestWiFi] API fetch failed:", error.message);

          if (authMode === "auto" && hasCustomizedFallbackConfig(normalizedConfig)) {
            wifiData = this.getConfigBasedWiFi(normalizedConfig);
          } else {
            throw new Error("API fetch failed and fallback config is still using default placeholder values.", { cause: error });
          }
        }
      }

      if (!wifiData) {
        throw new Error("No WiFi data available");
      }

      if (wifiData.qrString) {
        wifiData.qrImageDataUrl = await this.generateQRImageDataUrl(wifiData.qrString);
      }

      try {
        voucherData = await this.getVoucherData(normalizedConfig);
      } catch (error) {
        console.warn("[MMM-UniFiGuestWiFi] Voucher fetch failed:", error.message);
      }

      const response = {
        ...wifiData,
        ...voucherData,
        fetchedAt: Date.now(),
        error: null
      };

      console.log(
        "[MMM-UniFiGuestWiFi] Sending data - SSID:",
        response.ssid,
        "VoucherCode:",
        response.voucherCode,
        "HotspotPassword:",
        response.hotspotPassword ? "***" : "null"
      );

      this.sendSocketNotification("UNIFI_GUESTWIFI_DATA", response);

      if (authMode === "api" || authMode === "auto") {
        const refreshInterval = normalizeNumber(normalizedConfig.refreshInterval, 300000);
        this.scheduleRefresh(normalizedConfig, refreshInterval);
      }
    } catch (error) {
      console.error("[MMM-UniFiGuestWiFi] Error handling config:", error);
      this.sendSocketNotification("UNIFI_GUESTWIFI_ERROR", {
        error: error.message || "Failed to retrieve WiFi details"
      });
    }
  },

  normalizeConfig(config) {
    return {
      authMode: normalizeString(config.authMode, "config").toLowerCase(),
      ssid: normalizeString(config.ssid, "Guest Network"),
      password: normalizeString(config.password, ""),
      securityType: normalizeString(config.securityType, "WPA").toUpperCase(),
      isHidden: normalizeBoolean(config.isHidden, false),
      controllerUrl: normalizeString(config.controllerUrl, "https://unifi.local"),
      username: normalizeString(config.username, ""),
      controllerPassword: normalizeString(config.controllerPassword, normalizeString(config.passwordField, "")),
      passwordField: normalizeString(config.passwordField, ""),
      apiKey: normalizeString(config.apiKey, ""),
      apiKeyHeader: normalizeString(config.apiKeyHeader, "X-API-Key"),
      site: normalizeString(config.site, "default"),
      verifySSL: normalizeBoolean(config.verifySSL, false),
      refreshInterval: normalizeNumber(config.refreshInterval, 300000),
      enhancedWiFiStandardDetection: normalizeBoolean(config.enhancedWiFiStandardDetection, true),
      maskPassword: normalizeBoolean(config.maskPassword, false)
    };
  },

  getConfigBasedWiFi(config) {
    const qrString = this.generateQRString(
      config.ssid,
      config.password,
      config.securityType,
      config.isHidden
    );

    return {
      ssid: config.ssid,
      password: config.password || null,
      securityType: config.securityType,
      wifiStandard: null,
      isHidden: config.isHidden,
      qrString
    };
  },

  generateQRString(ssid, password, securityType, isHidden) {
    void password;
    void isHidden;

    // Captive portal flow: encode only network join metadata.
    const limitedSSID = limitUtf8Bytes(ssid, 32);
    const escaped = limitedSSID
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/:/g, "\\:");

    let qrSecurityType = "nopass";
    if (securityType === "OWE") {
      qrSecurityType = "OWE";
    }

    return `WIFI:S:${escaped};T:${qrSecurityType};;`;
  },

  async generateQRImageDataUrl(qrText) {
    return QRCode.toDataURL(qrText, {
      errorCorrectionLevel: "L",
      margin: 1,
      scale: 8,
      color: {
        dark: "#000000",
        light: "#FFFFFF"
      }
    });
  },

  async getAPIBasedWiFi(config) {
    const guestNetworks = await this.fetchHotspotOrGuestNetworks(config);
    if (!guestNetworks || guestNetworks.length === 0) {
      throw new Error("No hotspot or guest networks found on controller");
    }

    const preferredSsid = normalizeString(config.ssid, "").toLowerCase();
    const preferredMatch = preferredSsid
      ? guestNetworks.find((network) => {
        const networkSsid = normalizeString(network.name || network.ssid || "", "").toLowerCase();
        return networkSsid && networkSsid === preferredSsid;
      })
      : null;

    const guestNetwork = preferredMatch || guestNetworks[0];
    const ssid = guestNetwork.name || guestNetwork.ssid || "Guest Network";
    const password = guestNetwork.passwd || guestNetwork.psk || guestNetwork.passphrase || "";
    const securityType = this.mapSecurityType(guestNetwork);
    const wifiStandard = await this.mapWiFiStandard(config, guestNetwork);
    const isHidden = Boolean(guestNetwork.hide_ssid || guestNetwork.hidden || guestNetwork.is_hidden);

    return {
      ssid,
      password: password || null,
      securityType,
      wifiStandard,
      isHidden,
      qrString: this.generateQRString(ssid, password, securityType, isHidden)
    };
  },

  async mapWiFiStandard(config, network) {
    const baseStandard = this.mapWiFiStandardFromNetwork(network);
    if (!normalizeBoolean(config.enhancedWiFiStandardDetection, true)) {
      return baseStandard;
    }

    if (baseStandard === "WiFi 7") {
      return baseStandard;
    }

    try {
      const enhancedStandard = await this.mapWiFiStandardFromControllerRadios(config, network, baseStandard);
      return enhancedStandard || baseStandard;
    } catch (error) {
      console.warn("[MMM-UniFiGuestWiFi] Enhanced WiFi standard detection failed:", error.message);
      return baseStandard;
    }
  },

  mapWiFiStandardFromNetwork(network) {
    const flattenedSignals = JSON.stringify(network || {}).toLowerCase();
    const bands = [];

    if (Array.isArray(network.wlan_bands)) {
      for (const band of network.wlan_bands) {
        bands.push(String(band).toLowerCase());
      }
    }

    if (network.wlan_band) {
      bands.push(String(network.wlan_band).toLowerCase());
    }

    const has6g = bands.some((band) => band.includes("6g"));
    const mloEnabled = (
      network.mlo_enabled === true ||
      network.mloEnabled === true ||
      String(network.mlo_enabled || network.mloEnabled || "").toLowerCase() === "true"
    );

    // Most trustworthy indicator for 802.11be in UniFi WLAN config.
    if (mloEnabled || flattenedSignals.includes("11be") || flattenedSignals.includes("wifi7") || flattenedSignals.includes("eht")) {
      return "WiFi 7";
    }

    // 6 GHz without MLO is typically WiFi 6E in UniFi WLAN definitions.
    if (has6g) {
      return "WiFi 6E";
    }

    if (flattenedSignals.includes("11ax") || flattenedSignals.includes("wifi6") || flattenedSignals.includes(" he ")) {
      return "WiFi 6";
    }

    if (flattenedSignals.includes("11ac") || flattenedSignals.includes("wifi5") || flattenedSignals.includes("vht")) {
      return "WiFi 5";
    }

    if (flattenedSignals.includes("11n") || flattenedSignals.includes("wifi4") || flattenedSignals.includes("ht")) {
      return "WiFi 4";
    }

    return null;
  },

  async mapWiFiStandardFromControllerRadios(config, network, baseStandard) {
    const bands = [];

    if (Array.isArray(network.wlan_bands)) {
      for (const band of network.wlan_bands) {
        bands.push(String(band).toLowerCase());
      }
    }

    if (network.wlan_band) {
      bands.push(String(network.wlan_band).toLowerCase());
    }

    const has6g = bands.some((band) => band.includes("6g"));
    if (!has6g) {
      return baseStandard;
    }

    const apDevices = await this.fetchAPDeviceRecords(config);
    if (!apDevices.length) {
      return baseStandard;
    }

    const hasWiFi7CapableAP = apDevices.some((device) => this.isWiFi7CapableDevice(device));
    if (hasWiFi7CapableAP) {
      return "WiFi 7";
    }

    return baseStandard;
  },

  isWiFi7CapableDevice(device) {
    if (!device || typeof device !== "object") {
      return false;
    }

    const model = String(device.model || device.type || "").toUpperCase();
    if (model.includes("U7") || model.includes("11BE") || model.includes("WIFI7")) {
      return true;
    }

    const flattened = JSON.stringify(device).toLowerCase();
    if (/\b11be\b/.test(flattened) || /\bwifi[-_ ]?7\b/.test(flattened) || /\beht\b/.test(flattened)) {
      return true;
    }

    const radios = Array.isArray(device.radio_table) ? device.radio_table : [];
    for (const radio of radios) {
      const width = Number(radio.ht || radio.channel_width || radio.chan_width || 0);
      if (Number.isFinite(width) && width >= 320) {
        return true;
      }
    }

    return false;
  },

  async fetchAPDeviceRecords(config) {
    const site = encodeURIComponent(config.site);
    const endpoints = [
      `/proxy/network/api/s/${site}/stat/device`,
      `/api/s/${site}/stat/device`
    ];

    let authMode = normalizeString(config.authMode, "auto").toLowerCase();
    if (authMode === "api") {
      authMode = "auto";
    }

    const apiKey = normalizeString(config.apiKey, "");
    const username = normalizeString(config.username, "");
    const password = resolveControllerPassword(config);

    if (apiKey && (authMode === "auto" || authMode === "apikey")) {
      try {
        const records = await this.fetchRecordsFromAnyEndpoint(config, endpoints, {
          apiKey,
          apiKeyHeader: normalizeString(config.apiKeyHeader, "X-API-Key")
        });

        if (records.length > 0) {
          return records;
        }
      } catch (error) {
        if (authMode === "apikey") {
          throw error;
        }
      }
    }

    if (!username || !password) {
      return [];
    }

    await this.login(config, username, password);
    return this.fetchRecordsFromAnyEndpoint(config, endpoints, { cookies: this.sessionCookies });
  },

  mapSecurityType(network) {
    const primarySecurity = String(network.security || network.security_protocol || network.security_mode || network.securityMode || "").toLowerCase();
    const wpa3Support = (
      network.wpa3_support === true ||
      network.wpa3Support === true ||
      String(network.wpa3_support || network.wpa3Support || "").toLowerCase() === "true"
    );
    const wpa3Transition = (
      network.wpa3_transition === true ||
      network.wpa3Transition === true ||
      String(network.wpa3_transition || network.wpa3Transition || "").toLowerCase() === "true"
    );

    const enhancedOpenFlags = [
      network.owe,
      network.owe_enabled,
      network.oweEnabled,
      network.owe_mode,
      network.oweMode,
      network.enhanced_open,
      network.enhancedOpen,
      network.enhanced_open_mode,
      network.enhancedOpenMode
    ]
      .map((value) => String(value == null ? "" : value).toLowerCase())
      .some((value) => ["true", "1", "on", "enabled", "owe", "enhanced_open", "enhanced open"].includes(value));

    const tertiarySignals = [
      network.akm,
      network.akms,
      network.auth_mode,
      network.authMode,
      network.security_proto,
      network.securityProto,
      network.wpa3_support,
      network.wpa3_transition,
      network.owe,
      network.owe_enabled,
      network.oweEnabled,
      network.owe_mode,
      network.oweMode,
      network.enhanced_open,
      network.enhancedOpen,
      network.enhanced_open_mode,
      network.enhancedOpenMode,
      network.sae,
      network.sae_mode,
      network.saeMode,
      network.sae_pwe,
      network.saePwe,
      network.pmf_required,
      network.pmfRequired,
      network.ccmp,
      network.cipher,
      network.ciphers
    ]
      .map((value) => String(value == null ? "" : value).toLowerCase())
      .filter(Boolean)
      .join(" ");

    const primarySignals = [
      network.security,
      network.security_protocol,
      network.security_mode,
      network.securityMode,
      network.auth,
      network.encryption
    ]
      .map((value) => String(value == null ? "" : value).toLowerCase())
      .filter(Boolean)
      .join(" ");

    const secondarySignals = [
      network.wpa_mode,
      network.wpaMode,
      network.group_rekey,
      network.pmf_mode,
      network.pmfMode,
      network.owe_transition,
      network.oweTransition,
      network.owe_transition_mode,
      network.oweTransitionMode,
      network.enhanced_open_transition,
      network.enhancedOpenTransition,
      network.enhanced_open_transition_mode,
      network.enhancedOpenTransitionMode,
      network.transition_mode,
      network.transitionMode
    ]
      .map((value) => String(value == null ? "" : value).toLowerCase())
      .filter(Boolean)
      .join(" ");

    const securitySignals = [primarySignals, secondarySignals, tertiarySignals].filter(Boolean).join(" ");

    const oweTransitionFlag = [
      network.owe_transition,
      network.oweTransition,
      network.owe_transition_mode,
      network.oweTransitionMode,
      network.transition_mode,
      network.transitionMode
    ]
      .map((value) => String(value == null ? "" : value).toLowerCase())
      .some((value) => ["true", "1", "on", "enabled", "transition"].includes(value));

    if (primarySignals.includes("owe") && primarySignals.includes("transition")) {
      return "OWE_TRANSITION";
    }

    if (primarySignals.includes("enhanced open") && primarySignals.includes("transition")) {
      return "OWE_TRANSITION";
    }

    if (primarySignals.includes("owe") || primarySignals.includes("enhanced open")) {
      return "OWE";
    }

    // UniFi Enhanced Open + Transition commonly appears as:
    // security=open, wpa3_support=true, wpa3_transition=true.
    if ((primarySecurity === "open" || primarySignals.includes("open")) && wpa3Support && wpa3Transition) {
      return "OWE_TRANSITION";
    }

    // UniFi Open + OWE (non-transition) commonly appears as:
    // security=open, wpa3_support=true, wpa3_transition=false.
    if ((primarySecurity === "open" || primarySignals.includes("open")) && wpa3Support && !wpa3Transition) {
      return "OWE";
    }

    if (primarySignals.includes("open")) {
      return "OPEN";
    }

    if (!primarySignals && securitySignals.includes("owe") && securitySignals.includes("transition")) {
      return "OWE_TRANSITION";
    }

    if (!primarySignals && securitySignals.includes("enhanced open") && securitySignals.includes("transition")) {
      return "OWE_TRANSITION";
    }

    if (oweTransitionFlag && (securitySignals.includes("owe") || securitySignals.includes("enhanced open") || enhancedOpenFlags || primarySignals.includes("open"))) {
      return "OWE_TRANSITION";
    }

    // Some UniFi payloads only expose "open" in primary fields plus explicit enhanced-open flags.
    if (primarySignals.includes("open") && enhancedOpenFlags) {
      return "OWE_TRANSITION";
    }

    if (!primarySignals && (securitySignals.includes("owe") || securitySignals.includes("enhanced open"))) {
      return "OWE";
    }

    if (!primarySignals && (!securitySignals || securitySignals === "open")) {
      return "OPEN";
    }

    // wpa3_support is a boolean in UniFi responses — stringifying it yields "true" not "wpa3".
    // Check it after OWE checks so Enhanced Open/OWE transition is not mislabeled WPA3.
    if (wpa3Support) {
      return "WPA3";
    }

    // pmf_mode "required" is mandatory for WPA3-only; UniFi may still report wpa_mode "wpa2".
    const pmfMode = String(network.pmf_mode || network.pmfMode || "").toLowerCase();
    if (pmfMode === "required") {
      return "WPA3";
    }

    if (
      securitySignals.includes("wpa3") ||
      securitySignals.includes("sae") ||
      securitySignals.includes("psk2+sae") ||
      securitySignals.includes("wpa2/wpa3") ||
      securitySignals.includes("wpa2-wpa3")
    ) {
      return "WPA3";
    }

    if (securitySignals.includes("wpa2")) {
      return "WPA2";
    }

    if (securitySignals.includes("wpa")) {
      return "WPA";
    }

    return "OPEN";
  },

  async fetchHotspotOrGuestNetworks(config) {
    const site = encodeURIComponent(config.site);
    const endpoints = [
      `/proxy/network/integration/v1/sites/${site}/wlan`,
      `/proxy/network/integration/v1/sites/${site}/wifi`,
      `/proxy/network/api/s/${site}/rest/wlanconf`,
      `/api/s/${site}/rest/wlanconf`,
      `/proxy/network/api/v2/sites/${site}/networks?type=hotspot`,
      `/proxy/network/api/v2/sites/${site}/networks?type=guest`,
      `/api/v2/sites/${site}/networks?type=hotspot`,
      `/api/v2/sites/${site}/networks?type=guest`
    ];

    const records = await this.fetchFirstSuccessfulNetworkRecords(config, endpoints);
    const normalized = records
      .map((record) => this.normalizeNetworkRecord(record))
      .filter((record) => Boolean(record));

    const matching = normalized.filter((record) => this.isHotspotOrGuestNetwork(record.raw));

    const preferredSsid = normalizeString(config.ssid, "").toLowerCase();
    if (preferredSsid && preferredSsid !== "guest network") {
      const preferredMatch = normalized.find((entry) => {
        const ssid = normalizeString(entry.ssid, "").toLowerCase();
        return ssid === preferredSsid;
      });

      if (preferredMatch) {
        return [preferredMatch.raw];
      }
    }

    if (matching.length > 0) {
      return matching.map((entry) => entry.raw);
    }

    if (normalized.length > 0) {
      return normalized.map((entry) => entry.raw);
    }

    return [];
  },

  async fetchFirstSuccessfulNetworkRecords(config, endpoints) {
    let authMode = normalizeString(config.authMode, "auto").toLowerCase();
    if (authMode === "api") {
      authMode = "auto";
    }

    const apiKey = normalizeString(config.apiKey, "");
    const username = normalizeString(config.username, "");
    const password = resolveControllerPassword(config);

    if (authMode === "apikey" && !apiKey) {
      throw new Error("Missing apiKey in MMM-UniFiGuestWiFi config when authMode is set to apikey.");
    }

    if (authMode === "login" && (!username || !password)) {
      throw new Error("Missing username or password in MMM-UniFiGuestWiFi config when authMode is set to login.");
    }

    if (apiKey && (authMode === "auto" || authMode === "apikey")) {
      try {
        const records = await this.fetchNetworkEndpoints(
          config,
          endpoints,
          {
            apiKey,
            apiKeyHeader: normalizeString(config.apiKeyHeader, "X-API-Key")
          },
          false
        );

        if (records.length > 0) {
          return records;
        }
      } catch (error) {
        if (authMode === "apikey") {
          throw error;
        }
      }
    }

    if (!username || !password) {
      if (apiKey) {
        return [];
      }

      throw new Error("Missing username or password in MMM-UniFiGuestWiFi config.");
    }

    await this.login(config, username, password);
    return this.fetchNetworkEndpoints(config, endpoints, { cookies: this.sessionCookies }, false);
  },

  async fetchNetworkEndpoints(config, endpoints, authOptions, hasRetriedAuthFailure) {
    const shouldRetryAfterAuthFailure = this.shouldRetryAfterAuthFailure(config, authOptions) && !hasRetriedAuthFailure;
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await this.requestJson("GET", config, endpoint, null, null, authOptions);
        const records = this.extractNetworkRecords(response);

        if (records.length > 0) {
          return records;
        }
      } catch (error) {
        if (shouldRetryAfterAuthFailure && this.isAuthFailure(error)) {
          return this.retryNetworkFetchAfterReauth(config, endpoints, authOptions);
        }

        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  },

  async retryNetworkFetchAfterReauth(config, endpoints, authOptions) {
    this.sessionCookies = [];

    await this.login(
      config,
      normalizeString(config.username, ""),
      resolveControllerPassword(config)
    );

    return this.fetchNetworkEndpoints(
      config,
      endpoints,
      {
        cookies: this.sessionCookies,
        apiKey: authOptions && authOptions.apiKey,
        apiKeyHeader: authOptions && authOptions.apiKeyHeader
      },
      true
    );
  },

  extractNetworkRecords(response) {
    const directCandidates = [
      response,
      response && response.data,
      response && response.data && response.data.data,
      response && response.data && response.data.results,
      response && response.data && response.data.records,
      response && response.result,
      response && response.results,
      response && response.networks,
      response && response.records,
      response && response.wlan,
      response && response.wlans,
      response && response.items,
      response && response.payload
    ];

    for (const candidate of directCandidates) {
      const records = this.extractRecordsFromCandidate(candidate);
      if (records.length > 0) {
        return records;
      }
    }

    return this.findNetworkLikeArray(response);
  },

  extractRecordsFromCandidate(candidate) {
    if (!candidate) {
      return [];
    }

    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (candidate && Array.isArray(candidate.data)) {
      return candidate.data;
    }

    if (candidate && Array.isArray(candidate.results)) {
      return candidate.results;
    }

    if (candidate && Array.isArray(candidate.records)) {
      return candidate.records;
    }

    if (candidate && Array.isArray(candidate.wlan)) {
      return candidate.wlan;
    }

    if (candidate && Array.isArray(candidate.wlans)) {
      return candidate.wlans;
    }

    if (candidate && Array.isArray(candidate.items)) {
      return candidate.items;
    }

    return [];
  },

  findNetworkLikeArray(root) {
    const queue = [root];
    const seen = new Set();

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== "object") {
        continue;
      }

      if (seen.has(node)) {
        continue;
      }
      seen.add(node);

      if (Array.isArray(node)) {
        if (node.some((item) => this.looksLikeNetworkRecord(item))) {
          return node;
        }

        for (const entry of node) {
          queue.push(entry);
        }
        continue;
      }

      for (const value of Object.values(node)) {
        queue.push(value);
      }
    }

    return [];
  },

  looksLikeNetworkRecord(record) {
    if (!record || typeof record !== "object") {
      return false;
    }

    return Boolean(record.name || record.ssid || record._id || record.wlan_bands || record.security);
  },

  normalizeNetworkRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const ssid = normalizeString(record.name || record.ssid || "", "");
    if (!ssid) {
      return null;
    }

    return {
      raw: record,
      ssid
    };
  },

  isHotspotOrGuestNetwork(record) {
    const ssid = normalizeString(record.name || record.ssid || "", "").toLowerCase();

    if (ssid.includes("guest") || ssid.includes("hotspot")) {
      return true;
    }

    const haystack = [
      record.type,
      record.network_type,
      record.purpose,
      record.wlan_bands,
      record.security,
      record.guest_policy,
      record.x_passphrase ? "has_portal_passphrase" : "",
      record.is_guest,
      record.hotspot_enabled
    ]
      .map((value) => String(value == null ? "" : value).toLowerCase())
      .join(" ");

    if (haystack.includes("hotspot") || haystack.includes("guest")) {
      return true;
    }

    return Boolean(record.guest_policy || record.hotspot_enabled || record.portal_enabled);
  },

  shouldRetryAfterAuthFailure(config, authOptions) {
    return Boolean(
      authOptions && authOptions.cookies &&
      normalizeString(config.username, "") &&
      resolveControllerPassword(config)
    );
  },

  isAuthFailure(error) {
    return Boolean(error && (error.statusCode === 401 || error.statusCode === 403));
  },

  async login(config, username, password) {
    const response = await this.requestJson(
      "POST",
      config,
      "/api/auth/login",
      { username, password },
      { "Content-Type": "application/json" },
      { cookies: true }
    );

    const cookies = Array.isArray(response.headers && response.headers["set-cookie"])
      ? response.headers["set-cookie"]
      : [];

    this.sessionCookies = cookies.map((cookie) => cookie.split(";")[0]).filter(Boolean);

    if (!this.sessionCookies.length) {
      throw new Error("UniFi login did not return a session cookie.");
    }
  },

  async requestJson(method, config, path, body, extraHeaders, authOptions) {
    const url = new URL(path, config.controllerUrl);
    const transport = url.protocol === "http:" ? http : https;
    const requestBody = body ? JSON.stringify(body) : "";
    const headers = Object.assign({}, extraHeaders || {});
    const options = authOptions || {};

    if (options.cookies && this.sessionCookies.length) {
      headers.Cookie = this.sessionCookies.join("; ");
    }

    if (options.apiKey) {
      headers[options.apiKeyHeader || "X-API-Key"] = options.apiKey;
    }

    if (requestBody && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    if (requestBody) {
      headers["Content-Length"] = Buffer.byteLength(requestBody);
    }

    return new Promise((resolve, reject) => {
      const request = transport.request(
        url,
        {
          method,
          headers,
          rejectUnauthorized: normalizeBoolean(config.verifySSL, false)
        },
        (response) => {
          let raw = "";

          response.on("data", (chunk) => {
            raw += chunk;
          });

          response.on("end", () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              const error = new Error(`HTTP ${response.statusCode}: ${raw.slice(0, 200)}`);
              error.statusCode = response.statusCode;
              error.responseBody = raw;
              reject(error);
              return;
            }

            if (!raw) {
              resolve({ headers: response.headers, json: {} });
              return;
            }

            try {
              resolve({ headers: response.headers, json: JSON.parse(raw) });
            } catch (error) {
              reject(new Error(`Failed to parse UniFi response: ${error.message}`));
            }
          });
        }
      );

      request.on("error", (error) => reject(error));

      if (requestBody) {
        request.write(requestBody);
      }

      request.end();
    }).then((result) => ({
      headers: result.headers,
      ...result.json
    }));
  },

  async getVoucherData(config) {
    try {
      const site = encodeURIComponent(config.site);
      const endpoints = [
        `/proxy/network/integration/v1/sites/${site}/hotspot/vouchers`,
        `/proxy/network/integration/v1/sites/${site}/vouchers`,
        `/proxy/network/api/s/${site}/rest/hotspot/voucher`,
        `/proxy/network/api/s/${site}/stat/voucher`,
        `/api/s/${site}/rest/hotspot/voucher`,
        `/api/s/${site}/stat/voucher`
      ];

      const vouchers = await this.fetchVoucherEndpoints(config, endpoints);

      const activeVoucher = vouchers.find((voucher) => {
        const status = String(voucher.status || "").toLowerCase();
        const hasCode = Boolean(voucher.code || voucher.voucher || voucher.voucher_code || voucher.note);
        return hasCode && (
          status === "active" ||
          status === "valid" ||
          status === "valid_one" ||
          status === "enabled" ||
          status === "unused" ||
          status === "not_activated"
        );
      });

      if (activeVoucher) {
        return {
          voucherCode: activeVoucher.code || activeVoucher.voucher || activeVoucher.voucher_code || activeVoucher.note || null,
          voucherStatus: "active",
          hotspotPassword: null
        };
      }

      const hotspotPassword = await this.fetchHotspotPassword(config);

      return {
        voucherCode: null,
        voucherStatus: "none",
        hotspotPassword
      };
    } catch (error) {
      console.warn("[MMM-UniFiGuestWiFi] Voucher/hotspot password fetch failed:", error.message);
      return {
        voucherCode: null,
        voucherStatus: null,
        hotspotPassword: null
      };
    }
  },

  async fetchVoucherEndpoints(config, endpoints) {
    let authMode = normalizeString(config.authMode, "auto").toLowerCase();
    if (authMode === "api") {
      authMode = "auto";
    }

    const apiKey = normalizeString(config.apiKey, "");
    const username = normalizeString(config.username, "");
    const password = resolveControllerPassword(config);

    if (authMode === "apikey" && !apiKey) {
      throw new Error("Missing apiKey in MMM-UniFiGuestWiFi config when authMode is set to apikey.");
    }

    if (authMode === "login" && (!username || !password)) {
      throw new Error("Missing username or password in MMM-UniFiGuestWiFi config when authMode is set to login.");
    }

    if (apiKey && (authMode === "auto" || authMode === "apikey")) {
      try {
        const records = await this.fetchRecordsFromAnyEndpoint(
          config,
          endpoints,
          {
            apiKey,
            apiKeyHeader: normalizeString(config.apiKeyHeader, "X-API-Key")
          }
        );

        if (records.length) {
          return records;
        }
      } catch (error) {
        if (authMode === "apikey") {
          throw error;
        }
      }
    }

    if (!username || !password) {
      if (apiKey) {
        return [];
      }

      throw new Error("Missing username or password in MMM-UniFiGuestWiFi config.");
    }

    await this.login(config, username, password);
    return this.fetchRecordsFromAnyEndpoint(config, endpoints, { cookies: this.sessionCookies });
  },

  async fetchRecordsFromAnyEndpoint(config, endpoints, authOptions) {
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await this.requestJson("GET", config, endpoint, null, null, authOptions);
        const records = this.extractNetworkRecords(response);
        if (records.length > 0) {
          return records;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  },

  async fetchHotspotPassword(config) {
    const site = encodeURIComponent(config.site);
    const endpoints = [
      `/proxy/network/api/s/${site}/rest/setting/guest_access`,
      `/proxy/network/api/s/${site}/rest/setting`,
      `/proxy/network/api/s/${site}/get/setting`,
      `/api/s/${site}/rest/setting/guest_access`,
      `/api/s/${site}/rest/setting`,
      `/api/s/${site}/get/setting`
    ];

    const findPasswordInNode = (node, scoped) => {
      if (!node || typeof node !== "object") {
        return null;
      }

      const directCandidates = [
        node.portal_customized && node.portal_customized.password,
        node.password,
        node.portal_password,
        node.x_password,
        node.passphrase
      ];

      const looksLikeSettingPayload = directCandidates.some((candidate) => {
        return typeof candidate === "string" && candidate.trim();
      });

      if (scoped || looksLikeSettingPayload) {
        for (const candidate of directCandidates) {
          if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
          }
        }
      }

      const nextScoped = scoped || /guest_access|hotspot|portal/.test(
        [node.key, node._id, node.name, node.setting, node.purpose]
          .map((value) => String(value == null ? "" : value).toLowerCase())
          .join(" ")
      );

      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const entry of value) {
            const nestedMatch = findPasswordInNode(entry, nextScoped);
            if (nestedMatch) {
              return nestedMatch;
            }
          }
        } else if (value && typeof value === "object") {
          const nestedMatch = findPasswordInNode(value, nextScoped);
          if (nestedMatch) {
            return nestedMatch;
          }
        }
      }

      return null;
    };

    const parseHotspotPassword = (response, endpoint) => {
      const directMatch = findPasswordInNode(response, /guest_access|hotspot|portal/.test(endpoint));
      if (directMatch) {
        return directMatch;
      }

      const records = this.extractNetworkRecords(response);
      for (const record of records) {
        const recordMatch = findPasswordInNode(record, false);
        if (recordMatch) {
          return recordMatch;
        }
      }

      return null;
    };

    let authMode = normalizeString(config.authMode, "auto").toLowerCase();
    if (authMode === "api") {
      authMode = "auto";
    }

    const apiKey = normalizeString(config.apiKey, "");
    const username = normalizeString(config.username, "");
    const password = resolveControllerPassword(config);

    if (apiKey && (authMode === "auto" || authMode === "apikey")) {
      for (const endpoint of endpoints) {
        try {
          const response = await this.requestJson("GET", config, endpoint, null, null, {
            apiKey,
            apiKeyHeader: normalizeString(config.apiKeyHeader, "X-API-Key")
          });

          const passwordFromApiKey = parseHotspotPassword(response, endpoint);
          if (passwordFromApiKey) {
            return passwordFromApiKey;
          }
        } catch (error) {
          if (authMode === "apikey" && !this.isAuthFailure(error)) {
            throw error;
          }
        }
      }
    }

    if (username && password) {
      if (!this.sessionCookies.length) {
        await this.login(config, username, password);
      }

      for (const endpoint of endpoints) {
        try {
          const response = await this.requestJson("GET", config, endpoint, null, null, { cookies: this.sessionCookies });
          const passwordFromLogin = parseHotspotPassword(response, endpoint);
          if (passwordFromLogin) {
            return passwordFromLogin;
          }
        } catch (error) {
          if (this.isAuthFailure(error)) {
            this.sessionCookies = [];
            await this.login(config, username, password);
          }
        }
      }
    }

    return null;
  },

  scheduleRefresh(config, interval) {
    const configKey = JSON.stringify({
      url: config.controllerUrl,
      site: config.site,
      authMode: config.authMode,
      ssid: config.ssid
    });

    if (this.refreshTimers[configKey]) {
      clearInterval(this.refreshTimers[configKey]);
    }

    this.refreshTimers[configKey] = setInterval(() => {
      this.handleConfig(config);
    }, interval);

    console.log(`[MMM-UniFiGuestWiFi] Scheduled refresh every ${interval}ms`);
  },

  stop() {
    Object.values(this.refreshTimers).forEach((timer) => {
      clearInterval(timer);
    });

    this.refreshTimers = {};
    console.log("[MMM-UniFiGuestWiFi] Timers cleaned up");
  }
});
