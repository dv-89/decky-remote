# Decky Remote 0.1.8

A Decky plugin that turns a laptop/mobile browser into controls for a Legion Go S running SteamOS, with an action to open the system Dolphin file manager in Gaming Mode. Both devices connect to the same trusted private LAN. Look at the handheld's screen while controlling it; the remote page sends input without screen mirroring.

**Status:** prototype built for SteamOS. Local tests use simulated input devices on Windows. Actual uinput delivery, SteamOS Gaming Mode and Legion Go S compatibility still need the hardware checks in [docs/TESTING.md](docs/TESTING.md).

## Install and connect

[Download the installable ZIP](https://github.com/dv-89/decky-remote/releases/download/v0.1.8/decky-remote-0.1.8.zip). You can also paste the following address into Decky's **Install Plugin from URL**:

```text
https://github.com/dv-89/decky-remote/releases/download/v0.1.8/decky-remote-0.1.8.zip
```

GitHub's **Download ZIP** button downloads source code, which is different from the installable plugin ZIP linked above.

If you installed the earlier **Legion Remote** build, stop its remote input service and uninstall it through Decky before installing **Decky Remote**. The renamed package uses a different plugin folder; leaving the old copy enabled can occupy the same network port.

To upgrade an earlier Decky Remote build, stop remote input, install the 0.1.8 ZIP over the existing plugin, enable input again, reload the controller page and pair with the new code. Update the laptop helper too if using Unlimited capture.

1. Transfer `release/decky-remote-0.1.8.zip` to the handheld using a USB drive or your usual file-transfer tool.
2. In Decky's settings, enable Developer mode and select **Install Plugin from ZIP File**. Choose this ZIP. Menu wording may differ by Decky version. The ZIP's root folder is `decky-remote/`; it is a separate installation from Legion Library.
3. Connect the laptop and handheld to the same trusted private Wi-Fi or LAN.
4. Open **Decky → Decky Remote → Enable remote input** on the Legion.
5. On a laptop, download and extract the [Windows helper ZIP](https://github.com/dv-89/decky-remote/releases/download/v0.1.8/decky-remote-laptop-0.1.8-windows.zip). Run **DeckyRemoteHelper.exe** and enter the displayed handheld address (for example, `http://192.168.1.42:8765`). Keep its window open and use the localhost controller it opens in Chrome or Edge. On a phone, open the displayed handheld address directly for Touchpad control.
6. Enter the eight-digit code shown in Decky, preserving any leading zeroes. One laptop can pair at a time.
7. **Unlimited capture** is selected on laptops: Start control enters fullscreen, captures Escape and hides your laptop cursor. Move, click, drag, scroll and type freely. On touch devices, **Touchpad** is selected automatically: drag inside the pad and use the grouped click/navigation buttons. **Send text** has its own tab.
8. **Tap Escape** to send it to the handheld while staying in control. **Hold Escape for about two seconds** to release control and return your laptop cursor. A long press also sends one Escape at its start; auto-repeat sends no additional Escape events. Short double/triple taps do not pause. Pause, changing tools/windows, leaving fullscreen and losing mouse capture also release input.
9. Use **Stop remote input** in Decky when finished. **Disconnect laptop** revokes its session and creates a new pairing code while leaving the listener enabled.

The Windows helper is portable and includes Python; no separate runtime installation is needed. It runs only while its window is open and serves only this laptop through loopback. The laptop never needs your Steam password. No input or pairing credentials are saved to disk. The plugin always starts disabled after a restart, reload or reinstall. Linux/macOS users with Python 3.11+ can run the helper from source; see [laptop/README.md](laptop/README.md).

## Dolphin in Gaming Mode

Open **Decky → Decky Remote → Open Dolphin**. This launches the installed KDE Dolphin file manager through Steam, without switching to Desktop Mode or enabling remote input. The first launch adds **Dolphin (Decky Remote)** to your current Steam account's non-Steam library; later launches reuse it.

- Browse paths, copy files/folders, rename, move and manage files using Dolphin's own interface. Use the Legion touchscreen or paired laptop keyboard/mouse. Dolphin runs as the signed-in SteamOS user, with that user's ordinary filesystem permissions.
- In Dolphin, **Ctrl+L** focuses the editable location/path, **Ctrl+C / Ctrl+V** copy and paste files, **Ctrl+X / Ctrl+V** move files, **F3** toggles split view, and **Ctrl+Q** quits. Steam's menu also offers the usual return/exit controls for a running app.
- Steam launches a new Dolphin window through XWayland so Gamescope can associate it with the running shortcut. The plugin does not switch sessions, launch a full desktop, or install another file manager. `/usr/bin/dolphin` must already be installed; otherwise the panel displays an error.
- The plugin remembers the shortcut ID in Steam's browser storage, separately for each Steam account, and also searches the current library for its existing entry. Retries, reloads and reinstalls reuse that entry; a renamed entry can be reused while its saved binding remains available. This storage contains only the shortcut ID, with no input or pairing credentials.
- The shortcut remains useful after plugin uninstall. Remove **Dolphin (Decky Remote)** from Steam's non-Steam library if you no longer want it. If an earlier version already created extra entries, confirm the updated button works before removing the extras through Steam. The plugin reuses an existing entry without automatically deleting old duplicates.
- Dolphin's window, dialogs, clipboard and Steam focus still need testing on the Legion. Launching an app through Steam does not give Dolphin native gamepad navigation; use touchscreen or remote mouse input, or set a mouse/keyboard controller layout in Steam.

The previous custom Files page and its file-copy RPCs have been removed. The LAN controller has no file-management or app-launch endpoint.

## Input and connection limits

- Vertical and horizontal trackpad scrolling are forwarded as mouse-wheel input. The selected handheld app must support the requested direction; scrolling does not emulate touchscreen swipes.
- Keyboard keys include letters, digits, modifiers, arrows, navigation, F1–F12 and the numeric keypad. SteamOS interprets key positions according to its configured keyboard layout. Browser/Windows shortcuts can be intercepted before the page receives them.
- **Send text** supports 1–128 ASCII characters plus tabs and newlines. It simulates US English key positions; set the handheld to a US English keyboard layout and turn Caps Lock off for accurate text. Unicode, IME input and clipboard synchronization are not included.
- Unlimited capture requires browser Keyboard Lock, script-initiated fullscreen and a secure context. The helper's localhost address provides that context without certificates. The direct handheld HTTP page supports Touchpad, but cannot keep mouse capture on a single physical Escape. Unsupported browsers or denied requests leave control paused and explain the next step. Chrome's built-in long-Escape emergency exit remains available; see [Keyboard Lock documentation](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock).
- Input capture requires the controller page to stay active. A website cannot capture input across other laptop applications or guarantee forwarding Windows/browser shortcuts; that would require a native laptop companion app. The laptop's screen remains local.
- Switching windows, pausing control, or losing pad focus releases held keys/buttons. A handheld watchdog revokes the session and releases inputs after three seconds without valid traffic. Browser background throttling or device sleep can end a session; pair again using the new code. Sessions expire after one hour even with heartbeats.
- The server listens on IPv4 TCP port 8765 and accepts only RFC1918 private or loopback source addresses. Use the numeric address shown by Decky. IPv6-only networks, DNS names, remote internet control and Bluetooth/USB control are not implemented.
- Guest Wi-Fi may isolate clients. If the page is unreachable, check that both devices are on the same LAN, that Wi-Fi client isolation is off, and that the handheld's firewall permits inbound TCP 8765. The plugin does not change firewall/router settings. Stop and enable again after switching networks to refresh the addresses.
- Mouse input in Gaming Mode depends on Steam's current UI/game. Some controller-oriented menus may respond better to keyboard arrows and Enter. Physical device testing is required.

## Permissions and pairing

The plugin manifest requests Decky's `root` flag to open `/dev/uinput`. It creates two temporary devices, **Decky Remote Keyboard** and **Decky Remote Mouse**, when enabled. Stopping/unloading closes their file descriptors and destroys them. It does not run shell commands, install packages or change system files. The local Decky panel asks Steam to create/reuse a native Dolphin shortcut and launch it as the Steam user; the root backend only checks the installed Dolphin path and user home. If uinput is absent or unavailable, enabling fails with an error shown in the Decky panel.

The laptop page and input API are served over **unencrypted HTTP** on the handheld. Use only a trusted private network. Avoid entering passwords or other sensitive information through this prototype. The code and session token protect pairing but do not encrypt network traffic; a network observer could capture them. Do not expose this port through a router or public proxy.

Pairing uses a random single-use eight-digit code and a random 256-bit session token kept in browser memory. Tokens are also bound to the laptop's source IP. Pairing is limited to five attempts per minute across all clients. Exact Host/Origin checks, JSON-only POST requests, blocked cross-site requests and a restrictive content security policy reduce browser-based misuse. The API accepts only validated, size-limited input events and text; it has no file access or command execution endpoint. Dolphin launch metadata is available through local Decky RPC; the LAN API cannot start apps or browse files. HTTP requests have a five-second deadline and connections are capped at sixteen.

The device controls when the service runs. Uninstall through Decky's plugin settings to remove it. No persistent input service, background laptop helper or system configuration needs to be undone. The Dolphin non-Steam shortcut can be removed separately through Steam.

## Changes in 0.1.8

- Remove Pad control and make **Unlimited capture** the laptop default, retaining Touchpad for mobile use.
- Capture Escape with Keyboard Lock in fullscreen: short presses reach the handheld, while holding Escape about two seconds releases control. Remove double/triple-press pause behavior and ignore Escape auto-repeat.
- Add a portable Windows localhost helper and Python source for other systems. No HTTPS certificate setup is needed. The helper forwards only the existing input API; pairing and event validation remain on the handheld.
- Build, test and attach the Windows helper ZIP and checksum automatically alongside the Decky installer on each release.

## Changes in 0.1.7

- Fix the **.for is not iterable** crash introduced in 0.1.6. Read shortcut IDs through Steam's collection `keys()` interface and fetch each overview from `appStore`, supporting ID Sets, Maps and collections without a direct iterator. This follows [MoonDeck's collection interface](https://github.com/FrogTheFrog/moondeck/blob/main/src/steam-utils/getCollectionStore.ts).
- Recover unfinished entries named `dolphin"` from older versions, repair their target/start directory, restore launch options and rename them to **Dolphin (Decky Remote)**. Explicit foreign executable targets are left unchanged.
- If existing shortcut overviews are still loading, ask for a retry instead of adding another entry before they can be identified.

## Changes in 0.1.6

- Fix **Steam could not load Dolphin's shortcut** when Steam omits details for an otherwise working shortcut. Configure and launch the managed entry without requiring a metadata read-back.
- Reuse existing plugin shortcuts using the library's actual map IDs and a saved binding per Steam account. Save the ID before configuration so failed attempts and reinstalls do not keep adding shortcuts.
- Pass raw executable and working-directory paths to Steam, which handles quoting internally. Repair legacy double-quoted Dolphin targets when reusing an entry.

## Changes in 0.1.5

- Fix the launcher reporting **Steam has not saved Dolphin's launch settings** on SteamOS. Load the details before writing, use Steam's shortcut-specific options API, and refresh snapshots to see delayed changes.
- Stop requiring an exact working-directory read-back: Steam can omit or normalize it. If Steam omits the shortcut-options field, use the native setter without treating the separate general app property as a failure. Explicit shortcut values are still checked when reported, and the executable must remain Dolphin.
- Normalize Steam app IDs to unsigned values for native calls and explicitly apply the shortcut name so repeat presses can reuse it when Steam ignores AddShortcut's name argument.

## Changes in 0.1.4

- Replaced the custom Files page with **Open Dolphin**, launching the installed system file manager in Gaming Mode through a reusable Steam shortcut.
- Dolphin runs under the Steam user, with its normal file operations and permissions. No direct file-management RPCs remain in the root plugin.
- Mobile controls and the single/triple Escape behavior from 0.1.3 are retained.

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
npm run test:dolphin
npm run build
npm run test:bundle
npm run package
```

This plugin has its own manifest, source, backend and package. The archive includes rebuildable source and the bundled Decky API notices. It excludes tests, caches, `node_modules` and other plugins.

For a laptop-only browser demo, run `python scripts/preview.py` and open `http://127.0.0.1:8766`. The initial demo code is `12345678`. All input is discarded; this does not connect to or control the handheld or laptop. After disconnecting, restart the demo for the initial code. Ctrl+C stops it.

## Automated releases

[Build and release workflow](https://github.com/dv-89/decky-remote/actions/workflows/release.yml) runs the tests, builds the plugin and portable Windows helper, verifies their ZIPs and checksums, then publishes release assets when requested. GitHub's built-in token handles publishing; no personal access token or extra secret is needed.

For a release from GitHub's website:

1. Update the version in `package.json` and both root version fields in `package-lock.json` (or use `npm version 0.1.8 --no-git-tag-version`), and the versioned download links in `web/index.html`, this README and `laptop/README.md`. Commit and push the changes, along with any new code and release documentation.
2. Open **Actions → Build and release → Run workflow**, choose the branch, leave **Publish the package version as a GitHub release** checked, and run it. The workflow creates the matching version tag if needed and publishes the ZIP and `.sha256` after all checks pass. Uncheck Publish to test the build without releasing.
3. Open the new release and copy the link to `decky-remote-<version>.zip` for Decky's URL installer. It uses `/releases/download/v<version>/decky-remote-<version>.zip`.

Alternatively, after committing the new version, push a matching tag:

```powershell
git tag v0.1.8
git push origin v0.1.8
```

Tag pushes publish automatically. Regular pushes to `main` and pull requests only validate/build and save downloadable workflow artifacts. `0.x` versions and versions containing a prerelease suffix are marked **Pre-release**; stable `1.x` and later versions are published as regular releases. Titles and change notes are generated automatically.

Existing releases are never overwritten. A manual run also refuses to reuse a tag pointing at a different commit; select that tag in Run workflow or bump the version for new code. If uploading fails after creating a draft, the release stays a draft: inspect it in Releases and remove that incomplete draft before retrying (keep a matching tag pointing at the intended commit).

This automates publishing on GitHub. Decky Remote still needs manual installation of each update through Decky; this workflow does not add an in-plugin updater.

## References

The backend follows the [Linux uinput interface](https://docs.kernel.org/input/uinput.html) and [uinput ABI](https://github.com/torvalds/linux/blob/master/include/uapi/linux/uinput.h). The plugin lifecycle and build conventions follow [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) and the [official plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template). Own code is MIT; see LICENSE and THIRD_PARTY_NOTICES.md for included dependencies.
