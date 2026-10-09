import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TYPE_COLORS } from "../js/ipm-core.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = readFileSync(path.join(ROOT, "js/main.js"), "utf8");

test("main.js は module として読み込む", () => {
  assert.match(html, /<script type="module" src="\.\/js\/main\.js"><\/script>/);
});

test("meta CSP は 'self' だけ（外部ドメイン・unsafe-inline・frame-ancestors なし）", () => {
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, "CSP meta がある");
  const csp = m[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|frame-ancestors/);
});

test("meta では効かないヘッダーを書かない、referrer・favicon・noscript がある", () => {
  assert.doesNotMatch(html, /http-equiv="X-(Content-Type-Options|Frame-Options)"/i);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<link rel="icon" href="data:/);
  assert.match(html, /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
});

test("style 属性がない（CSP の style-src 'self' で止まるため）", () => {
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(mainJs, /setAttribute\(\s*["']style["']/);
  assert.doesNotMatch(mainJs, /\.attr\(\s*["']style["']/);
});

test("D3 は自己ホストした 7.9.0（SHA-256 とライセンス）", () => {
  assert.match(html, /<script src="\.\/vendor\/d3\/d3\.v7\.9\.0\.min\.js"><\/script>/);
  const buf = readFileSync(path.join(ROOT, "vendor/d3/d3.v7.9.0.min.js"));
  const sha = createHash("sha256").update(buf).digest("hex");
  assert.equal(sha, "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539");
  assert.match(buf.subarray(0, 80).toString("utf8"), /d3js\.org v7\.9\.0/);
  const license = readFileSync(path.join(ROOT, "vendor/d3/LICENSE"), "utf8");
  assert.match(license, /Copyright 2010-2023 Mike Bostock/);
  assert.match(license, /Permission to use, copy, modify, and\/or distribute/);
});

test("凡例の色は計算部の TYPE_COLORS と一致する", () => {
  const css = readFileSync(path.join(ROOT, "css/style.css"), "utf8");
  for (const type of ["server", "device", "account", "person", "gateway", "node"]) {
    const m = css.match(new RegExp(`\\.legend-color\\.type-${type} \\{ background: (#[0-9a-f]{6}); \\}`));
    assert.ok(m, type);
    assert.equal(m[1], TYPE_COLORS[type], type);
    assert.match(html, new RegExp(`legend-color type-${type}`));
  }
});

test("インラインのイベントハンドラーがない", () => {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("主要な要素の id がある", () => {
  const ids = [
    "fileInput", "exportBtn", "statusMsg", "presetSelect", "loadPresetBtn", "startSelect", "goalSelect", "rankMode",
    "kPaths", "nodePenalty", "analyzeBtn", "dimOthers", "resultsSummary", "commonNodes", "pathsList", "addNodeBtn", "addEdgeBtn", "nodeEditPanel",
    "editNodeBtn", "deleteNodeBtn", "nodeInfo", "graph", "nodePopup", "presetNotification", "presetNotificationTitle",
    "presetNotificationDetail", "presetNotificationClose", "nodeDialog", "nodeDialogTitle", "nodeDialogError", "nodeDialogId",
    "nodeDialogLabel", "nodeDialogType", "nodeDialogVuln", "nodeDialogImportance", "nodeDialogColor", "nodeDialogColorAuto",
    "nodeDialogColorReset", "nodeDialogSave", "nodeDialogCancel", "edgeDialog", "edgeDialogError", "edgeDialogSource",
    "edgeDialogTarget", "edgeDialogWeight", "edgeDialogBoth", "edgeDialogBothRow", "edgeDialogTitle", "edgeDialogSave", "edgeDialogCancel"
  ];
  for (const id of ids) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
    assert.ok(mainJs.includes(`"${id}"`) || mainJs.includes(`"#${id}"`), `main.js が ${id} を参照している`);
  }
});

test("ダイアログは <dialog>、ボタンはすべて type を持つ", () => {
  assert.match(html, /<dialog id="nodeDialog"/);
  assert.match(html, /<dialog id="edgeDialog"/);
  const buttons = html.match(/<button\b[^>]*>/g) || [];
  assert.ok(buttons.length >= 10);
  for (const b of buttons) assert.match(b, /type="button"/, b);
});

test("並べ方の選択肢は成功確率順（既定）とコスト順", () => {
  assert.match(html, /<option value="prob" selected[ >]/);
  assert.match(html, /<option value="cost"[ >]/);
});

test("ラベルの for は実在する id を指す", () => {
  const fors = [...html.matchAll(/<label for="([^"]+)"/g)].map(m => m[1]);
  assert.ok(fors.length >= 10);
  for (const id of fors) assert.ok(html.includes(`id="${id}"`), id);
});

test("外部へのリンクは noopener noreferrer", () => {
  const blank = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || [];
  for (const a of blank) assert.match(a, /rel="noopener noreferrer"/, a);
});

test("main.js は取り込んだ値を innerHTML に入れない", () => {
  assert.doesNotMatch(mainJs, /\.innerHTML\s*=/);
  assert.doesNotMatch(mainJs, /insertAdjacentHTML|outerHTML\s*=/);
  assert.doesNotMatch(mainJs, /console\.log/);
  assert.doesNotMatch(mainJs, /\balert\(/);
});
