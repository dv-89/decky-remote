# Decky Remote 0.1.3

A Decky plugin that turns a laptop/mobile browser into controls for a Legion Go S running SteamOS, with a file browser inside Gaming Mode. Both devices connect to the same trusted private LAN. Look at the handheld's screen while controlling it; the remote page sends input without screen mirroring.

**Status:** prototype built for SteamOS. Local tests use simulated input devices on Windows. Actual uinput delivery, SteamOS Gaming Mode and Legion Go S compatibility still need the hardware checks in [docs/TESTING.md](docs/TESTING.md).

## Install and connect

[Download the installable ZIP](https://github.com/dv-89/decky-remote/raw/refs/heads/main/release/decky-remote-0.1.3.zip). You can also paste the following address into Decky's **Install Plugin from URL**:

```text
https://raw.githubusercontent.com/dv-89/decky-remote/main/release/decky-remote-0.1.3.zip
```

GitHub's **Download ZIP** button downloads source code, which is different from the installable plugin ZIP linked above.

If you installed the earlier **Legion Remote** build, stop its remote input service and uninstall it through Decky before installing **Decky Remote**. The renamed package uses a different plugin folder; leaving the old copy enabled can occupy the same network port.

To upgrade an earlier Decky Remote build, stop remote input, install the 0.1.3 ZIP over the existing plugin, enable input again, reload the laptop/mobile controller page and pair with the new code.

1. Transfer `release/decky-remote-0.1.3.zip` to the handheld using a USB drive or your usual file-transfer tool.
2. In Decky's settings, enable Developer mode and select **Install Plugin from ZIP File**. Choose this ZIP. Menu wording may differ by Decky version. The ZIP's root folder is `decky-remote/`; it is a separate installation from Legion Library.
3. Connect the laptop and handheld to the same trusted private Wi-Fi or LAN.
4. Open **Decky → Decky Remote → Enable remote input** on the Legion.
5. Type the displayed address (for example, `http://192.168.1.42:8765`) into the laptop's browser. Use the full numeric address, including `http://` and the port.
6. Enter the eight-digit code shown in Decky, preserving any leading zeroes. One laptop can pair at a time.
7. Choose **Pad control** on a laptop: Start control enables typing and physical mouse movement/clicks while the pointer is inside the pad, without holding a button. On touch devices, **Touchpad** is selected automatically: drag inside the pad and use the grouped click/navigation buttons. **Send text** has its own tab.
8. In Pad control or Touchpad mode, a single **Escape** sends Back to Steam. **Three quick Escape presses** (less than 900 ms apart) pause control; the Pause button also works. Leaving the pad in Pad control or changing tools/windows pauses input. Optional **Unlimited capture** allows unrestricted movement, but the browser reserves Escape to unlock it. Use the **Back / Esc** button for Steam Back in that mode.
9. Use **Stop remote input** in Decky when finished. **Disconnect laptop** revokes its session and creates a new pairing code while leaving the listener enabled.

Nothing needs to be installed on the laptop. The laptop never needs your Steam password. No input or pairing credentials are saved to disk. The plugin always starts disabled after a restart, reload or reinstall.

## Files in Gaming Mode

Open **Decky → Decky Remote → Open file browser**. This opens a full-screen Files page inside Steam, without switching to Desktop Mode or enabling remote input.

- Browse the handheld user's Home and mounted storage under `/run/media/<user>/`. Show hidden files, enter a folder path, filter names, and navigate folders with the controller or touchscreen.
- Folder and selected-file paths have Decky's built-in clipboard action. Select a file to see its complete path.
- To copy: select a file, open its destination folder (or choose Home/storage), then choose **Copy here**. The source stays intact; an existing destination is never replaced.
- Copies run in a worker so the plugin stays responsive. Home/storage boundaries are checked; file symlinks and special files are not copied. Folder links are navigable when their targets stay in the allowed roots. No file operations are exposed to the paired LAN page.
- File copies only in this version; folder copies, deleting, moving and file-content previews are not included. Large folders show up to 500 items with pagination. Steam gamepad navigation and clipboard behavior still need testing on the handheld.

## Input and connection limits

- Vertical and horizontal trackpad scrolling are forwarded as mouse-wheel input. The selected handheld app must support the requested direction; scrolling does not emulate touchscreen swipes.
- Keyboard keys include letters, digits, modifiers, arrows, navigation, F1–F12 and the numeric keypad. SteamOS interprets key positions according to its configured keyboard layout. Browser/Windows shortcuts can be intercepted before the page receives them.
- **Send text** supports 1–128 ASCII characters plus tabs and newlines. It simulates US English key positions; set the handheld to a US English keyboard layout and turn Caps Lock off for accurate text. Unicode, IME input and clipboard synchronization are not included.
- Pad control does not lock the cursor: input stays inside the pad so single Escape can reach Steam. Unlimited capture uses browser pointer lock; browser Escape-unlock behavior cannot be overridden on this local HTTP page. Three-Escape pause is reliable in Pad control and Touchpad modes.
- Input capture requires the controller page to stay active. A website cannot capture input across other laptop applications or guarantee forwarding Windows/browser shortcuts; that would require a native laptop companion app. The laptop's screen remains local.
- Switching windows, pausing control, or losing pad focus releases held keys/buttons. A handheld watchdog revokes the session and releases inputs after three seconds without valid traffic. Browser background throttling or device sleep can end a session; pair again using the new code. Sessions expire after one hour even with heartbeats.
- The server listens on IPv4 TCP port 8765 and accepts only RFC1918 private or loopback source addresses. Use the numeric address shown by Decky. IPv6-only networks, DNS names, remote internet control and Bluetooth/USB control are not implemented.
- Guest Wi-Fi may isolate clients. If the page is unreachable, check that both devices are on the same LAN, that Wi-Fi client isolation is off, and that the handheld's firewall permits inbound TCP 8765. The plugin does not change firewall/router settings. Stop and enable again after switching networks to refresh the addresses.
- Mouse input in Gaming Mode depends on Steam's current UI/game. Some controller-oriented menus may respond better to keyboard arrows and Enter. Physical device testing is required.

## Permissions and pairing

The plugin manifest requests Decky's `root` flag to open `/dev/uinput`. It creates two temporary devices, **Decky Remote Keyboard** and **Decky Remote Mouse**, when enabled. Stopping/unloading closes their file descriptors and destroys them. It does not run shell commands, install packages or change system files. File operations are available only through the local Decky panel and only within Home and mounted storage. If uinput is absent or unavailable, enabling fails with an error shown in the Decky panel.

The laptop page and input API are served over **unencrypted HTTP** on the handheld. Use only a trusted private network. Avoid entering passwords or other sensitive information through this prototype. The code and session token protect pairing but do not encrypt network traffic; a network observer could capture them. Do not expose this port through a router or public proxy.

Pairing uses a random single-use eight-digit code and a random 256-bit session token kept in browser memory. Tokens are also bound to the laptop's source IP. Pairing is limited to five attempts per minute across all clients. Exact Host/Origin checks, JSON-only POST requests, blocked cross-site requests and a restrictive content security policy reduce browser-based misuse. The API accepts only validated, size-limited input events and text; it has no file access or command execution endpoint. The Gaming Mode file browser uses local Decky RPC instead of the LAN API. HTTP requests have a five-second deadline and connections are capped at sixteen.

The device controls when the service runs. Uninstall through Decky's plugin settings to remove it. No persistent input service, background laptop helper or system configuration needs to be undone.

## Changes in 0.1.3

- Organized mobile Control / Send text tabs, grouped click buttons, navigation pad and collapsible extra keys.
- Single Escape is Steam Back and three quick presses pause in Pad control / Touchpad mode. Unlimited capture remains optional with the browser's Escape limitation labeled.
- Built-in Gaming Mode file browser with paths, hidden files and file copying between Home and mounted storage.

## Changes in 0.1.2

- Two-finger horizontal scrolling now reaches the handheld in Full control and Touchpad modes. Diagonal gestures send both axes, with the same sensitivity as vertical scrolling.
- Partial scroll gestures reset when control pauses.

## Changes in 0.1.1

- **Start control** now captures mouse and keyboard in one action, replacing the separate mouse-capture step.
- Physical clicks, dragging, scrolling and simultaneous mouse-button holds work in full control mode without the pad or click buttons.
- Touchpad mode is an explicit fallback. Capture denial, cancellation and late browser responses leave input paused; Escape, focus loss and session termination release held input.

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

From the source checkout, for a fictional file-browser preview, run `npx vite --config preview/vite.config.mjs` and open `http://127.0.0.1:8767`. This uses in-memory sample files and mock Decky UI components; it never reads or copies real files.

## References

The backend follows the [Linux uinput interface](https://docs.kernel.org/input/uinput.html) and [uinput ABI](https://github.com/torvalds/linux/blob/master/include/uapi/linux/uinput.h). The plugin lifecycle and build conventions follow [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) and the [official plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template). Own code is MIT; see LICENSE and THIRD_PARTY_NOTICES.md for included dependencies.
