import test from "node:test";
import assert from "node:assert/strict";
import { validateUrl, desktopCommand } from "../src/gui-tools.mjs";

test("validateUrl accepts only HTTP and HTTPS", () => {
  assert.equal(validateUrl("https://example.com/"), "https://example.com/");
  assert.equal(validateUrl("http://127.0.0.1:3000/test"), "http://127.0.0.1:3000/test");
  assert.throws(() => validateUrl("file:///etc/passwd"), /HTTP/);
  assert.throws(() => validateUrl("javascript:alert(1)"), /HTTP/);
});

test("desktopCommand validates input and builds argv", () => {
  assert.deepEqual(desktopCommand("click", { x: 10, y: 20, button: 1 }), {
    command: "xdotool", args: ["mousemove", "--sync", "10", "20", "click", "1"]
  });
  assert.deepEqual(desktopCommand("scroll", { x: 5, y: -2 }), {
    command: "xdotool", args: ["click", "--repeat", "2", "4", "click", "--repeat", "5", "7"]
  });
  assert.throws(() => desktopCommand("click", { x: -1, y: 2, button: 1 }), /coordinate/);
  assert.throws(() => desktopCommand("keypress", { keys: ["Return", "bad key"] }), /key/);
});

test("desktopCommand builds window actions", () => {
  assert.deepEqual(desktopCommand("focus", { windowId: 42 }), {
    command: "xdotool", args: ["windowactivate", "--sync", "42"]
  });
  assert.deepEqual(desktopCommand("close", { windowId: 42 }), {
    command: "xdotool", args: ["windowclose", "42"]
  });
  assert.throws(() => desktopCommand("focus", { windowId: 0 }), /window/);
});
