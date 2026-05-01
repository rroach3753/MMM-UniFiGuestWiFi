# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
