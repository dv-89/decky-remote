# Decky Remote laptop helper

The helper lets the controller run at a localhost address, where Chrome/Edge can use Keyboard Lock. It relays input to your handheld; it does not capture input outside the browser or show the handheld's screen.

## Windows

1. Install Decky Remote 0.1.8 or later on the handheld and enable remote input.
2. Download and extract `decky-remote-laptop-0.1.8-windows.zip` on your laptop.
3. Run `DeckyRemoteHelper.exe`. Enter the address shown in Decky, for example `http://192.168.1.42:8765`.
4. Keep the helper window open. It opens the controller in your default browser; if that is not Chrome or Edge, copy its localhost address into Chrome/Edge.
5. Enter the pairing code shown in Decky and press **Start control**. The page enters fullscreen and captures the mouse and Escape key.
6. **Tap Esc** to send Escape to the handheld and keep controlling. **Hold Esc for about two seconds** to release control and return your laptop cursor. A long press also sends one Escape to the handheld at its start. Holding Esc does not send repeated Back presses.
7. Press Start control again to resume. Switching windows, leaving fullscreen or disconnecting also releases input.

Close the helper window or press Ctrl+C to stop it. The helper does not install a service or start with Windows. It binds only to `127.0.0.1`, normally port 8767; if that port is occupied it chooses another available port. It stores no input, pairing code, token or handheld address on disk. The Wi-Fi connection to the handheld remains ordinary unencrypted HTTP; use your trusted private LAN.

## Run from source on Windows, Linux or macOS

With Python 3.11+ installed, run from the repository root:

```text
python laptop/remote_helper.py --url http://192.168.1.42:8765
```

Omit `--url` to enter the address interactively. Use `--no-browser` to print the localhost address without opening it. Use `--port 0` to choose any available local port. Keyboard Lock must be supported by your desktop browser.

The helper accepts only numeric private IPv4 addresses and fixed Decky Remote input API paths. The handheld still validates pairing and all input. No HTTPS certificates or browser security flags are needed. The portable Windows build includes Python; it does not require a separate Python installation.
