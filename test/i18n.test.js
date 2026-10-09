import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MESSAGES } from "../js/ipm-messages.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = rel => readFileSync(path.join(ROOT, rel), "utf8");
const html = read("index.html");
const mainJs = read("js/main.js");
const coreJs = read("js/ipm-core.js");

// ひらがな・カタカナ・漢字・全角の記号（句読点・括弧・波ダッシュ・中黒・全角英数）
const JAPANESE = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uFF00-\uFFEF]/;
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test("日本語と英語の辞書のキーが一致する", () => {
  assert.deepEqual(Object.keys(MESSAGES.en).sort(), Object.keys(MESSAGES.ja).sort());
  assert.ok(Object.keys(MESSAGES.ja).length >= 100);
});

test("埋め込む値 {name} の組が日英で同じ", () => {
  for (const key of Object.keys(MESSAGES.ja)) {
    assert.deepEqual(placeholders(MESSAGES.en[key]), placeholders(MESSAGES.ja[key]), key);
  }
});

test("英語の文言に日本語の文字がない、空の文言がない", () => {
  for (const [key, value] of Object.entries(MESSAGES.en)) {
    assert.ok(value.trim(), key);
    assert.doesNotMatch(value, JAPANESE, key);
  }
  for (const [key, value] of Object.entries(MESSAGES.ja)) assert.ok(value.trim(), key);
});

test("日本語の文言は、日本語と英数字の間に空白を入れない（H1 の「ToolName - 説明」を除く）", () => {
  const JA = "[\\u3040-\\u30FF\\u3400-\\u9FFF\\uFF01-\\uFF60]";
  const gap = new RegExp(`${JA} [A-Za-z0-9#{]|[A-Za-z0-9}] ${JA}`);
  for (const [key, value] of Object.entries(MESSAGES.ja)) {
    if (key === "app.title") continue;
    assert.doesNotMatch(value, gap, `${key}: ${value}`);
  }
});

test("index.html の data-i18n のキーは辞書にあり、初期の文言は日本語の辞書と同じ", () => {
  const keys = [...html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 40, String(keys.length));
  for (const key of keys) assert.ok(key in MESSAGES.ja, key);
  for (const m of html.matchAll(/<(\w+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([^<]*)</g)) {
    assert.equal(m[3].trim(), MESSAGES.ja[m[2]], m[2]);
  }
});

test("main.js が t() で使うキーは辞書にある（graph.・warn.・mode. はコードの一覧から）", () => {
  const used = [...mainJs.matchAll(/\bt\("([^"]+)"/g)].map(m => m[1]);
  assert.ok(used.length >= 30);
  for (const key of used) assert.ok(key in MESSAGES.ja, key);
  const graphCodes = [...coreJs.matchAll(/new GraphError\("(\w+)"/g)].map(m => m[1]);
  assert.ok(graphCodes.length >= 10);
  for (const code of graphCodes) assert.ok(`graph.${code}` in MESSAGES.ja, code);
  const warnCodes = [...coreJs.matchAll(/warn\("(\w+)"/g)].map(m => m[1]);
  assert.ok(warnCodes.length >= 9);
  for (const code of warnCodes) assert.ok(`warn.${code}` in MESSAGES.ja, code);
  for (const mode of ["prob", "cost"]) assert.ok(`mode.${mode}` in MESSAGES.ja);
});

test("main.js のコード（コメントを除く）に日本語の文字列がない", () => {
  const code = mainJs
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map(line => line.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
  const hits = code.split("\n").filter(line => JAPANESE.test(line));
  assert.deepEqual(hits, []);
});

test("サンプルの全ノードに英語ラベルがあり、日本語を含まない", () => {
  const dir = path.join(ROOT, "sample-data");
  for (const f of readdirSync(dir).filter(x => x.endsWith(".json"))) {
    const json = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    for (const n of json.nodes) {
      assert.ok(n.label_en, `${f} ${n.id}`);
      assert.doesNotMatch(n.label_en, JAPANESE, `${f} ${n.id}`);
    }
    assert.doesNotMatch(json.meta.title, JAPANESE, f);
  }
});
