# Validation and device acceptance

Local automated checks cover event schemas and limits, LAN address boundaries, single-use pairing and rate limits, session tokens and source IP binding, text validation, release on disconnect/timeout, session expiration, uinput event/structure packing, separate keyboard/mouse capabilities, HTTP asset delivery, unauthorized requests, cross-origin and DNS rebinding protection, duplicate headers, path allowlists, service shutdown with idle connections, occupied ports, input device failures, browser key/mouse/text behavior and the built Decky entry point.

Windows tests mock uinput and check its emitted binary ABI. They do not demonstrate that Linux accepts the devices or that Steam/Game Mode reacts to them. The tests never inject input into the laptop's operating system.

Version 0.1.0 was verified locally on October 11, 2026: TypeScript typecheck and Rollup build passed; 14 Python backend/protocol/HTTP checks, 5 browser-client checks and 1 compiled-plugin check passed. The user subsequently reported working handheld input from the installed build. This does not establish full acceptance for the new 0.1.1 capture behavior.

The 0.1.1 client checks additionally exercise one-click capture, free mouse movement, physical clicks and simultaneous button holds, duplicate pointer/mouse event handling, unlock/focus/session release, legacy browser events, capture denial, touchpad fallback and cancellation with late browser responses. [Controller screenshot](laptop-controller.png) shows the current demo interface. The installable archive's file allowlist and SHA-256 are checked separately during packaging.

For 0.1.1, TypeScript typecheck, Rollup build, all 8 browser-client checks and the compiled-plugin check passed. In the in-app browser, pairing and the touchpad fallback were verified with simulated input. This browser denied pointer lock, so real mouse capture still needs validation in the user's desktop browser using the checklist below. The Linux backend is unchanged from the version with 14 passing backend checks.

For 0.1.2, TypeScript typecheck, Rollup build and the compiled-plugin check passed. All 16 Python backend/protocol/HTTP checks and 10 browser-client checks passed, including horizontal/diagonal scrolling, pixel/line/page units, fractional deltas, axis limits, pause resets, HTTP delivery and packed Linux horizontal-wheel events. Real horizontal scrolling on the handheld remains pending device validation.

## Version 0.1.11

Bidirectional transfers use a dedicated `Downloads/Decky Remote` folder. Linux filesystem tests cover byte-for-byte chunked uploads/downloads, SHA-256, zero-byte and Unicode files, duplicate-name preservation, owner permissions, path/hidden/control/invalid-Unicode rejection, symlinks, FIFOs, replaced temporary files, wrong offsets, incomplete uploads, idle/cancel/reset cleanup, download ticket limits/expiry/IP/token/reuse/replacement, bounded listings, low disk space and short writes. Real HTTP tests cover streamed downloads and their headers, authorization before body reads and folder access, cross-origin/cross-site rejection, chunk limits, disconnect cleanup and disk errors leaving input usable.

Eight browser Files tests cover multi-file uploads, safe filename rendering, download links, oversize/folder rejection, lost begin responses, partial failures, cancellation and stale-session replies. The existing client tests also verify that switching to Files pauses control and discards queued presses. The WSL preview successfully uploaded and downloaded the public LICENSE file through the real browser; the downloaded bytes matched the source. Files fits at 320 and 390 px without horizontal page overflow. [Mobile Files preview](file-sharing.png) uses a disposable preview folder, not the Legion's actual home.

All 38 Linux Python tests and 53 Node tests (16 client, 8 Files, 28 Dolphin, 1 bundle) pass, alongside TypeScript, Rollup and archive verification. Transfers on the Legion remain pending hardware confirmation:

- Install over the old version, reload the browser and pair. Open Files and confirm the displayed path is inside your Steam user's home.
- Upload a small disposable file, a multi-chunk file, an empty file and a filename with Unicode. Open Dolphin in Gaming Mode and check their contents and ordinary user ownership.
- Upload a repeated name and confirm both files remain. Cancel a transfer, disconnect during one, and stop/reload the plugin during one; unfinished files should not appear in the download list.
- Copy a file into the folder with Dolphin, refresh and download it; compare bytes or SHA-256 on both devices. Check browser save prompts on desktop and mobile. Download progress belongs to the browser.
- Try capture again after file transfers. Backspace, Escape, scrolling, Send text and Dolphin launch should retain their previous behavior.

## Version 0.1.10

Physical Backspace sends one Escape down/up pulse per press while remote control stays active. Holding it does not repeat Steam Back. Shift + Backspace forwards the Backspace key and its repeat events. Each physical press retains its chosen mapping until keyup; pause, focus loss, hiding or a tool change clears that mapping and releases held input. Physical Escape still pauses immediately, and Send text editing stays local.

All 16 client checks pass, including three new regression checks for both capture modes, repeated Backspace, manual Delete, Shift changes during a held key, inactive text editing and mapping cleanup/restart. Hardware confirmation is still needed for Steam Back and deletion in the selected handheld app.

## Version 0.1.9

Direct browser control is restored. Start control requests pointer lock only, without Keyboard Lock, fullscreen or a laptop helper. A single physical Escape pauses immediately, discards queued input and sends release; the on-screen Back button still sends Escape to Steam. Unlimited capture remains the laptop default and Touchpad remains the mobile default. Pad control stays removed.

The 13 client checks cover physical Escape versus the Back button, pointer unlock, focus/session loss, horizontal scrolling, physical mouse button chords, unsupported/legacy capture, and cancellation, hiding or timeout followed by late capture completion. The harness deliberately provides no Keyboard Lock or fullscreen APIs. TypeScript typecheck, Rollup, all 23 Python checks and 42 Node checks (13 client, 28 Dolphin, 1 bundle) pass. The installable ZIP is checked for matching source, version, CRC and SHA-256. Actual mouse capture on the Legion still needs the hardware checklist below.

## Version 0.1.8

The user requested Unlimited capture with short Escape presses forwarded and a long press releasing control, and removal of Pad control. The browser now requests Escape Keyboard Lock, pointer lock and script-initiated fullscreen from Start control. Input stays inactive until all three are ready. Short/repeated taps remain captured; a two-second hold pauses, while Escape auto-repeat sends no extra Back presses. Losing fullscreen, pointer lock, focus or pairing releases input and cancels pending capture.

The localhost helper serves the current controller and relays only its input API to a fixed private IPv4 target. Nine integration checks exercise real HTTP pairing, input, text and disconnect through the helper, backend validation, asset delivery, unreachable devices and rejection of foreign Host/Origin, cross-site requests, duplicate headers, oversized bodies and arbitrary paths/targets. These pass on Windows and Linux. A portable Windows executable builds with PyInstaller and passes its startup check, serves the exact bundled client, and relays the simulated handheld's PIN validation; its archive includes bundled runtime licenses.

The 17 browser-client checks cover capture ordering, Escape tap/hold behavior, mobile selection, release paths, insecure/unsupported contexts, partial failures, cancellation and late keyboard/fullscreen/pointer completions. The in-app browser verified pairing, the two remaining mode choices and clean capture denial with simulated input; [controller preview](keyboard-capture.png) shows the updated mode. A native Chrome check could not run because computer-use app approval timed out; fullscreen Keyboard Lock with physical keys still needs on-device/browser confirmation. No real OS input was injected during local verification.

TypeScript typecheck, Rollup, all 32 Python checks and 46 Node checks (17 client, 28 Dolphin, 1 bundle) pass. The installable plugin and helper ZIPs are validated by CRC and SHA-256; the Windows build checks that its embedded HTML, JavaScript and CSS exactly match the source before publishing. The updated release workflow passes actionlint.

## Version 0.1.7

The user reported **.for is not iterable** from 0.1.6 and supplied a Steam shortcut photo showing the generated name `dolphin"`, a double-quoted target, an incomplete start directory and blank launch options. Version 0.1.6 mistakenly modeled the shortcut collection as iterable ID/overview pairs. The current [MoonDeck interface](https://github.com/FrogTheFrog/moondeck/blob/main/src/steam-utils/getCollectionStore.ts) exposes `apps.keys()` for IDs and `allApps` for overviews; it does not require pair iteration.

Version 0.1.7 reads IDs via `keys()` and resolves overviews through Steam's app store. It recognizes the photographed legacy name, repairs its fields, and avoids new additions if existing overviews cannot yet be loaded. Eight added regression checks exercise ID Sets, keys-only collections without a direct iterator, creation/reload reuse, unsupported collection formats, missing overviews and the photographed shortcut with both reported and omitted target metadata, including a foreign-target rejection.

TypeScript typecheck, Rollup, 23 Python checks and 42 Node checks (13 client, 28 Dolphin, 1 bundle) pass locally. The updated Decky button still needs confirmation on the handheld. Verify that it renames/repairs the photographed entry, opens Dolphin, and keeps the shortcut count unchanged after repeated presses and a plugin reload.

## Version 0.1.6

The user confirmed that **Dolphin (Decky Remote)** appears in Steam's non-Steam library and that Steam's Play button opens the file manager. The plugin still reported a missing shortcut and appeared to add duplicates on repeated installs/opens. This narrows the failure to the plugin's shortcut discovery and metadata read-back; it does not establish acceptance of the updated Decky button.

Version 0.1.6 uses collection map IDs, remembers the managed ID per Steam account before configuring it, and accepts known plugin entries when Steam omits executable metadata or sends no details callback. An explicitly reported foreign executable is left unchanged. Raw paths let Steam handle quoting, and the executable setter repairs legacy double-quoted targets before launch. Old duplicate entries are retained; reuse prevents another addition.

The 20 Dolphin regression checks cover Steam's internal quoting, legacy targets, missing/delayed metadata, incomplete overviews, existing duplicates, reinstall/retry reuse, account changes, deletion/recreation, foreign shortcuts, overlapping presses, unavailable storage and older API fallback. TypeScript typecheck, Rollup, 23 Python checks and 34 Node checks (13 client, 20 Dolphin, 1 bundle) pass locally. Confirm the updated Decky button on the Legion, then repeat after reopening/reinstalling and verify the shortcut count stays unchanged.

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
- Open the handheld address directly in the laptop browser and pair. Confirm the page has Unlimited capture and Touchpad choices, with no Pad control option or helper download. Start control must hide the laptop cursor without entering fullscreen. Physical mouse movement, clicks, drags, scrolling and typing must reach the handheld.
- While captured, press Backspace: Steam receives Back and capture remains active. Hold it: only one Back is sent. In a text field, use Shift + Backspace and the on-screen Delete button to delete; held Shift + Backspace should repeat deletion. In Send text, Backspace should edit the local field normally.
- Press physical Escape once: control pauses immediately and the laptop cursor returns without sending Back to Steam. Press the on-screen Back button: Steam receives Escape. Start control must work again after releasing Escape and clicking the button. Repeat in Touchpad mode.
- In Desktop Mode, open a page or application with a horizontal scrollbar. In Full control, swipe two fingers left and right on the laptop trackpad and confirm horizontal scrolling reaches the handheld. Test vertical and diagonal scrolling, then repeat over the pad in Touchpad mode. Pause and resume between partial gestures to confirm there is no leftover scrolling. Steam Gaming Mode views may not respond to horizontal wheel input.
- Hold a key/button and pause or switch windows. Verify pointer lock ends if used, the laptop cursor returns, and held inputs release immediately or within the three-second watchdog limit. Start control again and verify capture resumes.
- Select **Touchpad — drag to move** after pausing. Verify dragging the pad, grouped manual buttons, scrolling and focused typing still work. On a phone, verify Touchpad is selected automatically and the Control / Send text tabs fit without sideways page scrolling. Switching to Send text must pause remote input; text must stay local until sent.
- If pointer capture is denied or unavailable, verify the page stays paused and offers Touchpad mode. Cancel a pending capture request, hide the page or wait for its timeout, then verify a late pointer-lock response never activates control without a new Start control action.
- Disconnect the laptop through Decky. Verify the old browser can no longer send input and Decky displays a fresh code. Pair again.
- Turn off laptop Wi-Fi while holding a key/button. Verify release within approximately three seconds; reconnect and pair using the new code.
- Stop input. Verify port 8765 closes, both virtual devices disappear, and the laptop loses control. Enable and repeat once.
- Reload/uninstall the plugin while paired. Verify the listener closes, input releases, and the next load starts disabled.
- Leave Legion Library and other plugins installed; confirm their normal behavior still works.
- With remote input off, choose **Open Dolphin** inside Decky. Verify the installed system Dolphin opens in Gaming Mode, remains visible/focused, and Steam shows Dolphin as a running app without switching to Desktop Mode.
- Confirm **Dolphin (Decky Remote)** appears in the current Steam account's non-Steam library. Close Dolphin, open it again through Decky and after a plugin/Steam restart and reinstall, and verify no additional shortcut is added. Existing duplicates from older builds should remain unchanged until removed manually through Steam. Remove the managed shortcut through Steam and confirm the next button press recreates it once. Rename the managed entry and confirm reuse with the saved account binding.
- Enable remote input and use the laptop mouse/keyboard in Dolphin. Check Home, Downloads, mounted storage, Ctrl+L for a path, Ctrl+C/Ctrl+V with a disposable file, and F3 for split view. Verify dialogs are visible and usable, copies have ordinary user ownership, and Dolphin exits normally with Ctrl+Q or Steam's Exit action. These are Dolphin's native operations, outside the plugin's former Home/storage boundary.
- If using multiple Steam accounts, verify each account launches its own Dolphin shortcut. Check other plugins and existing non-Steam apps are unchanged.


If enabling fails, record the exact error from the Decky panel. If connections fail, check LAN client isolation, the displayed IP and port, and the device firewall before changing the plugin. Hardware acceptance is pending until this checklist is performed.
