# Validation and device acceptance

Local automated checks cover event schemas and limits, LAN address boundaries, single-use pairing and rate limits, session tokens and source IP binding, text validation, release on disconnect/timeout, session expiration, uinput event/structure packing, separate keyboard/mouse capabilities, HTTP asset delivery, unauthorized requests, cross-origin and DNS rebinding protection, duplicate headers, path allowlists, service shutdown with idle connections, occupied ports, input device failures, browser key/mouse/text behavior and the built Decky entry point.

Windows tests mock uinput and check its emitted binary ABI. They do not demonstrate that Linux accepts the devices or that Steam/Game Mode reacts to them. The tests never inject input into the laptop's operating system.

Version 0.1.0 was verified locally on October 11, 2026: TypeScript typecheck and Rollup build passed; 14 Python backend/protocol/HTTP checks, 5 browser-client checks and 1 compiled-plugin check passed. The user subsequently reported working handheld input from the installed build. This does not establish full acceptance for the new 0.1.1 capture behavior.

The 0.1.1 client checks additionally exercise one-click capture, free mouse movement, physical clicks and simultaneous button holds, duplicate pointer/mouse event handling, unlock/focus/session release, legacy browser events, capture denial, touchpad fallback and cancellation with late browser responses. [Controller screenshot](laptop-controller.png) shows the current demo interface. The installable archive's file allowlist and SHA-256 are checked separately during packaging.

For 0.1.1, TypeScript typecheck, Rollup build, all 8 browser-client checks and the compiled-plugin check passed. In the in-app browser, pairing and the touchpad fallback were verified with simulated input. This browser denied pointer lock, so real mouse capture still needs validation in the user's desktop browser using the checklist below. The Linux backend is unchanged from the version with 14 passing backend checks.

For 0.1.2, TypeScript typecheck, Rollup build and the compiled-plugin check passed. All 16 Python backend/protocol/HTTP checks and 10 browser-client checks passed, including horizontal/diagonal scrolling, pixel/line/page units, fractional deltas, axis limits, pause resets, HTTP delivery and packed Linux horizontal-wheel events. Real horizontal scrolling on the handheld remains pending device validation.

## Version 0.1.5

The user reported the 0.1.4 launch-settings error on the handheld. Version 0.1.5 switches to the shortcut-specific options setter, loads details before setting options, refreshes stale snapshots, and removes the exact working-directory read-back requirement. A missing native shortcut-options field is accepted after the native setter and executable verification; an explicitly mismatching native value still blocks launch. Native IDs are unsigned, and the name is set explicitly for reuse.

The Dolphin tests reproduce a no-op general setter, one-shot stale snapshots, delayed native options, omitted/normalized working directories, omitted native option metadata, signed IDs, ignored shortcut names, API fallback and a changed executable. TypeScript, Rollup, 23 Python checks and all 31 Node checks (13 client, 17 Dolphin, 1 bundle) pass locally. SteamOS window behavior still needs confirmation after the fix is installed.

## Version 0.1.4

The custom file browser has been replaced with a fixed Dolphin launch descriptor and a Steam shortcut launcher. Local checks cover installed/missing executables, home validation, creation, reuse after reload, overlapping clicks, account changes, same-name foreign shortcuts, full 64-bit game IDs, settings confirmation, registration cleanup and failed creation. They simulate Steam APIs; they do not establish that SteamOS displays Dolphin correctly. Existing remote-input checks remain applicable. The removed 0.1.3 file-copy tests are historical only.

TypeScript typecheck and Rollup build pass. All 19 Python checks pass in Ubuntu WSL; all 13 controller-client checks, 10 Dolphin-launcher checks and the compiled-plugin check pass in Node. The package is checked for its single plugin folder, current version and source/bundle contents, removed file-browser components, CRC and SHA-256. Dolphin window focus, dialogs, filesystem operations and exit behavior remain pending the on-device checklist below.

## On the Legion Go S

Version 0.1.3 adds a mobile layout, Escape-friendly pad control and a local Decky file browser. The in-app browser preview verified single Escape keeps Pad control active, three quick presses pause it, and the file-browser selection/destination/copy flow succeeds with fictional data. The mobile Control / Send text layout was checked at 390 and 320 px without horizontal page overflow; [mobile preview](mobile-controller.png) is saved. The historical Files preview used mock Decky components and could not establish Steam controller focus or clipboard behavior; that UI has been removed in 0.1.4.

All 23 Python checks pass in Ubuntu WSL, including real file copies and symlink protection in disposable directories. Windows runs pass with the symlink-creation check skipped because the host does not allow it. Uinput delivery remains mocked in these tests. All 13 client checks pass, including single/repeated/spaced/triple Escape presses, bounded free mouse control, mobile mode selection and tool changes releasing input.

- Install the release ZIP and confirm **Decky Remote** appears alongside existing plugins.
- Confirm a fresh load says **Remote input is off** and the port is closed until enabled.
- Enable input. Verify no /dev/uinput error appears, the correct Wi-Fi address is displayed, and the eight-digit code appears.
- On the laptop open that address. Try an incorrect code, then the correct one. Confirm Decky displays the laptop's IP and hides the consumed code.
- In a harmless Steam search field, send `Hello, Legion! 123` and verify punctuation, case and digits with a US keyboard layout and Caps Lock off. Try the arrow, Enter, Backspace and Escape buttons.
- Choose **Pad control** and Start control. Move/click inside the pad without holding a button. Type and test physical clicks, held-button drags and wheel input. Verify leaving the pad pauses and releases input. With the pad focused, one Escape must send Steam Back and stay active; three rapid presses must pause. Holding Escape must not count as three presses.
- Choose **Unlimited capture** and Start control. Verify the cursor hides and mouse movement/clicks reach the handheld. The browser may unlock on a single physical Escape; use the onscreen Back / Esc button to send Steam Back without requesting an unlock.
- In Desktop Mode, open a page or application with a horizontal scrollbar. In Full control, swipe two fingers left and right on the laptop trackpad and confirm horizontal scrolling reaches the handheld. Test vertical and diagonal scrolling, then repeat over the pad in Touchpad mode. Pause and resume between partial gestures to confirm there is no leftover scrolling. Steam Gaming Mode views may not respond to horizontal wheel input.
- Hold a key/button and pause or switch windows. Verify pointer lock ends if used, the laptop cursor returns, and held inputs release immediately or within the three-second watchdog limit. Start control again and verify capture resumes.
- Select **Touchpad — drag to move** after pausing. Verify dragging the pad, grouped manual buttons, scrolling and focused typing still work. On a phone, verify Touchpad is selected automatically and the Control / Send text tabs fit without sideways page scrolling. Switching to Send text must pause remote input; text must stay local until sent.
- If the browser denies pointer lock, verify the page remains paused and suggests Touchpad mode. Cancel a pending capture request and verify it never activates later without a new Start control action.
- Disconnect the laptop through Decky. Verify the old browser can no longer send input and Decky displays a fresh code. Pair again.
- Turn off laptop Wi-Fi while holding a key/button. Verify release within approximately three seconds; reconnect and pair using the new code.
- Stop input. Verify port 8765 closes, both virtual devices disappear, and the laptop loses control. Enable and repeat once.
- Reload/uninstall the plugin while paired. Verify the listener closes, input releases, and the next load starts disabled.
- Leave Legion Library and other plugins installed; confirm their normal behavior still works.
- With remote input off, choose **Open Dolphin** inside Decky. Verify the installed system Dolphin opens in Gaming Mode, remains visible/focused, and Steam shows Dolphin as a running app without switching to Desktop Mode.
- Confirm **Dolphin (Decky Remote)** appears once in the current Steam account's non-Steam library. Close Dolphin, open it again through Decky and after a plugin/Steam restart, and verify no duplicate shortcut is added. Remove the shortcut through Steam and confirm the next button press recreates it.
- Enable remote input and use the laptop mouse/keyboard in Dolphin. Check Home, Downloads, mounted storage, Ctrl+L for a path, Ctrl+C/Ctrl+V with a disposable file, and F3 for split view. Verify dialogs are visible and usable, copies have ordinary user ownership, and Dolphin exits normally with Ctrl+Q or Steam's Exit action. These are Dolphin's native operations, outside the plugin's former Home/storage boundary.
- If using multiple Steam accounts, verify each account launches its own Dolphin shortcut. Check other plugins and existing non-Steam apps are unchanged.


If enabling fails, record the exact error from the Decky panel. If connections fail, check LAN client isolation, the displayed IP and port, and the device firewall before changing the plugin. Hardware acceptance is pending until this checklist is performed.
