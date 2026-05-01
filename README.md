# MMM-UniFiGuestWiFi

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module for displaying UniFi Hotspot WiFi network details, including SSID, password, QR code, and available voucher codes.

## Features

- **Multiple Data Sources**: Fetch Hotspot WiFi details from UniFi controller API (with guest fallback for compatibility) or use configuration-based settings
- **WiFi Security Support**: Open, OWE, OWE Transition, WPA, WPA2, and WPA3 networks
- **QR Code Generation**: WiFi connection strings with proper encoding for special characters
- **Hidden SSID Support**: Display and encode hidden networks correctly
- **Voucher Integration**: Displays next available active voucher code from MMM-UniFiHotspotVouchers or direct API query
- **Fallback Support**: Shows hotspot portal password when no vouchers are available
- **Password Masking**: Optional password display masking in the UI (QR code still contains actual password)
- **Responsive Layouts**: Vertical (default) or horizontal layout options
- **Customizable Styling**: QR code size, colors, and display options

## Prerequisites

1. A working MagicMirror² installation
2. For API mode: A UniFi OS console (Cloud Key, UDM, or similar) with Network application
3. For API mode: Local UniFi OS username and password with Network permissions
4. (Optional) MMM-UniFiHotspotVouchers module for voucher data integration

## Installation

### Option 1: Standard Install (Git)

From your MagicMirror `modules` folder:

```bash
cd MagicMirror/modules
git clone https://github.com/rroach3753/MMM-UniFiGuestWiFi.git
cd MMM-UniFiGuestWiFi
npm install
```

### Option 2: Install with MMPM (MagicMirror Package Manager)

If you use MMPM:

```bash
mmpm install MMM-UniFiGuestWiFi
```

## Configuration

Add this to your `config/config.js` file. See examples below for specific scenarios.

### Basic Structure

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    // Configuration options here
  }
}
```

### Configuration Options

#### Data Source Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `authMode` | string | `"config"` | Data source mode: `"config"` (hardcoded), `"api"` (fetch from UniFi using API key or controller login), or `"auto"` (try API, fallback to config) |

#### Config Mode Options (authMode: "config")

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ssid` | string | `"Guest Network"` | WiFi network name |
| `password` | string | `"guestpass123"` | WiFi password (empty for open networks) |
| `securityType` | string | `"WPA"` | Security type: `"OPEN"`, `"OWE"`, `"OWE_TRANSITION"`, `"WPA"`, `"WPA2"`, or `"WPA3"` |
| `isHidden` | boolean | `false` | Whether the SSID is hidden |

#### API Mode Options (authMode: "api")

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `controllerUrl` | string | `"https://unifi.local"` | UniFi controller URL |
| `apiKey` | string | `""` | UniFi API key (if using API key auth) |
| `apiKeyHeader` | string | `"X-API-Key"` | Header name for API key |
| `username` | string | `""` | UniFi OS username |
| `controllerPassword` | string | `""` | UniFi OS password (preferred field name) |
| `passwordField` | string | `""` | Legacy alias for UniFi OS password (still supported) |
| `site` | string | `"default"` | UniFi site name |
| `verifySSL` | boolean | `false` | Verify SSL certificates |
| `refreshInterval` | number | `300000` | Data refresh interval in milliseconds (5 minutes) |

Authentication behavior in API mode:
- If `apiKey` is set, the module tries API key authentication first.
- If API key does not return usable data and `username` + `controllerPassword` are set, it falls back to controller login.
- If API key is not set, it uses `username` + `controllerPassword` directly.

#### Display Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `"Guest WiFi"` | Module title |
| `layoutVertical` | boolean | `true` | Display layout: `true` for vertical, `false` for horizontal |
| `showSSID` | boolean | `true` | Show SSID/network name |
| `showPassword` | boolean | `true` | Show password (if applicable) |
| `showSecurityType` | boolean | `true` | Show security type badge |
| `showVoucher` | boolean | `true` | Show voucher code section |
| `maskPassword` | boolean | `false` | Mask password display (asterisks/dots) - QR still contains actual password |

#### Voucher Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `voucherLabel` | string | `"Guest Code"` | Label for voucher code display |
| `includeHotspotPassword` | boolean | `true` | Show hotspot portal password when no vouchers available |

#### QR Code Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `qrSize` | number | `150` | QR code size in pixels (width and height) |
| `colorDark` | string | `"#000000"` | QR code dark color (hex) |
| `colorLight` | string | `"#ffffff"` | QR code light color (hex) |

#### Message Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `emptyMessage` | string | `"No guest WiFi configured."` | Message when no WiFi data available |
| `loadingMessage` | string | `"Loading guest WiFi details..."` | Message while loading |
| `noVouchersMessage` | string | `"No active vouchers available"` | Message when no vouchers found |

## Configuration Examples

### Example 1: Config Mode - WPA Network

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "config",
    ssid: "Company Guest Network",
    password: "SecureGuestPass123!",
    securityType: "WPA3",
    isHidden: false,
    title: "Guest WiFi",
    layoutVertical: true,
    maskPassword: false,
    qrSize: 150
  }
}
```

### Example 2: Config Mode - Open Network

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "config",
    ssid: "Public Hotspot",
    password: "", // Empty for open networks
    securityType: "OPEN",
    isHidden: false,
    showPassword: false, // Password field will be hidden
    title: "Free WiFi",
    layoutVertical: true
  }
}
```

### Example 3: Config Mode - Hidden OWE Network with Password Masking

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "config",
    ssid: "Hidden Enterprise",
    password: "EncryptedWithoutPassword",
    securityType: "OWE",
    isHidden: true,
    maskPassword: true, // Password will show as dots
    title: "Enterprise Network",
    layoutVertical: false // Horizontal layout
  }
}
```

### Example 4: API Mode - Fetch from UniFi Controller

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "api",
    controllerUrl: "https://unifi.local",
    username: "admin",
    controllerPassword: "your_unifi_password",
    site: "default",
    verifySSL: false,
    refreshInterval: 300000,
    title: "Guest WiFi",
    showVoucher: true,
    voucherLabel: "Voucher Code",
    includeHotspotPassword: true
  }
}
```

### Example 5: Auto Mode with Fallback

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "auto", // Try API, fall back to config on failure
    // API config
    controllerUrl: "https://unifi.local",
    username: "admin",
    controllerPassword: "your_unifi_password",
    // Fallback config
    ssid: "Guest Network",
    password: "DefaultPassword123",
    securityType: "WPA2",
    // Display options
    layoutVertical: true,
    refreshInterval: 600000 // 10 minutes
  }
}
```

### Example 6: API Key Only (No Controller Login)

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "api",
    controllerUrl: "https://unifi.local",
    apiKey: "YOUR_UNIFI_API_KEY",
    apiKeyHeader: "X-API-Key",
    site: "default",
    verifySSL: false,
    refreshInterval: 300000
  }
}
```

### Example 7: Controller Username/Password Only

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "api",
    controllerUrl: "https://unifi.local",
    username: "admin",
    controllerPassword: "your_unifi_password",
    site: "default",
    verifySSL: false,
    refreshInterval: 300000
  }
}
```

### Example 8: API Key First, Then Login Fallback

```js
{
  module: "MMM-UniFiGuestWiFi",
  position: "top_right",
  config: {
    authMode: "auto",
    controllerUrl: "https://unifi.local",
    apiKey: "YOUR_UNIFI_API_KEY",
    apiKeyHeader: "X-API-Key",
    username: "admin",
    controllerPassword: "your_unifi_password",
    site: "default",
    verifySSL: false,
    refreshInterval: 300000
  }
}
```

## WiFi Security Types

### OPEN
- No authentication required
- QR format: `WIFI:T:nopass;S:NetworkName;;`
- Password field not displayed

### OWE (Opportunistic Wireless Encryption)
- Individualized Data Encryption (IDE) without pre-shared key
- QR format: `WIFI:T:OWE;S:NetworkName;;`
- Password field not displayed

### OWE_TRANSITION
- Network configured for both Open and OWE compatibility
- Displayed as OWE in QR code
- Password field not displayed
- UI shows "OWE Transition" badge

### WPA / WPA2 / WPA3
- Traditional password-protected networks
- QR format: `WIFI:T:WPA;S:NetworkName;P:Password;;`
- Password field displayed (unless masked)
- Supports special characters (URL-encoded in QR)

## QR Code Format Details

All QR codes follow the WiFi connection string format:

```
WIFI:T:{securityType};H:{isHidden};S:{SSID};P:{password};;
```

### Special Character Handling

Special characters in SSID and password are URL-encoded in the QR code per the WiFi QR specification:
- Spaces: `%20`
- Semicolons: `%3B`
- Commas: `%2C`
- Colons: `%3A`
- And other special characters as needed

The UI displays the actual characters for readability.

### Hidden SSID Format

Hidden networks include the `H:true` flag:

```
WIFI:T:WPA;H:true;S:{SSID};P:{Password};;
```

## Voucher Code Integration

### With MMM-UniFiHotspotVouchers

If MMM-UniFiHotspotVouchers is installed and configured, this module will attempt to use its voucher data. The module looks for the first active voucher and displays it.

### Without MMM-UniFiHotspotVouchers

The module can fetch voucher data directly from the UniFi API (in API mode) or can display a fallback message with the hotspot portal password.

### No Vouchers Available

When no active vouchers exist, the module can display:
- The message "No active vouchers available"
- The hotspot portal password (if `includeHotspotPassword: true`)

## Updating

### Standard Update (Git)

From the module folder:

```bash
cd MagicMirror/modules/MMM-UniFiGuestWiFi
git pull
npm install
```

### Update with MMPM

```bash
mmpm update MMM-UniFiGuestWiFi
```

## UniFi API Calls Used

When `authMode` is set to `api` or `auto`, the module detects Hotspot/Guest WiFi networks by trying these endpoints in order (stopping at the first one that returns usable WLAN records):

1. `/proxy/network/api/s/{site}/rest/wlanconf`
2. `/api/s/{site}/rest/wlanconf`
3. `/proxy/network/api/v2/sites/{site}/networks?type=hotspot`
4. `/proxy/network/api/v2/sites/{site}/networks?type=guest`
5. `/api/v2/sites/{site}/networks?type=hotspot`
6. `/api/v2/sites/{site}/networks?type=guest`

Voucher lookup uses:

1. `/proxy/network/api/s/{site}/rest/hotspot/voucher`
2. `/proxy/network/api/s/{site}/stat/voucher`
3. `/api/s/{site}/rest/hotspot/voucher`
4. `/api/s/{site}/stat/voucher`

Hotspot portal settings fallback uses:

1. `/proxy/network/api/s/{site}/get/setting`
2. `/api/s/{site}/get/setting`

Authentication uses session cookies from `POST /api/auth/login` (same pattern used by MMM-UniFiHotspotVouchers), not bearer token-only calls.

## Troubleshooting

### QR Code Not Generating

- Verify the `qrcode.min.js` library is present in the module folder
- Check browser console for JavaScript errors
- Ensure `QRCode` library is loaded before DOM rendering

### WiFi Data Not Displaying

**Config Mode:**
- Verify `ssid` and `password` are correctly configured
- Check `securityType` is one of the supported types

**API Mode:**
- Verify controller URL is accessible and uses HTTPS
- Check username and password are correct
- Verify user has Network app permissions
- Check SSL certificate verification setting (`verifySSL`)
- Look for errors in MagicMirror logs

### Special Characters Not Working in QR

- Ensure the QR code string is properly URL-encoded (this is handled automatically)
- Test the generated QR code with a mobile device
- Some old QR scanners may not support special characters

### Voucher Code Not Displaying

- If using MMM-UniFiHotspotVouchers, ensure it's installed and running
- Verify active vouchers exist in the hotspot portal
- In API mode, verify user has permission to read vouchers
- Check `showVoucher: true` setting

### Password Masking Not Working

- Password masking only applies to WPA/WPA2/WPA3 networks
- Open and OWE networks don't have passwords, so masking has no effect
- QR code always contains the actual password regardless of masking setting

## SSL Certificate Issues

If using a self-signed certificate on your UniFi controller:

```js
config: {
  verifySSL: false // Disable SSL verification (not recommended for production)
}
```

For production environments, consider using a valid SSL certificate.

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

For issues, questions, or suggestions, please visit the repository or create an issue.

## References

- [WiFi QR Code Format Specification](https://github.com/zxing/zxing/wiki/Barcode-Contents#wi-fi-network-config)
- [UniFi Network API Documentation](https://ubntwifi.github.io/unifi-api/)
- [MagicMirror² Documentation](https://docs.magicmirror.builders/)
