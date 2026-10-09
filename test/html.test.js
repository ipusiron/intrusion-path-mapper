import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = readFileSync(path.join(ROOT, "js/main.js"), "utf8");

test("main.js は module として読み込む", () => {
  assert.match(html, /<script type="module" src="\.\/js\/main\.js"><\/script>/);
});

test("インラインのイベントハンドラーがない", () => {
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
});

test("主要な要素の id がある", () => {
  const ids = [
    "fileInput", "exportBtn", "statusMsg", "presetSelect", "loadPresetBtn", "startSelect", "goalSelect", "rankMode",
    "kPaths", "nodePenalty", "analyzeBtn", "resultsSummary", "pathsList", "addNodeBtn", "addEdgeBtn", "nodeEditPanel",
    "editNodeBtn", "deleteNodeBtn", "nodeInfo", "graph", "nodePopup", "presetNotification", "presetNotificationTitle",
    "presetNotificationDetail", "presetNotificationClose", "nodeDialog", "nodeDialogTitle", "nodeDialogError", "nodeDialogId",
    "nodeDialogLabel", "nodeDialogType", "nodeDialogVuln", "nodeDialogImportance", "nodeDialogColor", "nodeDialogColorAuto",
    "nodeDialogColorReset", "nodeDialogSave", "nodeDialogCancel", "edgeDialog", "edgeDialogError", "edgeDialogSource",
    "edgeDialogTarget", "edgeDialogWeight", "edgeDialogSave", "edgeDialogCancel"
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
  assert.match(html, /<option value="prob" selected>/);
  assert.match(html, /<option value="cost">/);
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
