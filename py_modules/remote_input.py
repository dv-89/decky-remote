"""Bounded keyboard/mouse events through Linux uinput; no shell commands."""
import os
import struct
import sys

KEYS = {
    "Escape": 1, "Minus": 12, "Equal": 13, "Backspace": 14, "Tab": 15,
    "BracketLeft": 26, "BracketRight": 27, "Enter": 28, "ControlLeft": 29,
    "Semicolon": 39, "Quote": 40, "Backquote": 41, "ShiftLeft": 42,
    "Backslash": 43, "Comma": 51, "Period": 52, "Slash": 53,
    "ShiftRight": 54, "AltLeft": 56, "Space": 57, "CapsLock": 58,
    "NumLock": 69, "ScrollLock": 70, "NumpadEnter": 96,
    "ControlRight": 97, "NumpadDivide": 98, "AltRight": 100,
    "Home": 102, "ArrowUp": 103, "PageUp": 104, "ArrowLeft": 105,
    "ArrowRight": 106, "End": 107, "ArrowDown": 108, "PageDown": 109,
    "Insert": 110, "Delete": 111, "MetaLeft": 125, "MetaRight": 126,
    "ContextMenu": 127, "NumpadMultiply": 55, "NumpadSubtract": 74,
    "NumpadAdd": 78, "NumpadDecimal": 83,
}
for letters, codes in (("QWERTYUIOP", range(16, 26)), ("ASDFGHJKL", range(30, 39)), ("ZXCVBNM", range(44, 51))):
    KEYS.update({"Key" + letter: code for letter, code in zip(letters, codes)})
KEYS.update({"Digit" + digit: code for digit, code in zip("1234567890", range(2, 12))})
KEYS.update({"F" + str(i): 58 + i if i <= 10 else 76 + i for i in range(1, 13)})
KEYS.update({"Numpad" + digit: code for digit, code in zip("7894561230", (71, 72, 73, 75, 76, 77, 79, 80, 81, 82))})
BUTTONS = {"left": 272, "right": 273, "middle": 274}
TEXT_KEYS = {}
for letter in "abcdefghijklmnopqrstuvwxyz":
    TEXT_KEYS[letter] = (KEYS["Key" + letter.upper()], False)
    TEXT_KEYS[letter.upper()] = (KEYS["Key" + letter.upper()], True)
for digit in "0123456789":
    TEXT_KEYS[digit] = (KEYS["Digit" + digit], False)
for plain, shifted, code_name in (
    ("-", "_", "Minus"), ("=", "+", "Equal"), ("[", "{", "BracketLeft"),
    ("]", "}", "BracketRight"), (";", ":", "Semicolon"), ("'", '"', "Quote"),
    ("`", "~", "Backquote"), ("\\", "|", "Backslash"), (",", "<", "Comma"),
    (".", ">", "Period"), ("/", "?", "Slash"),
):
    TEXT_KEYS[plain] = (KEYS[code_name], False)
    TEXT_KEYS[shifted] = (KEYS[code_name], True)
for shifted, digit in zip("!@#$%^&*()", "1234567890"):
    TEXT_KEYS[shifted] = (KEYS["Digit" + digit], True)
TEXT_KEYS.update({" ": (57, False), "\n": (28, False), "\t": (15, False)})


def validate_event(event):
    if not isinstance(event, dict):
        raise ValueError("Each event must be an object")
    kind = event.get("type")
    if kind == "key" and set(event) == {"type", "code", "value"}:
        if isinstance(event["code"], str) and event["code"] in KEYS and type(event["value"]) is int and event["value"] in (0, 1, 2):
            return event
    elif kind == "button" and set(event) == {"type", "button", "value"}:
        if isinstance(event["button"], str) and event["button"] in BUTTONS and type(event["value"]) is int and event["value"] in (0, 1):
            return event
    elif kind == "move" and set(event) == {"type", "dx", "dy"}:
        if all(type(event[key]) is int and -1000 <= event[key] <= 1000 for key in ("dx", "dy")):
            return event
    elif kind == "wheel" and set(event) == {"type", "delta"}:
        if type(event["delta"]) is int and -10 <= event["delta"] <= 10:
            return event
    elif kind == "release" and set(event) == {"type"}:
        return event
    raise ValueError("Unsupported input event")


class UInput:
    def __init__(self):
        if sys.platform != "linux" or struct.calcsize("P") != 8:
            raise OSError("Input control requires 64-bit SteamOS/Linux on the handheld")
        import fcntl
        self.ioctl = fcntl.ioctl
        self.fds = []
        self.held = set()
        try:
            self.keyboard = self._device("Legion Remote Keyboard", sorted(set(KEYS.values())), ())
            self.mouse = self._device("Legion Remote Mouse", BUTTONS.values(), (0, 1, 8))
        except BaseException:
            self.close()
            raise

    def _device(self, name, keys, axes):
        fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK | os.O_CLOEXEC)
        self.fds.append(fd)
        self.ioctl(fd, 0x40045564, 1)  # UI_SET_EVBIT, EV_KEY
        for code in keys:
            self.ioctl(fd, 0x40045565, code)  # UI_SET_KEYBIT
        if axes:
            self.ioctl(fd, 0x40045564, 2)  # EV_REL
            for axis in axes:
                self.ioctl(fd, 0x40045566, axis)  # UI_SET_RELBIT
        setup = struct.pack("=HHHH80sI", 0x03, 0x1209, 0x0001, 1, name.encode(), 0)
        self.ioctl(fd, 0x405C5503, setup)  # UI_DEV_SETUP, 92 bytes
        self.ioctl(fd, 0x5501)  # UI_DEV_CREATE
        return fd

    def _emit(self, fd, kind, code, value):
        # input_event layout for 64-bit Linux, independent of the Windows test host.
        data = struct.pack("=qqHHi", 0, 0, kind, code, value)
        if os.write(fd, data) != len(data):
            raise OSError("Incomplete input write")

    def _sync(self, fd):
        self._emit(fd, 0, 0, 0)

    def _key(self, fd, code, value):
        key = (fd, code)
        if value == 0 and key not in self.held:
            return
        if value == 2 and key not in self.held:
            return
        if value == 1 and key in self.held:
            value = 2
        if value:
            self.held.add(key)
        else:
            self.held.discard(key)
        self._emit(fd, 1, code, value)
        self._sync(fd)

    def apply(self, event):
        validate_event(event)
        kind = event["type"]
        if kind == "key":
            self._key(self.keyboard, KEYS[event["code"]], event["value"])
        elif kind == "button":
            self._key(self.mouse, BUTTONS[event["button"]], event["value"])
        elif kind == "move":
            self._emit(self.mouse, 2, 0, event["dx"])
            self._emit(self.mouse, 2, 1, event["dy"])
            self._sync(self.mouse)
        elif kind == "wheel":
            self._emit(self.mouse, 2, 8, event["delta"])
            self._sync(self.mouse)
        else:
            self.release()

    def text(self, value):
        if not isinstance(value, str) or not 1 <= len(value) <= 128 or any(char not in TEXT_KEYS for char in value):
            raise ValueError("Use 1–128 US-layout letters, numbers, punctuation, tabs or newlines")
        self.release()
        for char in value:
            code, shifted = TEXT_KEYS[char]
            if shifted:
                self._key(self.keyboard, 42, 1)
            self._key(self.keyboard, code, 1)
            self._key(self.keyboard, code, 0)
            if shifted:
                self._key(self.keyboard, 42, 0)

    def release(self):
        for fd, code in list(self.held):
            self._key(fd, code, 0)

    def close(self):
        try:
            self.release()
        finally:
            for fd in self.fds:
                try:
                    self.ioctl(fd, 0x5502)  # UI_DEV_DESTROY
                except OSError:
                    pass
                finally:
                    os.close(fd)
            self.fds.clear()
            self.held.clear()
