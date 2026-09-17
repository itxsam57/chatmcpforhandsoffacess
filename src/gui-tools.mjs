import { z } from "zod";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFile = promisify(execFileCallback);
const json = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const int = (value, name, minimum = 0, maximum = 100000) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}`);
  return String(value);
};
const keyPattern = /^[A-Za-z0-9_+\-]+$/;

export function validateUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed");
  return url.toString();
}

export function desktopCommand(action, input) {
  if (action === "click") return { command: "xdotool", args: [
    "mousemove", "--sync", int(input.x, "coordinate"), int(input.y, "coordinate"),
    "click", int(input.button ?? 1, "button", 1, 5)
  ] };
  if (action === "type") return { command: "xdotool", args: [
    "type", "--delay", int(input.delayMs ?? 10, "delay", 0, 1000), "--", input.text
  ] };
  if (action === "keypress") {
    if (!Array.isArray(input.keys) || !input.keys.length || input.keys.some(key => !keyPattern.test(key))) throw new Error("Invalid key");
    return { command: "xdotool", args: ["key", input.keys.join("+")] };
  }
  if (action === "scroll") {
    const x = int(Math.abs(input.x ?? 0), "scroll", 0, 100);
    const y = int(Math.abs(input.y ?? 0), "scroll", 0, 100);
    const args = [];
    if (input.y < 0) args.push("click", "--repeat", y, "4");
    if (input.y > 0) args.push("click", "--repeat", y, "5");
    if (input.x > 0) args.push("click", "--repeat", x, "7");
    if (input.x < 0) args.push("click", "--repeat", x, "6");
    return { command: "xdotool", args };
  }
  if (action === "focus" || action === "close") {
    const windowId = int(input.windowId, "window", 1, Number.MAX_SAFE_INTEGER);
    return { command: "xdotool", args: action === "focus" ?
      ["windowactivate", "--sync", windowId] : ["windowclose", windowId] };
  }
  throw new Error("Unknown desktop action");
}
export function registerGuiTools(server, options = {}) {
  const display = options.display ?? process.env.HANDSOFF_DISPLAY ?? ":1";
  const run = options.run ?? (async (command, args) => execFile(command, args, {
    env: { ...process.env, DISPLAY: display }, maxBuffer: 2_000_000
  }));
  const act = async (action, input) => {
    const command = desktopCommand(action, input);
    await run(command.command, command.args);
    return json({ ok: true });
  };
  const screenshot = async window => {
    const file = path.join(os.tmpdir(), `hands-off-${randomUUID()}.png`);
    try {
      await run("xfce4-screenshooter", [window ? "-w" : "-f", "-s", file]);
      const data = await fs.readFile(file);
      return { content: [{ type: "image", data: data.toString("base64"), mimeType: "image/png" }] };
    } finally { await fs.rm(file, { force: true }); }
  };

  server.registerTool("desktop_screenshot", {
    description: "Capture the authorized workstation desktop or active window.",
    inputSchema: { activeWindow: z.boolean().default(false) },
    annotations: { readOnlyHint: true }
  }, ({ activeWindow }) => screenshot(activeWindow));

  server.registerTool("desktop_click", {
    description: "Move the pointer and click desktop coordinates.",
    inputSchema: { x: z.number().int().min(0).max(100000), y: z.number().int().min(0).max(100000),
      button: z.number().int().min(1).max(5).default(1) },
    annotations: { destructiveHint: true }
  }, input => act("click", input));

  server.registerTool("desktop_type", {
    description: "Type text into the focused desktop control.",
    inputSchema: { text: z.string().max(100000), delayMs: z.number().int().min(0).max(1000).default(10) },
    annotations: { destructiveHint: true }
  }, input => act("type", input));

  server.registerTool("desktop_keypress", {
    description: "Send a validated key combination to the focused control.",
    inputSchema: { keys: z.array(z.string().regex(keyPattern)).min(1).max(8) },
    annotations: { destructiveHint: true }
  }, input => act("keypress", input));

  server.registerTool("desktop_scroll", {
    description: "Scroll the focused desktop control.",
    inputSchema: { x: z.number().int().min(-100).max(100).default(0),
      y: z.number().int().min(-100).max(100).default(0) },
    annotations: { destructiveHint: true }
  }, input => act("scroll", input));
  server.registerTool("list_windows", {
    description: "List visible desktop windows.",
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async () => {
    let ids = [];
    try {
      const found = await run("xdotool", ["search", "--onlyvisible", "--name", "."]);
      ids = String(found.stdout ?? "").trim().split(/\s+/).filter(Boolean);
    } catch {}
    const windows = [];
    for (const id of ids.slice(0, 200)) {
      try {
        const [name, geometry] = await Promise.all([
          run("xdotool", ["getwindowname", id]),
          run("xdotool", ["getwindowgeometry", "--shell", id])
        ]);
        const values = Object.fromEntries(String(geometry.stdout ?? "").trim().split("\n")
          .map(line => line.split("=", 2)));
        windows.push({ id: Number(id), title: String(name.stdout ?? "").trim(),
          x: Number(values.X), y: Number(values.Y), width: Number(values.WIDTH), height: Number(values.HEIGHT) });
      } catch {}
    }
    return json(windows);
  });

  server.registerTool("focus_window", {
    description: "Activate a visible desktop window.",
    inputSchema: { windowId: z.number().int().positive() },
    annotations: { destructiveHint: true }
  }, input => act("focus", input));

  server.registerTool("close_window", {
    description: "Request a normal close for a visible desktop window.",
    inputSchema: { windowId: z.number().int().positive() },
    annotations: { destructiveHint: true }
  }, input => act("close", input));

  server.registerTool("browser_open", {
    description: "Open an HTTP or HTTPS URL in the workstation browser.",
    inputSchema: { url: z.string().url() },
    annotations: { destructiveHint: true }
  }, async ({ url }) => {
    await run(process.env.HANDSOFF_BROWSER ?? "brave-browser-stable", [validateUrl(url)]);
    return json({ opened: true, url: validateUrl(url) });
  });

  server.registerTool("browser_click", {
    description: "Click browser viewport coordinates.",
    inputSchema: { x: z.number().int().min(0).max(100000), y: z.number().int().min(0).max(100000),
      button: z.number().int().min(1).max(5).default(1) },
    annotations: { destructiveHint: true }
  }, input => act("click", input));

  server.registerTool("browser_type", {
    description: "Type text into the focused browser element.",
    inputSchema: { text: z.string().max(100000), delayMs: z.number().int().min(0).max(1000).default(10) },
    annotations: { destructiveHint: true }
  }, input => act("type", input));
  server.registerTool("browser_keypress", {
    description: "Send a validated key combination to the browser.",
    inputSchema: { keys: z.array(z.string().regex(keyPattern)).min(1).max(8) },
    annotations: { destructiveHint: true }
  }, input => act("keypress", input));

  server.registerTool("browser_scroll", {
    description: "Scroll the browser viewport.",
    inputSchema: { x: z.number().int().min(-100).max(100).default(0),
      y: z.number().int().min(-100).max(100).default(0) },
    annotations: { destructiveHint: true }
  }, input => act("scroll", input));

  server.registerTool("browser_screenshot", {
    description: "Capture the active browser window.",
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, () => screenshot(true));
}
