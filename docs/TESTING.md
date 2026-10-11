# Validation and device acceptance

Local automated checks cover event schemas and limits, LAN address boundaries, single-use pairing and rate limits, session tokens and source IP binding, text validation, release on disconnect/timeout, session expiration, uinput event/structure packing, separate keyboard/mouse capabilities, HTTP asset delivery, unauthorized requests, cross-origin and DNS rebinding protection, duplicate headers, path allowlists, service shutdown with idle connections, occupied ports, input device failures, browser key/mouse/text behavior and the built Decky entry point.

Windows tests mock uinput and check its emitted binary ABI. They do not demonstrate that Linux accepts the devices or that Steam/Game Mode reacts to them. The tests never inject input into the laptop's operating system.

Version 0.1.0 was verified locally on October 11, 2026: TypeScript typecheck and Rollup build passed; 14 Python backend/protocol/HTTP checks, 5 browser-client checks and 1 compiled-plugin check passed. The user subsequently reported working handheld input from the installed build. This does not establish full acceptance for the new 0.1.1 capture behavior.

The 0.1.1 client checks additionally exercise one-click capture, free mouse movement, physical clicks and simultaneous button holds, duplicate pointer/mouse event handling, unlock/focus/session release, legacy browser events, capture denial, touchpad fallback and cancellation with late browser responses. [Controller screenshot](laptop-controller.png) shows the current demo interface. The installable archive's file allowlist and SHA-256 are checked separately during packaging.

For 0.1.1, TypeScript typecheck, Rollup build, all 8 browser-client checks and the compiled-plugin check passed. In the in-app browser, pairing and the touchpad fallback were verified with simulated input. This browser denied pointer lock, so real mouse capture still needs validation in the user's desktop browser using the checklist below. The Linux backend is unchanged from the version with 14 passing backend checks.

## On the Legion Go S

- Install the release ZIP and confirm **Decky Remote** appears alongside existing plugins.
- Confirm a fresh load says **Remote input is off** and the port is closed until enabled.
- Enable input. Verify no /dev/uinput error appears, the correct Wi-Fi address is displayed, and the eight-digit code appears.
- On the laptop open that address. Try an incorrect code, then the correct one. Confirm Decky displays the laptop's IP and hides the consumed code.
- In a harmless Steam search field, send `Hello, Legion! 123` and verify punctuation, case and digits with a US keyboard layout and Caps Lock off. Try the arrow, Enter, Backspace and Escape buttons.
- Leave **Full control — mouse & keyboard** selected. Click **Start control** once: the cursor must hide and movement must reach the handheld without holding down any button or dragging inside the pad. Type, test physical left/right/middle clicks and scrolling, hold a button to drag, and hold left/right together to verify independent releases.
- Hold a key/button and press Escape or switch windows. Verify pointer lock ends, the laptop cursor returns, and held inputs release immediately or within the three-second watchdog limit. Start control again and verify capture resumes.
- Select **Touchpad — manual fallback** after pausing. Verify dragging the pad, manual click buttons, scrolling and focused typing still work. Text typed in Send text must stay local until sent.
- If the browser denies pointer lock, verify the page remains paused and suggests Touchpad mode. Cancel a pending capture request and verify it never activates later without a new Start control action.
- Disconnect the laptop through Decky. Verify the old browser can no longer send input and Decky displays a fresh code. Pair again.
- Turn off laptop Wi-Fi while holding a key/button. Verify release within approximately three seconds; reconnect and pair using the new code.
- Stop input. Verify port 8765 closes, both virtual devices disappear, and the laptop loses control. Enable and repeat once.
- Reload/uninstall the plugin while paired. Verify the listener closes, input releases, and the next load starts disabled.
- Leave Legion Library and other plugins installed; confirm their normal behavior still works.

If enabling fails, record the exact error from the Decky panel. If connections fail, check LAN client isolation, the displayed IP and port, and the device firewall before changing the plugin. Hardware acceptance is pending until this checklist is performed.
