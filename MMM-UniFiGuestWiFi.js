/* global Module */

Module.register("MMM-UniFiGuestWiFi", {
  defaults: {
    authMode: "config",
    ssid: "Guest Network",
    password: "guestpass123",
    securityType: "WPA",
    isHidden: false,
    controllerUrl: "https://unifi.local",
    username: "",
    controllerPassword: "",
    passwordField: "",
    apiKey: "",
    apiKeyHeader: "X-API-Key",
    site: "default",
    verifySSL: false,
    refreshInterval: 300000,
    title: "Guest WiFi",
    layoutVertical: true,
    showSSID: true,
    showPassword: true,
    showSecurityType: true,
    showVoucher: true,
    maskPassword: false,
    voucherLabel: "Guest Code",
    includeHotspotPassword: true,
    qrSize: 150,
    colorDark: "#000000",
    colorLight: "#ffffff",
    emptyMessage: "No guest WiFi configured.",
    loadingMessage: "Loading guest WiFi details...",
    noVouchersMessage: "No active vouchers available",
    captivePortalHint: "If the portal page does not open automatically, close Camera and open your favorite browser."
  },

  start: function () {
    this.dataState = {
      ssid: null,
      password: null,
      securityType: null,
      isHidden: false,
      qrString: null,
      qrImageDataUrl: null,
      voucherCode: null,
      voucherStatus: null,
      hotspotPassword: null,
      fetchedAt: null,
      error: null,
      loading: true
    };

    this.configRetryCount = 0;
    this.maxConfigRetries = 3;
    this.requestBackendData();
  },

  requestBackendData: function () {
    var self = this;

    this.sendSocketNotification("UNIFI_GUESTWIFI_CONFIG", this.config);

    if (this.configRetryTimer) {
      clearTimeout(this.configRetryTimer);
    }

    this.configRetryTimer = setTimeout(function () {
      if (self.dataState.loading && self.configRetryCount < self.maxConfigRetries) {
        self.configRetryCount += 1;
        self.requestBackendData();
      } else if (self.dataState.loading) {
        self.dataState.loading = false;
        self.dataState.error = "Unable to load UniFi guest WiFi details. Check controller auth and API access.";
        self.updateDom(300);
      }
    }, 5000);
  },

  getScripts: function () {
    return [];
  },

  getStyles: function () {
    return ["MMM-UniFiGuestWiFi.css"];
  },

  clearRetryTimer: function () {
    if (this.configRetryTimer) {
      clearTimeout(this.configRetryTimer);
      this.configRetryTimer = null;
    }
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "UNIFI_GUESTWIFI_DATA") {
      this.dataState = {
        ssid: payload.ssid || null,
        password: payload.password || null,
        securityType: payload.securityType || "WPA",
        isHidden: payload.isHidden || false,
        qrString: payload.qrString || null,
        qrImageDataUrl: payload.qrImageDataUrl || null,
        voucherCode: payload.voucherCode || null,
        voucherStatus: payload.voucherStatus || null,
        hotspotPassword: payload.hotspotPassword || null,
        fetchedAt: payload.fetchedAt || Date.now(),
        error: null,
        loading: false
      };
      this.configRetryCount = 0;
      this.clearRetryTimer();
      this.updateDom(300);
    } else if (notification === "UNIFI_GUESTWIFI_ERROR") {
      this.dataState.error = payload.error || "Unknown error";
      this.dataState.loading = false;
      this.clearRetryTimer();
      this.updateDom(300);
    }
  },

  repeatChar: function (char, count) {
    var value = "";
    var index;
    for (index = 0; index < count; index += 1) {
      value += char;
    }
    return value;
  },

  getDom: function () {
    var wrapper = document.createElement("div");
    var container;
    var contentWrapper;
    var infoSection;

    wrapper.className = "mmm-unifi-guestwifi";

    if (this.dataState.loading) {
      wrapper.innerHTML = '<div class="message">' + this.config.loadingMessage + "</div>";
      return wrapper;
    }

    if (this.dataState.error) {
      wrapper.innerHTML = '<div class="error">' + this.dataState.error + "</div>";
      return wrapper;
    }

    if (!this.dataState.ssid) {
      wrapper.innerHTML = '<div class="message">' + this.config.emptyMessage + "</div>";
      return wrapper;
    }

    container = document.createElement("div");
    container.className = "guest-wifi-container " + (this.config.layoutVertical ? "vertical" : "horizontal");

    if (this.config.title) {
      var titleEl = document.createElement("div");
      titleEl.className = "title";
      titleEl.textContent = this.config.title;
      container.appendChild(titleEl);
    }

    contentWrapper = document.createElement("div");
    contentWrapper.className = "content-wrapper";

    infoSection = document.createElement("div");
    infoSection.className = "info-section";

    if (this.config.showSSID) {
      var ssidEl = document.createElement("div");
      var ssidLabel = document.createElement("span");
      var ssidValue = document.createElement("span");

      ssidEl.className = "ssid-row";
      ssidLabel.className = "label";
      ssidLabel.textContent = "Network:";
      ssidValue.className = "value";
      ssidValue.textContent = this.dataState.ssid;

      if (this.dataState.isHidden) {
        var hiddenBadge = document.createElement("span");
        ssidValue.appendChild(document.createElement("br"));
        hiddenBadge.className = "hidden-badge";
        hiddenBadge.textContent = "(Hidden)";
        ssidValue.appendChild(hiddenBadge);
      }

      ssidEl.appendChild(ssidLabel);
      ssidEl.appendChild(ssidValue);
      infoSection.appendChild(ssidEl);
    }

    if (this.config.showSecurityType) {
      var securityEl = document.createElement("div");
      var securityBadge = document.createElement("span");

      securityEl.className = "security-row";
      securityBadge.className = "security-badge security-" + String(this.dataState.securityType || "open").toLowerCase();
      securityBadge.textContent = this.dataState.securityType;
      securityEl.appendChild(securityBadge);
      infoSection.appendChild(securityEl);
    }

    if (this.config.showPassword && this.dataState.password && this.dataState.securityType !== "OPEN" && this.dataState.securityType !== "OWE" && this.dataState.securityType !== "OWE_TRANSITION") {
      var passwordEl = document.createElement("div");
      var passwordLabel = document.createElement("span");
      var passwordValue = document.createElement("span");

      passwordEl.className = "password-row";
      passwordLabel.className = "label";
      passwordLabel.textContent = "Password:";
      passwordValue.className = "value";

      if (this.config.maskPassword) {
        passwordValue.textContent = this.repeatChar("•", Math.min(this.dataState.password.length, 12));
      } else {
        passwordValue.textContent = this.dataState.password;
      }

      passwordEl.appendChild(passwordLabel);
      passwordEl.appendChild(passwordValue);
      infoSection.appendChild(passwordEl);
    }

    contentWrapper.appendChild(infoSection);

    if (this.dataState.qrImageDataUrl || this.dataState.qrString) {
      var qrSection = document.createElement("div");
      var qrContainer = document.createElement("div");

      qrSection.className = "qr-section";
      qrContainer.className = "qr-container";

      if (this.dataState.qrImageDataUrl) {
        var qrImage = document.createElement("img");
        qrImage.src = this.dataState.qrImageDataUrl;
        qrImage.alt = "QR code for " + this.dataState.ssid;
        qrImage.width = this.config.qrSize;
        qrImage.height = this.config.qrSize;
        qrContainer.appendChild(qrImage);
      }

      qrSection.appendChild(qrContainer);

      if (this.dataState.hotspotPassword && this.config.includeHotspotPassword) {
        var portalPwdWrap = document.createElement("div");
        var portalPwdLabel = document.createElement("div");
        var portalPwdValue = document.createElement("div");

        portalPwdWrap.className = "portal-password-row";
        portalPwdLabel.className = "label";
        portalPwdLabel.textContent = "Portal Password:";
        portalPwdValue.className = "voucher-code";
        portalPwdValue.textContent = this.dataState.hotspotPassword;

        portalPwdWrap.appendChild(portalPwdLabel);
        portalPwdWrap.appendChild(portalPwdValue);
        qrSection.appendChild(portalPwdWrap);
      }

      if (this.config.captivePortalHint) {
        var portalHint = document.createElement("div");
        portalHint.className = "portal-hint";
        portalHint.textContent = this.config.captivePortalHint;
        qrSection.appendChild(portalHint);
      }

      contentWrapper.appendChild(qrSection);
    }

    container.appendChild(contentWrapper);

    if (this.config.showVoucher) {
      var voucherSection = document.createElement("div");
      voucherSection.className = "voucher-section";

      if (this.dataState.voucherCode) {
        var voucherLabel = document.createElement("div");
        var voucherCode = document.createElement("div");

        voucherLabel.className = "label";
        voucherLabel.textContent = this.config.voucherLabel;
        voucherCode.className = "voucher-code";
        voucherCode.textContent = this.dataState.voucherCode;
        voucherSection.appendChild(voucherLabel);
        voucherSection.appendChild(voucherCode);
      } else if (this.dataState.hotspotPassword && this.config.includeHotspotPassword) {
        var noVouchersLabel = document.createElement("div");
        noVouchersLabel.className = "label warning";
        noVouchersLabel.textContent = this.config.noVouchersMessage;
        voucherSection.appendChild(noVouchersLabel);
      }

      if (voucherSection.children.length > 0) {
        container.appendChild(voucherSection);
      }
    }

    wrapper.appendChild(container);
    return wrapper;
  },

  generateQRCode: function (elementId) {
    return elementId;
  }
});
