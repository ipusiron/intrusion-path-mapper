import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const css = readFileSync(path.join(ROOT, "css/style.css"), "utf8");

/** :root の CSS 変数を読む */
function rootVars() {
  const block = css.match(/:root\s*\{([^}]*)\}/);
  assert.ok(block, ":root がある");
  const vars = {};
  for (const m of block[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1]] = m[2].toLowerCase();
  return vars;
}

/** WCAG 2.x の相対輝度 */
function luminance(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 半透明の文字を背景に重ねた色 */
function blend(fg, bg, alpha) {
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map(i => Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

const SIDEBAR = ["#121827", "#10141f"]; // .sidebar のグラデーションの両端
const BUTTON = "#1d2333";

test("文字と背景の組が 4.5:1 以上（ダーク配色）", () => {
  const v = rootVars();
  const backgrounds = [v.bg, v.panel, ...SIDEBAR, BUTTON];
  for (const fg of ["text", "muted", "accent", "accent2", "danger"]) {
    for (const bg of backgrounds) {
      const r = ratio(v[fg], bg);
      assert.ok(r >= 4.5, `--${fg} ${v[fg]} on ${bg}: ${r.toFixed(2)}`);
    }
  }
});

test("塗りのボタンの文字と、半透明の補足の文字", () => {
  const v = rootVars();
  assert.ok(ratio("#0a0d11", v.accent) >= 4.5, "主要ボタン（左端）");
  assert.ok(ratio("#0a0d11", "#4db8ff") >= 4.5, "主要ボタン（右端）");
  assert.ok(ratio("#0f1115", v.accent) >= 4.5, "ダイアログの保存");
  for (const bg of SIDEBAR) {
    const hint = blend(v.muted, bg, 0.7); // .empty-hint は opacity 0.7
    assert.ok(ratio(hint, bg) >= 4.5, `empty-hint on ${bg}: ${ratio(hint, bg).toFixed(2)}`);
  }
});

test("CSS の値が想定どおり（主要ボタンのグラデーションと empty-hint の opacity）", () => {
  assert.match(css, /linear-gradient\(135deg, var\(--accent\) 0%, #4db8ff 100%\)/);
  assert.match(css, /\.empty-hint \{[^}]*opacity: 0\.7;/);
  assert.match(css, /color: #0a0d11;/);
});
