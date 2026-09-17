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
  assert.deepEqual(listed.tools.map(t => t.name).sort(), ["list_directory","read_file","run_process","write_file"]);
  await client.callTool({ name: "write_file", arguments: { path: "hello.txt", content: "hello" } });
  const read = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
  assert.equal(read.content[0].text, "hello");
  const proc = await client.callTool({ name: "run_process", arguments: { argv: ["node","-e","process.stdout.write('ok')"] } });
  assert.equal(JSON.parse(proc.content[0].text).stdout, "ok");
  const escaped = await client.callTool({ name: "read_file", arguments: { path: "../../etc/passwd" } });
  assert.equal(escaped.isError, true);
  await transport.close();
  await fs.rm(root, { recursive: true, force: true });
});
