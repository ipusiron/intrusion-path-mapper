import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = rel => readFileSync(path.join(ROOT, rel), "utf8");
const lines = rel => read(rel).split(/\r?\n/);
const longest = rel => Math.max(...lines(rel).map(l => l.length));

const ownJs = readdirSync(path.join(ROOT, "js")).filter(f => f.endsWith(".js")).map(f => `js/${f}`);
const tests = readdirSync(path.join(ROOT, "test")).filter(f => f.endsWith(".js")).map(f => `test/${f}`);

test("1行に詰め込んだファイルがない（JS・CSS・テストは160文字以下）", () => {
  for (const rel of [...ownJs, "css/style.css", ...tests]) {
    assert.ok(longest(rel) <= 160, `${rel}: ${longest(rel)}`);
  }
});

test("index.html の最長行は250文字以下", () => {
  assert.ok(longest("index.html") <= 250, String(longest("index.html")));
});

test("主要ファイルの行数の下限", () => {
  const min = { "js/main.js": 500, "js/ipm-core.js": 300, "css/style.css": 600, "index.html": 150 };
  for (const [rel, n] of Object.entries(min)) {
    assert.ok(lines(rel).length >= n, `${rel}: ${lines(rel).length}`);
  }
});

test("自前の JS・CSS・テストに制御文字（タブ・改行以外）が入っていない", () => {
  for (const rel of [...ownJs, "css/style.css", ...tests]) {
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(read(rel)), rel);
  }
});

test("計算部 ipm-core.js は DOM に触れない", () => {
  const src = read("js/ipm-core.js");
  for (const word of ["document.", "window.", "localStorage", "d3."]) {
    assert.ok(!src.includes(word), word);
  }
});
