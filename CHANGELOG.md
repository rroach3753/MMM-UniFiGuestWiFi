# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Security
- Frontend defaults now favor safer mirror displays: `showPassword: false`, `maskPassword: true`, and `includeHotspotPassword: false`.
- Added instance-scoped socket payload routing (`instanceId`) between module frontend and node helper to reduce cross-instance data leakage.

### Changed
- Refresh timer keying now includes instance identity to avoid collisions across multiple module instances.

### Added
- Backend-generated QR image support using server-side QR rendering for improved runtime compatibility.
- WiFi standard badge support in the UI (`showWiFiStandard`) with labels such as WiFi 6E and WiFi 7 when detectable.
- Enhanced WiFi generation detection mode (`enhancedWiFiStandardDetection`, default `true`) that optionally uses AP capability data from UniFi `stat/device`.
- Captive portal onboarding hint below the QR code (`captivePortalHint`).
- Explicit failure state after backend retry exhaustion so loading does not remain indefinite.

### Changed
- QR payload behavior is now captive-portal friendly: QR encodes SSID join metadata only and does not embed portal/voucher passwords.
- Security badge text is now user-friendly (for example, `OWE TRANSITION` instead of `OWE_TRANSITION`).
- Security and WiFi standard badges now render side-by-side in a shared row.
- Voucher section alignment and centering improved for consistent visual layout.
- UniFi API parsing improved to support additional response wrapper shapes and nested record patterns.
- Authentication flow in API mode now more reliably falls back between API key and controller-login paths.

### Fixed
- Fixed stale/inaccurate security classification for Open/OWE/OWE Transition and WPA2/WPA3 edge cases.
- Fixed WPA3 detection when UniFi exposes capability booleans (`wpa3_support`) instead of explicit string markers.
- Fixed Open + OWE non-transition networks being mislabeled as plain OPEN.
- Fixed Open + Enhanced Open with Transition networks being mislabeled as OPEN/WPA3.
- Fixed false WiFi 7 positives in enhanced detection from loose text matching.
- Fixed perpetual loading condition by surfacing a clear UI error after retries are exhausted.
- Fixed voucher card left accent line styling artifact.

### Removed
- Removed legacy voucher sourcing references tied to `MMM-UniFiHotspotVouchers`; voucher retrieval is now documented and supported as API-only.

## [1.0.0] - 2026-04-30

### Added
- Initial release of MMM-UniFiGuestWiFi module
- Support for displaying UniFi guest WiFi network details
- Config-based and API-based data source modes
- Support for all WiFi security types: Open, OWE, OWE Transition, WPA/WPA2/WPA3
- Hidden SSID support with proper QR code encoding
- QR code generation with WiFi connection string format
- Special character URL-encoding for complex passwords and SSIDs
- Integration with MMM-UniFiHotspotVouchers for voucher display
- Hotspot portal password fallback when no vouchers available
- Optional password masking for display
- Vertical and horizontal layout options
- Configurable QR code size and colors
- Responsive styling for various display sizes
- Comprehensive error handling and fallback support
- Auto-refresh with configurable intervals
- SSL verification options for UniFi API connections
