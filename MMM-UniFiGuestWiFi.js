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
    verifySSL: true,
    requestTimeout: 10000,
    refreshInterval: 300000,
    title: "Guest WiFi",
    layoutVertical: true,
    showSSID: true,
    showPassword: false,
    showSecurityType: true,
    showWiFiStandard: true,
    enhancedWiFiStandardDetection: true,
    showVoucher: true,
    maskPassword: true,
    voucherLabel: "Guest Code",
    includeHotspotPassword: false,
    qrSize: 150,
    colorDark: "#000000",
    colorLight: "#ffffff",
    emptyMessage: "No guest WiFi configured.",
    loadingMessage: "Loading guest WiFi details...",
    noVouchersMessage: "No active vouchers available",
    captivePortalHint: "If the portal page does not open automatically, close Camera and open your favorite browser."
  },

  start: function () {
    this.instanceId = this.identifier || this.name;
    this.hasRenderedData = false;
    this.dataState = {
      ssid: null,
      password: null,
      securityType: null,
      wifiStandard: null,
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

    this.sendSocketNotification("UNIFI_GUESTWIFI_CONFIG", {
      ...this.config,
      instanceId: this.instanceId
    });

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
    var data = payload || {};

    if (data.instanceId && data.instanceId !== this.instanceId) {
      return;
    }

    if (notification === "UNIFI_GUESTWIFI_DATA") {
      this.dataState = {
        ssid: data.ssid || null,
        password: data.password || null,
        securityType: data.securityType || "WPA",
        wifiStandard: data.wifiStandard || null,
        isHidden: data.isHidden || false,
        qrString: data.qrString || null,
        qrImageDataUrl: data.qrImageDataUrl || null,
        voucherCode: data.voucherCode || null,
        voucherStatus: data.voucherStatus || null,
        hotspotPassword: data.hotspotPassword || null,
        fetchedAt: data.fetchedAt || Date.now(),
        error: null,
        loading: false
      };
      this.configRetryCount = 0;
      this.clearRetryTimer();
      this.updateDom(this.hasRenderedData ? 0 : 300);
      this.hasRenderedData = true;
    } else if (notification === "UNIFI_GUESTWIFI_ERROR") {
      this.dataState.error = data.error || "Unknown error";
      this.dataState.loading = false;
      this.clearRetryTimer();
      this.updateDom(this.hasRenderedData ? 0 : 300);
      this.hasRenderedData = true;
    }
  },

  isPasswordlessSecurity: function (securityType) {
    return securityType === "OPEN" || securityType === "OWE" || securityType === "OWE_TRANSITION";
  },

  createStatusElement: function (className, message) {
    var element = document.createElement("div");
    element.className = className;
    element.textContent = message;
    return element;
  },

  createLabeledValueRow: function (rowClass, labelText, valueText) {
    var row = document.createElement("div");
    var label = document.createElement("span");
    var value = document.createElement("span");

    row.className = rowClass;
    label.className = "label";
    label.textContent = labelText;
    value.className = "value";
    value.textContent = valueText;

    row.appendChild(label);
    row.appendChild(value);

    return {
      row: row,
      value: value
    };
  },

  appendSSIDRow: function (container) {
    var rowData;
    var hiddenBadge;

    if (!this.config.showSSID) {
      return;
    }

    rowData = this.createLabeledValueRow("ssid-row", "Network:", this.dataState.ssid);

    if (this.dataState.isHidden) {
      hiddenBadge = document.createElement("span");
      rowData.value.appendChild(document.createElement("br"));
      hiddenBadge.className = "hidden-badge";
      hiddenBadge.textContent = "(Hidden)";
      rowData.value.appendChild(hiddenBadge);
    }

    container.appendChild(rowData.row);
  },

  appendSecurityMetaRow: function (container) {
    var securityMetaRow;
    var securityEl;
    var securityBadge;
    var securityTypeText;
    var wifiStandardEl;
    var wifiStandardBadge;

    if (!this.config.showSecurityType && !(this.config.showWiFiStandard && this.dataState.wifiStandard)) {
      return;
    }

    securityMetaRow = document.createElement("div");
    securityMetaRow.className = "security-meta-row";

    if (this.config.showSecurityType) {
      securityEl = document.createElement("div");
      securityBadge = document.createElement("span");
      securityTypeText = String(this.dataState.securityType || "OPEN");

      securityEl.className = "security-row";
      securityBadge.className = "security-badge security-" + securityTypeText.toLowerCase();
      securityBadge.textContent = securityTypeText.replace(/_/g, " ");
      securityEl.appendChild(securityBadge);
      securityMetaRow.appendChild(securityEl);
    }

    if (this.config.showWiFiStandard && this.dataState.wifiStandard) {
      wifiStandardEl = document.createElement("div");
      wifiStandardBadge = document.createElement("span");

      wifiStandardEl.className = "wifi-standard-row";
      wifiStandardBadge.className = "wifi-standard-badge";
      wifiStandardBadge.textContent = this.dataState.wifiStandard;

      wifiStandardEl.appendChild(wifiStandardBadge);
      securityMetaRow.appendChild(wifiStandardEl);
    }

    container.appendChild(securityMetaRow);
  },

  appendPasswordRow: function (container) {
    var rowData;

    if (!this.config.showPassword || !this.dataState.password || this.isPasswordlessSecurity(this.dataState.securityType)) {
      return;
    }

    rowData = this.createLabeledValueRow("password-row", "Password:", "");
    if (this.config.maskPassword) {
      rowData.value.textContent = "•".repeat(Math.min(this.dataState.password.length, 12));
    } else {
      rowData.value.textContent = this.dataState.password;
    }

    container.appendChild(rowData.row);
  },

  createQRCodeSection: function () {
    var qrSection;
    var qrContainer;
    var qrImage;
    var portalPwdWrap;
    var portalPwdLabel;
    var portalPwdValue;
    var portalHint;

    if (!this.dataState.qrImageDataUrl && !this.dataState.qrString) {
      return null;
    }

    qrSection = document.createElement("div");
    qrContainer = document.createElement("div");

    qrSection.className = "qr-section";
    qrContainer.className = "qr-container";

    if (this.dataState.qrImageDataUrl) {
      qrImage = document.createElement("img");
      qrImage.src = this.dataState.qrImageDataUrl;
      qrImage.alt = "QR code for " + this.dataState.ssid;
      qrImage.width = this.config.qrSize;
      qrImage.height = this.config.qrSize;
      qrContainer.appendChild(qrImage);
    }

    qrSection.appendChild(qrContainer);

    if (this.dataState.hotspotPassword && this.config.includeHotspotPassword) {
      portalPwdWrap = document.createElement("div");
      portalPwdLabel = document.createElement("div");
      portalPwdValue = document.createElement("div");

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
      portalHint = document.createElement("div");
      portalHint.className = "portal-hint";
      portalHint.textContent = this.config.captivePortalHint;
      qrSection.appendChild(portalHint);
    }

    return qrSection;
  },

  createVoucherSection: function () {
    var voucherSection;
    var voucherLabel;
    var voucherCode;
    var noVouchersLabel;

    if (!this.config.showVoucher) {
      return null;
    }

    voucherSection = document.createElement("div");
    voucherSection.className = "voucher-section";

    if (this.dataState.voucherCode) {
      voucherLabel = document.createElement("div");
      voucherCode = document.createElement("div");

      voucherLabel.className = "label";
      voucherLabel.textContent = this.config.voucherLabel;
      voucherCode.className = "voucher-code";
      voucherCode.textContent = this.dataState.voucherCode;
      voucherSection.appendChild(voucherLabel);
      voucherSection.appendChild(voucherCode);
    } else if (this.dataState.hotspotPassword && this.config.includeHotspotPassword) {
      noVouchersLabel = document.createElement("div");
      noVouchersLabel.className = "label warning";
      noVouchersLabel.textContent = this.config.noVouchersMessage;
      voucherSection.appendChild(noVouchersLabel);
    }

    return voucherSection.children.length > 0 ? voucherSection : null;
  },

  getDom: function () {
    var wrapper = document.createElement("div");
    var container;
    var contentWrapper;
    var infoSection;
    var qrSection;
    var voucherSection;

    wrapper.className = "mmm-unifi-guestwifi";

    if (this.dataState.loading) {
      wrapper.appendChild(this.createStatusElement("message", this.config.loadingMessage));
      return wrapper;
    }

    if (this.dataState.error) {
      wrapper.appendChild(this.createStatusElement("error", this.dataState.error));
      return wrapper;
    }

    if (!this.dataState.ssid) {
      wrapper.appendChild(this.createStatusElement("message", this.config.emptyMessage));
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

    this.appendSSIDRow(infoSection);
    this.appendSecurityMetaRow(infoSection);
    this.appendPasswordRow(infoSection);

    contentWrapper.appendChild(infoSection);

    qrSection = this.createQRCodeSection();
    if (qrSection) {
      contentWrapper.appendChild(qrSection);
    }

    container.appendChild(contentWrapper);

    voucherSection = this.createVoucherSection();
    if (voucherSection) {
      container.appendChild(voucherSection);
    }

    wrapper.appendChild(container);
    return wrapper;
  },

  generateQRCode: function (elementId) {
    return elementId;
  }
});
