import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import PizZip from "pizzip";

const execFile = promisify(execFileCallback);
const json = value => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const xmlEscape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const xmlDecode = value => String(value).replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");

function rangeBounds(value) {
  const match = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/.exec(value.toUpperCase());
  if (!match) throw new Error("Invalid cell range");
  const column = letters => [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
  return { startColumn: column(match[1]), startRow: Number(match[2]),
    endColumn: column(match[3] ?? match[1]), endRow: Number(match[4] ?? match[2]) };
}

function pathSafety(root) {
  const base = path.resolve(root);
  const lexical = input => {
    const resolved = path.resolve(base, input);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error("Path outside HANDSOFF_ROOT");
    return resolved;
  };
  const existing = async input => lexical(await fs.realpath(lexical(input)));
  const writable = async input => {
    const target = lexical(input);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const parent = lexical(await fs.realpath(path.dirname(target)));
    return path.join(parent, path.basename(target));
  };
  return { existing, writable };
}
export function createDocumentService(root = process.env.HANDSOFF_ROOT ?? "/home/ubuntu/work") {
  const paths = pathSafety(root);
  return {
    async excelRead(file, sheetName, range) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(await paths.existing(file));
      if (!sheetName) return workbook.worksheets.map(sheet => sheet.name);
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) throw new Error("Unknown worksheet");
      const bounds = rangeBounds(range);
      const values = [];
      for (let row = bounds.startRow; row <= bounds.endRow; row++) {
        const line = [];
        for (let column = bounds.startColumn; column <= bounds.endColumn; column++) {
          const value = sheet.getCell(row, column).value;
          line.push(value && typeof value === "object" && "result" in value ? value.result : value ?? null);
        }
        values.push(line);
      }
      return values;
    },

    async excelWrite(file, sheetName, range, values) {
      const target = await paths.writable(file);
      const workbook = new ExcelJS.Workbook();
      try { await workbook.xlsx.readFile(await paths.existing(file)); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const sheet = workbook.getWorksheet(sheetName) ?? workbook.addWorksheet(sheetName);
      const bounds = rangeBounds(range);
      const rows = bounds.endRow - bounds.startRow + 1;
      const columns = bounds.endColumn - bounds.startColumn + 1;
      if (values.length !== rows || values.some(row => !Array.isArray(row) || row.length !== columns)) {
        throw new Error("Values do not match range dimensions");
      }
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        sheet.getCell(bounds.startRow + row, bounds.startColumn + column).value = values[row][column];
      }
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await workbook.xlsx.writeFile(temporary); await fs.rename(temporary, target); }
      finally { await fs.rm(temporary, { force: true }); }
      return { written: true, rows, columns };
    },
    async pdfRead(file, firstPage = 1, lastPage = 100) {
      const target = await paths.existing(file);
      const result = await execFile("pdftotext", ["-f", String(firstPage), "-l", String(lastPage), target, "-"],
        { maxBuffer: 5_000_000 });
      return result.stdout;
    },

    async docxRead(file) {
      const zip = new PizZip(await fs.readFile(await paths.existing(file)));
      const xml = zip.file("word/document.xml")?.asText();
      if (!xml) throw new Error("Invalid DOCX document");
      return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map(match => xmlDecode(match[1])).join("\n");
    },

    async docxReplace(file, find, replacement) {
      if (!find) throw new Error("Find text is required");
      const target = await paths.existing(file);
      const zip = new PizZip(await fs.readFile(target));
      const document = zip.file("word/document.xml");
      if (!document) throw new Error("Invalid DOCX document");
      let xml = document.asText();
      const needle = xmlEscape(find);
      const escapedReplacement = xmlEscape(replacement);
      const count = xml.split(needle).length - 1;
      if (!count) return 0;
      xml = xml.replaceAll(needle, escapedReplacement);
      zip.file("word/document.xml", xml);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, zip.generate({ type: "nodebuffer" })); await fs.rename(temporary, target); }
      finally { await fs.rm(temporary, { force: true }); }
      return count;
    }
  };
}
export function registerDocumentTools(server, root) {
  const service = createDocumentService(root);
  server.registerTool("excel_read", {
    description: "Read worksheet names or a rectangular Excel range.",
    inputSchema: { path: z.string(), sheet: z.string().optional(), range: z.string().default("A1:A100") },
    annotations: { readOnlyHint: true }
  }, async input => json(await service.excelRead(input.path, input.sheet, input.range)));

  server.registerTool("excel_write", {
    description: "Write a rectangular Excel range inside the authorized root.",
    inputSchema: { path: z.string(), sheet: z.string().default("Sheet1"), range: z.string(),
      values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(1) },
    annotations: { destructiveHint: true }
  }, async input => json(await service.excelWrite(input.path, input.sheet, input.range, input.values)));

  server.registerTool("pdf_read", {
    description: "Extract text from a bounded PDF page range.",
    inputSchema: { path: z.string(), firstPage: z.number().int().min(1).default(1),
      lastPage: z.number().int().min(1).max(1000).default(100) },
    annotations: { readOnlyHint: true }
  }, async input => {
    if (input.lastPage < input.firstPage) throw new Error("Invalid page range");
    return { content: [{ type: "text", text: await service.pdfRead(input.path, input.firstPage, input.lastPage) }] };
  });

  server.registerTool("docx_read", {
    description: "Extract DOCX paragraph and table text.",
    inputSchema: { path: z.string() },
    annotations: { readOnlyHint: true }
  }, async input => ({ content: [{ type: "text", text: await service.docxRead(input.path) }] }));

  server.registerTool("docx_replace", {
    description: "Replace exact DOCX text inside the authorized root.",
    inputSchema: { path: z.string(), find: z.string().min(1), replacement: z.string() },
    annotations: { destructiveHint: true }
  }, async input => json({ replacements: await service.docxReplace(input.path, input.find, input.replacement) }));
}
