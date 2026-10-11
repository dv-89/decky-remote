# Legion Remote 0.1.0

A separate Decky plugin that turns a laptop browser into a keyboard and mouse for a Legion Go S running SteamOS. Both devices connect to the same trusted private LAN. Look at the handheld's screen while controlling it; this version sends input only.

**Status:** prototype built for SteamOS. Local tests use simulated input devices on Windows. Actual uinput delivery, SteamOS Gaming Mode and Legion Go S compatibility still need the hardware checks in [docs/TESTING.md](docs/TESTING.md).

## Install and connect

[Download the installable ZIP](https://github.com/dv-89/wireless-remote/raw/refs/heads/main/release/legion-remote-0.1.0.zip). You can also paste the following address into Decky's **Install Plugin from URL**:

```text
https://raw.githubusercontent.com/dv-89/wireless-remote/main/release/legion-remote-0.1.0.zip
```

GitHub's **Download ZIP** button downloads source code, which is different from the installable plugin ZIP linked above.

1. Transfer `release/legion-remote-0.1.0.zip` to the handheld using a USB drive or your usual file-transfer tool.
2. In Decky's settings, enable Developer mode and select **Install Plugin from ZIP File**. Choose this ZIP. Menu wording may differ by Decky version. The ZIP's root folder is `legion-remote/`; it is a separate installation from Legion Library.
3. Connect the laptop and handheld to the same trusted private Wi-Fi or LAN.
4. Open **Decky → Legion Remote → Enable remote input** on the Legion.
5. Type the displayed address (for example, `http://192.168.1.42:8765`) into the laptop's browser. Use the full numeric address, including `http://` and the port.
6. Enter the eight-digit code shown in Decky, preserving any leading zeroes. One laptop can pair at a time.
7. Select a text field on the handheld. On the laptop, use **Send text**, or choose **Start control** and type while the touchpad area has focus.
8. Drag in the pad to move the mouse, scroll over it, and use the click buttons. **Capture mouse** optionally sends relative mouse movement and physical mouse clicks while the pointer is locked to the pad. Press Escape to pause; use the **Escape** button to send Escape to the handheld.
9. Use **Stop remote input** in Decky when finished. **Disconnect laptop** revokes its session and creates a new pairing code while leaving the listener enabled.

Nothing needs to be installed on the laptop. The laptop never needs your Steam password. No input or pairing credentials are saved to disk. The plugin always starts disabled after a restart, reload or reinstall.

## Input and connection limits

- Keyboard keys include letters, digits, modifiers, arrows, navigation, F1–F12 and the numeric keypad. SteamOS interprets key positions according to its configured keyboard layout. Browser/Windows shortcuts can be intercepted before the page receives them.
- **Send text** supports 1–128 ASCII characters plus tabs and newlines. It simulates US English key positions; set the handheld to a US English keyboard layout and turn Caps Lock off for accurate text. Unicode, IME input and clipboard synchronization are not included.
- Touchpad mode moves the cursor and provides separate click buttons. Capture mouse supports holding mouse buttons for dragging. The browser must keep the controller page active for continuous control.
- Switching windows, pausing control, or losing pad focus releases held keys/buttons. A handheld watchdog revokes the session and releases inputs after three seconds without valid traffic. Browser background throttling or device sleep can end a session; pair again using the new code. Sessions expire after one hour even with heartbeats.
- The server listens on IPv4 TCP port 8765 and accepts only RFC1918 private or loopback source addresses. Use the numeric address shown by Decky. IPv6-only networks, DNS names, remote internet control and Bluetooth/USB control are not implemented.
- Guest Wi-Fi may isolate clients. If the page is unreachable, check that both devices are on the same LAN, that Wi-Fi client isolation is off, and that the handheld's firewall permits inbound TCP 8765. The plugin does not change firewall/router settings. Stop and enable again after switching networks to refresh the addresses.
- Mouse input in Gaming Mode depends on Steam's current UI/game. Some controller-oriented menus may respond better to keyboard arrows and Enter. Physical device testing is required.

## Permissions and pairing

The plugin manifest requests Decky's `root` flag to open `/dev/uinput`. It creates two temporary devices, **Legion Remote Keyboard** and **Legion Remote Mouse**, when enabled. Stopping/unloading closes their file descriptors and destroys them. It does not run shell commands, install packages, change system files or read Steam account data. If uinput is absent or unavailable, enabling fails with an error shown in the Decky panel.

The laptop page and input API are served over **unencrypted HTTP** on the handheld. Use only a trusted private network. Avoid entering passwords or other sensitive information through this prototype. The code and session token protect pairing but do not encrypt network traffic; a network observer could capture them. Do not expose this port through a router or public proxy.

Pairing uses a random single-use eight-digit code and a random 256-bit session token kept in browser memory. Tokens are also bound to the laptop's source IP. Pairing is limited to five attempts per minute across all clients. Exact Host/Origin checks, JSON-only POST requests, blocked cross-site requests and a restrictive content security policy reduce browser-based misuse. The API accepts only validated, size-limited input events and text; it has no file access or command execution endpoint. HTTP requests have a five-second deadline and connections are capped at sixteen.

The device controls when the service runs. Uninstall through Decky's plugin settings to remove it. No persistent input service, background laptop helper or system configuration needs to be undone.

## Build

From the source checkout's root directory, with Node.js and Python 3.11+ available:

```powershell
npm ci
npm run typecheck
npm test
npm run test:client
npm run build
npm run test:bundle
npm run package
```

This plugin has its own manifest, source, backend and package. The archive includes rebuildable source and the bundled Decky API notices. It excludes tests, caches, `node_modules` and other plugins.

For a laptop-only browser demo, run `python scripts/preview.py` and open `http://127.0.0.1:8766`. The initial demo code is `12345678`. All input is discarded; this does not connect to or control the handheld or laptop. After disconnecting, restart the demo for the initial code. Ctrl+C stops it.

## References

The backend follows the [Linux uinput interface](https://docs.kernel.org/input/uinput.html) and [uinput ABI](https://github.com/torvalds/linux/blob/master/include/uapi/linux/uinput.h). The plugin lifecycle and build conventions follow [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) and the [official plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template). Own code is MIT; see LICENSE and THIRD_PARTY_NOTICES.md for included dependencies.
