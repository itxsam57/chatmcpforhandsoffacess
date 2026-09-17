import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("tools work and root escape is rejected", async () => {
  const root = await fs.mkdtemp("/tmp/hands-off-test-");
  const client = new Client({ name: "test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: process.cwd(),
    env: { ...process.env, HANDSOFF_ROOT: root }
  });
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map(t => t.name).sort(), [
    "browser_click","browser_keypress","browser_open","browser_screenshot","browser_scroll","browser_type",
    "close_window","desktop_click","desktop_keypress","desktop_screenshot","desktop_scroll","desktop_type",
    "docx_read","docx_replace","excel_read","excel_write","focus_window","get_file_info","kill_process",
    "list_directory","list_processes","list_windows","move_file","pdf_read","read_file",
    "read_process_output","run_process","search_files","start_process","write_file","write_process_input"
  ]);
  await client.callTool({ name: "write_file", arguments: { path: "hello.txt", content: "hello" } });
  const read = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
  assert.equal(read.content[0].text, "hello");
  const proc = await client.callTool({ name: "run_process", arguments: { argv: ["node","-e","process.stdout.write('ok')"] } });
  assert.equal(JSON.parse(proc.content[0].text).stdout, "ok");
  await client.callTool({ name: "write_file", arguments: { path: "nested/find-me.txt", content: "needle" } });
  const search = await client.callTool({ name: "search_files", arguments: { path: ".", query: "needle" } });
  assert.deepEqual(JSON.parse(search.content[0].text), ["nested/find-me.txt"]);
  const info = await client.callTool({ name: "get_file_info", arguments: { path: "nested/find-me.txt" } });
  assert.equal(JSON.parse(info.content[0].text).size, 6);
  await client.callTool({ name: "move_file", arguments: { source: "nested/find-me.txt", destination: "moved.txt" } });
  assert.equal(await fs.readFile(root + "/moved.txt", "utf8"), "needle");
  const started = await client.callTool({ name: "start_process", arguments: {
    argv: ["node","-e","process.stdin.on('data',d=>{console.log(d.toString().trim());setTimeout(()=>process.exit(0),30)})"]
  } });
  const sessionId = JSON.parse(started.content[0].text).sessionId;
  await client.callTool({ name: "write_process_input", arguments: { sessionId, data: "ping\\n" } });
  await new Promise(resolve => setTimeout(resolve, 80));
  const output = await client.callTool({ name: "read_process_output", arguments: { sessionId } });
  assert.match(JSON.parse(output.content[0].text).stdout, /ping/);
  const processes = await client.callTool({ name: "list_processes", arguments: {} });
  assert.ok(Array.isArray(JSON.parse(processes.content[0].text)));
  const longRunning = await client.callTool({ name: "start_process", arguments: {
    argv: ["node","-e","setInterval(()=>{},1000)"]
  } });
  const killSessionId = JSON.parse(longRunning.content[0].text).sessionId;
  const killed = await client.callTool({ name: "kill_process", arguments: { sessionId: killSessionId } });
  assert.equal(JSON.parse(killed.content[0].text).killed, true);
  await new Promise(resolve => setTimeout(resolve, 50));
  const killedOutput = await client.callTool({ name: "read_process_output", arguments: { sessionId: killSessionId } });
  assert.equal(JSON.parse(killedOutput.content[0].text).status, "finished");
  const escaped = await client.callTool({ name: "read_file", arguments: { path: "../../etc/passwd" } });
  assert.equal(escaped.isError, true);
  await transport.close();
  await fs.rm(root, { recursive: true, force: true });
});
