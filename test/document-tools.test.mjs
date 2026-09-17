import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import PizZip from "pizzip";
import { createDocumentService } from "../src/document-tools.mjs";

test("Excel range write and read round-trips inside root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hands-docs-"));
  const service = createDocumentService(root);
  await service.excelWrite("book.xlsx", "Sheet1", "A1:B2", [["Name","Age"],["Sam",21]]);
  assert.deepEqual(await service.excelRead("book.xlsx", "Sheet1", "A1:B2"),
    [["Name","Age"],["Sam",21]]);
  await assert.rejects(() => service.excelRead("../../escape.xlsx", "Sheet1", "A1"), /outside/);
  await fs.rm(root, { recursive: true, force: true });
});

test("DOCX read and exact replacement round-trip", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hands-docx-"));
  const zip = new PizZip();
  zip.file("[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"></Types>");
  zip.file("word/document.xml", "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>");
  await fs.writeFile(path.join(root, "sample.docx"), zip.generate({ type: "nodebuffer" }));
  const service = createDocumentService(root);
  assert.match(await service.docxRead("sample.docx"), /Hello world/);
  assert.equal(await service.docxReplace("sample.docx", "Hello world", "Plugin works"), 1);
  assert.match(await service.docxRead("sample.docx"), /Plugin works/);
  await fs.rm(root, { recursive: true, force: true });
});
