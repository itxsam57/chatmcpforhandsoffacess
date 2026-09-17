import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(process.env.HANDSOFF_ROOT || "/home/ubuntu/work");
const BLOCKED = new Set(["sudo","su","passwd","mkfs","mount","umount","fdisk","dd","shutdown","reboot","poweroff"]);
const sessions = new Map();
const lexical = (input = ".") => {
  const resolved = path.resolve(ROOT, input);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) throw new Error("Path outside HANDSOFF_ROOT");
  return resolved;
};
const existing = async input => lexical(await fs.realpath(lexical(input)));
const destination = async input => {
  const target = lexical(input);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target));
  lexical(parent);
  return path.join(parent, path.basename(target));
};
const trim = value => value.slice(-500000);
const json = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

export function registerExtendedTools(server) {
  server.registerTool("get_file_info", {
    description: "Get safe metadata for a file or directory.",
    inputSchema: { path: z.string() },
    annotations: { readOnlyHint: true }
  }, async ({ path: requested }) => {
    const target = await existing(requested);
    const stat = await fs.stat(target);
    return json({ size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory(),
      modifiedAt: stat.mtime.toISOString(), mode: stat.mode & 0o777 });
  });

  server.registerTool("move_file", {
    description: "Move or rename a file inside the authorized root.",
    inputSchema: { source: z.string(), destination: z.string() },
    annotations: { destructiveHint: true }
  }, async ({ source, destination: requestedDestination }) => {
    const sourcePath = await existing(source);
    const destinationPath = await destination(requestedDestination);
    await fs.rename(sourcePath, destinationPath);
    return json({ moved: true });
  });

  server.registerTool("search_files", {
    description: "Recursively search file names or UTF-8 file contents.",
    inputSchema: {
      path: z.string().default("."),
      query: z.string().min(1),
      mode: z.enum(["name","content"]).default("content"),
      maxResults: z.number().int().min(1).max(500).default(100)
    },
    annotations: { readOnlyHint: true }
  }, async ({ path: requested, query, mode, maxResults }) => {
    const base = await existing(requested);
    const matches = [];
    const visit = async current => {
      if (matches.length >= maxResults) return;
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        if (matches.length >= maxResults) break;
        if (entry.isSymbolicLink()) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await visit(full);
        else if (entry.isFile()) {
          let matched = entry.name.includes(query);
          if (mode === "content") {
            const stat = await fs.stat(full);
            matched = stat.size <= 1048576 && (await fs.readFile(full, "utf8")).includes(query);
          }
          if (matched) matches.push(path.relative(ROOT, full));
        }
      }
    };
    await visit(base);
    return json(matches);
  });

  server.registerTool("start_process", {
    description: "Start a long-running argv-based process and return a session ID.",
    inputSchema: { argv: z.array(z.string()).min(1).max(64), cwd: z.string().default(".") },
    annotations: { destructiveHint: true }
  }, async ({ argv, cwd }) => {
    if (BLOCKED.has(path.basename(argv[0]))) throw new Error("Command blocked");
    const child = spawn(argv[0], argv.slice(1), {
      cwd: lexical(cwd), env: { ...process.env, HOME: process.env.HOME }, shell: false
    });
    const sessionId = randomUUID();
    const state = { sessionId, child, pid: child.pid, stdout: "", stderr: "",
      status: "running", exitCode: null, startedAt: new Date().toISOString() };
    sessions.set(sessionId, state);
    child.stdout.on("data", chunk => { state.stdout = trim(state.stdout + chunk.toString("utf8")); });
    child.stderr.on("data", chunk => { state.stderr = trim(state.stderr + chunk.toString("utf8")); });
    child.on("error", error => { state.status = "error"; state.stderr = trim(state.stderr + error.message); });
    child.on("close", code => { state.status = "finished"; state.exitCode = code; });
    return json({ sessionId, pid: child.pid, status: state.status });
  });

  server.registerTool("read_process_output", {
    description: "Read captured output and status from a process session.",
    inputSchema: {
      sessionId: z.string(),
      stdoutOffset: z.number().int().min(0).default(0),
      stderrOffset: z.number().int().min(0).default(0)
    },
    annotations: { readOnlyHint: true }
  }, async ({ sessionId, stdoutOffset, stderrOffset }) => {
    const state = sessions.get(sessionId);
    if (!state) throw new Error("Unknown process session");
    return json({ sessionId, pid: state.pid, status: state.status, exitCode: state.exitCode,
      stdout: state.stdout.slice(stdoutOffset), stderr: state.stderr.slice(stderrOffset),
      stdoutLength: state.stdout.length, stderrLength: state.stderr.length });
  });

  server.registerTool("write_process_input", {
    description: "Write text to a running process session.",
    inputSchema: { sessionId: z.string(), data: z.string().max(100000) },
    annotations: { destructiveHint: true }
  }, async ({ sessionId, data }) => {
    const state = sessions.get(sessionId);
    if (!state || state.status !== "running") throw new Error("Process is not running");
    state.child.stdin.write(data);
    return json({ written: Buffer.byteLength(data) });
  });

  server.registerTool("kill_process", {
    description: "Terminate a running process session.",
    inputSchema: { sessionId: z.string(), signal: z.enum(["SIGTERM","SIGKILL","SIGINT"]).default("SIGTERM") },
    annotations: { destructiveHint: true }
  }, async ({ sessionId, signal }) => {
    const state = sessions.get(sessionId);
    if (!state) throw new Error("Unknown process session");
    const killed = state.status === "running" ? state.child.kill(signal) : false;
    return json({ killed, status: state.status });
  });

  server.registerTool("list_processes", {
    description: "List MCP-managed process sessions.",
    inputSchema: {},
    annotations: { readOnlyHint: true }
  }, async () => json([...sessions.values()].map(state => ({
    sessionId: state.sessionId, pid: state.pid, status: state.status,
    exitCode: state.exitCode, startedAt: state.startedAt
  }))));
}
