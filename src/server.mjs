import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(process.env.HANDSOFF_ROOT || "/home/ubuntu/work");
const BLOCKED = new Set(["sudo","su","passwd","mkfs","mount","umount","fdisk","dd","shutdown","reboot","poweroff"]);
const inside = (input = ".") => {
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) throw new Error("Path outside HANDSOFF_ROOT");
  return resolved;
};
const existing = async input => inside(await fs.realpath(inside(input)));
const writeTarget = async input => {
  const target = inside(input);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target));
  inside(parent);
  return path.join(parent, path.basename(target));
};
const server = new McpServer(
  { name: "hands-off-access", version: "0.1.0" },
  { instructions: "Operate only inside HANDSOFF_ROOT. Inspect before writes. Never expose secrets." }
);

server.registerTool("list_directory", {
  description: "List files and folders under the authorized root.",
  inputSchema: { path: z.string().default(".") },
  annotations: { readOnlyHint: true }
}, async ({ path: requested }) => {
  const entries = await fs.readdir(await existing(requested), { withFileTypes: true });
  return { content: [{ type: "text", text: JSON.stringify(entries.map(e => ({ name: e.name, type: e.isDirectory() ? "directory" : "file" }))) }] };
});

server.registerTool("read_file", {
  description: "Read a UTF-8 text file under the authorized root.",
  inputSchema: { path: z.string(), maxBytes: z.number().int().min(1).max(1048576).default(200000) },
  annotations: { readOnlyHint: true }
}, async ({ path: requested, maxBytes }) => {
  const handle = await fs.open(await existing(requested), "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return { content: [{ type: "text", text: buffer.subarray(0, bytesRead).toString("utf8") }] };
  } finally { await handle.close(); }
});

server.registerTool("write_file", {
  description: "Create or replace a UTF-8 text file under the authorized root.",
  inputSchema: { path: z.string(), content: z.string().max(1000000) },
  annotations: { destructiveHint: true }
}, async ({ path: requested, content }) => {
  const target = await writeTarget(requested);
  await fs.writeFile(target, content, { encoding: "utf8", flag: "w" });
  return { content: [{ type: "text", text: `Wrote ${Buffer.byteLength(content)} bytes` }] };
});

server.registerTool("run_process", {
  description: "Run one argv-based process inside the authorized root. Shell parsing is disabled.",
  inputSchema: {
    argv: z.array(z.string()).min(1).max(64),
    cwd: z.string().default("."),
    timeoutMs: z.number().int().min(100).max(300000).default(30000)
  },
  annotations: { destructiveHint: true }
}, async ({ argv, cwd, timeoutMs }) => {
  if (BLOCKED.has(path.basename(argv[0]))) throw new Error("Command blocked");
  const result = await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: inside(cwd), env: { ...process.env, HOME: process.env.HOME }, shell: false
    });
    let stdout = "", stderr = "";
    const cap = (old, chunk) => (old + chunk.toString("utf8")).slice(-500000);
    child.stdout.on("data", chunk => { stdout = cap(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = cap(stderr, chunk); });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    setTimeout(() => { child.kill("SIGTERM"); }, timeoutMs).unref();
  });
  return { content: [{ type: "text", text: JSON.stringify(result) }], isError: result.code !== 0 };
});

await server.connect(new StdioServerTransport());
