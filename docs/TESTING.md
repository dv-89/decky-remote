# Validation and device acceptance

Local automated checks cover event schemas and limits, LAN address boundaries, single-use pairing and rate limits, session tokens and source IP binding, text validation, release on disconnect/timeout, session expiration, uinput event/structure packing, separate keyboard/mouse capabilities, HTTP asset delivery, unauthorized requests, cross-origin and DNS rebinding protection, duplicate headers, path allowlists, service shutdown with idle connections, occupied ports, input device failures, browser key/mouse/text behavior and the built Decky entry point.

Windows tests mock uinput and check its emitted binary ABI. They do not demonstrate that Linux accepts the devices or that Steam/Game Mode reacts to them. The tests never inject input into the laptop's operating system.

Verified locally on October 11, 2026: TypeScript typecheck and Rollup build passed; 14 Python backend/protocol/HTTP checks, 5 browser-client checks and 1 compiled-plugin check passed. An actual browser connected to the localhost demo, paired, sent sample text, started/paused capture and disconnected successfully. [Controller screenshot](laptop-controller.png) shows the demo interface. The demo server was stopped after verification. The installable archive's file allowlist and SHA-256 are checked separately during packaging.

## On the Legion Go S

- Install the release ZIP and confirm **Decky Remote** appears alongside existing plugins.
- Confirm a fresh load says **Remote input is off** and the port is closed until enabled.
- Enable input. Verify no /dev/uinput error appears, the correct Wi-Fi address is displayed, and the eight-digit code appears.
- On the laptop open that address. Try an incorrect code, then the correct one. Confirm Decky displays the laptop's IP and hides the consumed code.
- In a harmless Steam search field, send `Hello, Legion! 123` and verify punctuation, case and digits with a US keyboard layout and Caps Lock off. Try the arrow, Enter, Backspace and Escape buttons.
- Start keyboard control, focus the pad and type. Hold and release a key. Switch windows while holding a key; verify it releases immediately or within the three-second watchdog limit.
- Move the cursor by dragging the pad; test left/right/middle click and scrolling where the UI supports a mouse. In a safe game/desktop test area, capture the mouse and test click/hold/drag/release. Escape must exit capture and release all inputs.
- Disconnect the laptop through Decky. Verify the old browser can no longer send input and Decky displays a fresh code. Pair again.
- Turn off laptop Wi-Fi while holding a key/button. Verify release within approximately three seconds; reconnect and pair using the new code.
- Stop input. Verify port 8765 closes, both virtual devices disappear, and the laptop loses control. Enable and repeat once.
- Reload/uninstall the plugin while paired. Verify the listener closes, input releases, and the next load starts disabled.
- Leave Legion Library and other plugins installed; confirm their normal behavior still works.

If enabling fails, record the exact error from the Decky panel. If connections fail, check LAN client isolation, the displayed IP and port, and the device firewall before changing the plugin. Hardware acceptance is pending until this checklist is performed.
