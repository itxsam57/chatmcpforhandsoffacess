import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import PizZip from "pizzip";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const run = promisify(execFile);
const live = process.env.HANDSOFF_LIVE_TEST === "1" ? test : test.skip;

live("real desktop, browser, and document tools work", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hands-live-"));
  const postscript = "%!PS-Adobe-3.0\n/Times-Roman findfont 24 scalefont setfont\n72 720 moveto\n(PDF works) show\nshowpage\n";
  await fs.writeFile(path.join(root, "sample.ps"), postscript);
  await run("ps2pdf", [path.join(root, "sample.ps"), path.join(root, "sample.pdf")]);

  const zip = new PizZip();
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>");
  zip.file("word/document.xml", "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>DOCX works</w:t></w:r></w:p></w:body></w:document>");
  await fs.writeFile(path.join(root, "sample.docx"), zip.generate({ type: "nodebuffer" }));

  const client = new Client({ name: "live-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/server.mjs"],
    cwd: process.cwd(),
    env: { ...process.env, HANDSOFF_ROOT: root, HANDSOFF_DISPLAY: ":1" }
  });
  await client.connect(transport);
  try {
    const screenshot = await client.callTool({ name: "desktop_screenshot", arguments: {} });
    assert.equal(screenshot.content[0].type, "image");
    assert.equal(Buffer.from(screenshot.content[0].data, "base64").subarray(1, 4).toString(), "PNG");

    const windows = await client.callTool({ name: "list_windows", arguments: {} });
    assert.ok(JSON.parse(windows.content[0].text).length > 0);

    const opened = await client.callTool({ name: "browser_open", arguments: {
      url: "http://127.0.0.1:8080/readyz"
    } });
    assert.equal(JSON.parse(opened.content[0].text).opened, true);
    const browserShot = await client.callTool({ name: "browser_screenshot", arguments: {} });
    assert.equal(browserShot.content[0].type, "image");

    await client.callTool({ name: "excel_write", arguments: {
      path: "live.xlsx", sheet: "Sheet1", range: "A1:B1", values: [["live", 1]]
    } });
    const excel = await client.callTool({ name: "excel_read", arguments: {
      path: "live.xlsx", sheet: "Sheet1", range: "A1:B1"
    } });
    assert.deepEqual(JSON.parse(excel.content[0].text), [["live", 1]]);

    const pdf = await client.callTool({ name: "pdf_read", arguments: { path: "sample.pdf" } });
    assert.match(pdf.content[0].text, /PDF works/);
    const docx = await client.callTool({ name: "docx_read", arguments: { path: "sample.docx" } });
    assert.match(docx.content[0].text, /DOCX works/);
    await client.callTool({ name: "docx_replace", arguments: {
      path: "sample.docx", find: "DOCX works", replacement: "DOCX updated"
    } });
    const updated = await client.callTool({ name: "docx_read", arguments: { path: "sample.docx" } });
    assert.match(updated.content[0].text, /DOCX updated/);
  } finally {
    await transport.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
