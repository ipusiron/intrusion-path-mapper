import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as core from "../js/ipm-core.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = rel => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const readme = read("README.md");
const readmeEn = read("README.en.md");
const BOTH = [["README.md", readme], ["README.en.md", readmeEn]];

/** コードブロックを除いた本文の行 */
function proseLines(text) {
  const out = [];
  let inCode = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { inCode = !inCode; continue; }
    if (!inCode) out.push(line);
  }
  return out;
}

const sample = name => core.normalizeGraph(JSON.parse(read(`sample-data/${name}.json`))).graph;

test("YAML メタデータの構造と値を保つ（README.md だけに置く）", () => {
  const block = readme.match(/^<!--\n---\n([\s\S]*?)\n---\n-->/);
  assert.ok(block, "HTML コメントで囲んだ YAML がない");
  const yaml = block[1];
  assert.match(yaml, /^id: day083$/m);
  assert.match(yaml, /^slug: intrusion-path-mapper$/m);
  assert.match(yaml, /^title: "Intrusion Path Mapper"$/m);
  assert.match(yaml, /^repo_url: "https:\/\/github\.com\/ipusiron\/intrusion-path-mapper"$/m);
  assert.match(yaml, /^demo_url: "https:\/\/ipusiron\.github\.io\/intrusion-path-mapper\/"$/m);
  assert.match(yaml, /^hub: true$/m);
  assert.match(yaml, /^difficulty: \d$/m);
  for (const key of ["category_ja", "category_en", "tags"]) {
    assert.match(yaml, new RegExp(`^${key}:\\n(  - .+\\n)+`, "m"), `${key} はブロック形式`);
  }
  const order = ["id", "slug", "title", "subtitle_ja", "subtitle_en", "description_ja", "description_en",
    "category_ja", "category_en", "difficulty", "tags", "repo_url", "demo_url", "hub"];
  const keys = [...yaml.matchAll(/^([a-z_]+):/gm)].map(m => m[1]);
  assert.deepEqual(keys, order);
  assert.ok(!readmeEn.includes("<!--\n---"));
});

test("言語の行と H1・Day の行", () => {
  assert.match(readme, /^\[English\]\(README\.en\.md\) · 日本語$/m);
  assert.match(readmeEn, /^English · \[日本語\]\(README\.md\)$/m);
  assert.ok(readme.indexOf("[English](README.en.md)") > readme.indexOf("-->"), "言語の行は YAML の後");
  assert.match(readme, /^# Intrusion Path Mapper - 侵入経路マッピングツール$/m);
  assert.match(readme, /^\*\*Day083 - 生成AIで作るセキュリティツール100\*\*$/m);
  assert.match(readmeEn, /^\*\*Day083 - 100 Security Tools with Generative AI\*\*$/m);
  for (const [, text] of BOTH) assert.ok(text.includes("https://akademeia.info/?page_id=42163"));
});

// 日英の見出しの対応（数・順・階層がそろっていること）
const HEADINGS = [
  ["## 🌐 デモページ", "## 🌐 Demo"],
  ["## 📸 スクリーンショット", "## 📸 Screenshots"],
  ["## ✨ 機能", "## ✨ Features"],
  ["## 📖 使い方", "## 📖 Usage"],
  ["### 基本の流れ", "### Basic flow"],
  ["### ローカルで動かす", "### Running locally"],
  ["## 📐 画面構成", "## 📐 Screen Layout"],
  ["## 🔬 技術的な説明", "## 🔬 Technical notes"],
  ["### vulnと成功確率", "### vuln and success probability"],
  ["### リスク", "### Risk"],
  ["### 2つの並べ方", "### Two orders"],
  ["### K本の経路（Yenのアルゴリズム）", "### K paths (Yen's algorithm)"],
  ["### プリセットシナリオ", "### Preset scenarios"],
  ["### JSONフォーマット", "### JSON format"],
  ["### ノードの種類と値の例", "### Node types and example values"],
  ["## 🎯 ユースケース", "## 🎯 Use Cases"],
  ["## 🧪 テスト", "## 🧪 Tests"],
  ["## 🔒 セキュリティ", "## 🔒 Security"],
  ["## ⚠️ 注意", "## ⚠️ Notes"],
  ["## 🔗 参考", "## 🔗 References"],
  ["## 👨‍💻 開発者向け情報", "## 👨‍💻 For developers"],
  ["## 📁 ディレクトリー構造", "## 📁 Directory Structure"],
  ["## 💻 動作環境", "## 💻 Requirements"],
  ["## 📄 ライセンス", "## 📄 License"],
  ["## 🛠️ このツールについて", "## 🛠️ About this tool"]
];

test("README.md と README.en.md の見出しが対応表どおり（数・順・階層）", () => {
  const heads = text => proseLines(text).filter(l => /^#{2,3} /.test(l));
  assert.deepEqual(heads(readme), HEADINGS.map(h => h[0]));
  assert.deepEqual(heads(readmeEn), HEADINGS.map(h => h[1]));
});

test("プリセットの表は計算部で再計算した値と一致する（日英）", () => {
  const rows = [
    ["sample-facility", "施設侵入（シンプル）", "Facility intrusion (simple)"],
    ["sample-office-network", "オフィスネットワーク攻撃", "Office network attack"],
    ["sample-physical-intrusion", "物理的侵入経路", "Physical intrusion"],
    ["sample-social-engineering", "ソーシャルエンジニアリング", "Social engineering"]
  ];
  for (const [file, ja, en] of rows) {
    const g = sample(file);
    const { start, goal } = core.defaultEndpoints(g);
    const [top] = core.findPaths(g, start, goal, { mode: "prob", k: 1 });
    const cells = `| ${g.nodes.length} | ${g.edges.length} | ${start}→${goal} | ${core.formatPercent(top.successProb)} |`;
    assert.ok(readme.includes(`| ${ja} ${cells}`), `README.md: ${ja} ${cells}`);
    assert.ok(readmeEn.includes(`| ${en} ${cells}`), `README.en.md: ${en} ${cells}`);
  }
});

test("2つの並べ方の例（物理的侵入経路）は計算部の出力と一致する（日英）", () => {
  const g = sample("sample-physical-intrusion");
  const { start, goal } = core.defaultEndpoints(g);
  const [byProb] = core.findPaths(g, start, goal, { mode: "prob", k: 3, nodePenalty: 0.4 });
  const [byCost] = core.findPaths(g, start, goal, { mode: "cost", k: 3, nodePenalty: 0.4 });
  const ja = p => p.path.map(i => g.nodes[i].label).join("→");
  const en = p => p.path.map(i => g.nodes[i].label_en).join("→");
  const pc = core.formatPercent(byCost.successProb), pp = core.formatPercent(byProb.successProb);
  assert.equal(pc, "0.292%");
  assert.equal(pp, "2.66%");
  assert.ok(readme.includes(`${ja(byCost)}、成功確率${pc}`));
  assert.ok(readme.includes(`${ja(byProb)}、${pp}`));
  assert.ok(readmeEn.includes(`${en(byCost)}, success probability ${pc}`));
  assert.ok(readmeEn.includes(`${en(byProb)}, ${pp}`));
  assert.equal(Math.round(byProb.successProb / byCost.successProb), 9);
  assert.ok(readme.includes("正面の約9倍"));
  assert.ok(readmeEn.includes("about nine times"));
});

test("成功確率の例 0.8×3 は 51.2%", () => {
  const { graph } = core.normalizeGraph({
    nodes: [{ id: "s" }, { id: "a", vuln: 0.8 }, { id: "b", vuln: 0.8 }, { id: "c", vuln: 0.8 }],
    edges: [{ source: "s", target: "a" }, { source: "a", target: "b" }, { source: "b", target: "c" }]
  });
  const [p] = core.findPaths(graph, "s", "c");
  assert.equal(core.formatPercent(p.successProb), "51.2%");
  assert.ok(readme.includes("0.8×0.8×0.8＝51.2%"));
  assert.ok(readmeEn.includes("0.8 × 0.8 × 0.8 = 51.2%"));
});

test("上限の数値は計算部の LIMITS と一致する（日英）", () => {
  assert.ok(readme.includes(`ファイル${core.LIMITS.maxFileBytes / 1024 / 1024}MB、ノード1,000、エッジ5,000`));
  assert.ok(readmeEn.includes(`${core.LIMITS.maxFileBytes / 1024 / 1024} MB per file, 1,000 nodes and 5,000 edges`));
  assert.equal(core.LIMITS.maxNodes, 1000);
  assert.equal(core.LIMITS.maxEdges, 5000);
});

/** ディレクトリー構造の木を読み、パスと説明の組にする */
function parseTree(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, heading);
  const block = text.slice(start).match(/```\n([\s\S]*?)\n```/)[1].split("\n");
  assert.equal(block[0], "intrusion-path-mapper/");
  const stack = [];
  const entries = [];
  for (const line of block.slice(1)) {
    const m = line.match(/^((?:│   |    )*)(├── |└── )(\S+)(\s+)# (.+)$/);
    assert.ok(m, `説明のない行: ${line}`);
    const depth = m[1].length / 4;
    stack.length = depth;
    const name = m[3].replace(/\/$/, "");
    stack.push(name);
    entries.push({ path: stack.join("/"), dir: m[3].endsWith("/"), col: line.indexOf("#") });
  }
  return entries;
}

test("ディレクトリー構造に追跡中の全ファイルが載り、全行に説明があり、# の桁がそろう（日英）", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n");
  for (const [name, text] of [["README.md", readme], ["README.en.md", readmeEn]]) {
    const heading = name === "README.md" ? "## 📁 ディレクトリー構造" : "## 📁 Directory Structure";
    const entries = parseTree(text, heading);
    const files = new Set(entries.filter(e => !e.dir).map(e => e.path));
    for (const f of tracked) assert.ok(files.has(f), `${name} のツリーに ${f} がない`);
    assert.equal(new Set(entries.map(e => e.col)).size, 1, `${name} の # の桁`);
  }
});

test("禁止語と表記（README.md の本文。コードを除く）", () => {
  const body = proseLines(readme).join("\n").replace(/`[^`]*`/g, "");
  for (const word of ["全て", "分かる", "分かり", "既に", "無い", "インターフェース"]) {
    assert.ok(!body.includes(word), word);
  }
  for (const re of [/ディレクトリ(?!ー)/, /サーバ(?!ー)/, /ユーザ(?!ー)/, /ブラウザ(?!ー)/, /パラメータ(?!ー)/, /ライブラリ(?!ー)/]) {
    assert.doesNotMatch(body, re);
  }
  assert.ok(!body.includes("⚠ "), "本文に ⚠ を使わない");
  assert.doesNotMatch(body, /以前は|改修前|旧版|初期の実装/);
  assert.doesNotMatch(readmeEn, /previous version|used to be|old version/i);
});

test("README.md の本文と表で日本語と英数字の間に空白を入れない（コード・H1・言語の行を除く）", () => {
  const JA = "[\\u3040-\\u30FF\\u3400-\\u9FFF\\uFF01-\\uFF60]";
  const gap = new RegExp(`${JA} [A-Za-z0-9]|[A-Za-z0-9] ${JA}`);
  const lines = proseLines(readme.slice(readme.indexOf("-->")))
    .filter(l => !l.startsWith("# ") && !l.startsWith("[English]"))
    .map(l => l.replace(/`[^`]*`/g, "x").replace(/\]\([^)]*\)/g, "]"));
  const hits = lines.filter(l => gap.test(l));
  assert.deepEqual(hits, []);
});

test("強調（**）は1つの H2 の節に2か所まで（日英）", () => {
  for (const [name, text] of BOTH) {
    const sections = text.slice(text.indexOf("# ")).split(/\n## /);
    for (const sec of sections.slice(1)) {
      const n = (sec.match(/\*\*[^*\n]+\*\*/g) || []).length;
      assert.ok(n <= 2, `${name} ## ${sec.split("\n")[0]}: ${n}`);
    }
  }
});

test("セキュリティの節は実装どおり（無効なヘッダーを実装済みと書かない）", () => {
  for (const [name, text] of BOTH) {
    const sec = text.slice(text.indexOf("## 🔒"), text.indexOf("## ⚠️"));
    assert.doesNotMatch(sec, /X-Frame-Options|X-Content-Type-Options|\.htaccess/, name);
    assert.match(sec, /frame-ancestors/, name);
    assert.match(sec, /'self'/, name);
    assert.match(sec, /textContent/, name);
  }
});

test("README から参照するファイル（相対リンク・画像）が実在する", () => {
  for (const [name, text] of BOTH) {
    const links = [...text.matchAll(/\]\(((?!https?:)[^)#]+)\)/g)].map(m => m[1]);
    assert.ok(links.length >= 6, name); // 言語の行・画像3枚・DEVELOPER.md・LICENSE
    for (const rel of links) {
      assert.doesNotThrow(() => readFileSync(path.join(ROOT, rel)), `${name}: ${rel}`);
    }
  }
});

test("スクリーンショットは日本語3枚・英語3枚で、assets/ の PNG はどれも README から参照される", () => {
  const images = text => [...text.matchAll(/!\[[^\]]+\]\(([^)]+\.png)\)/g)].map(m => m[1]);
  assert.deepEqual(images(readme), ["assets/screenshot.png", "assets/screenshot2.png", "assets/screenshot3.png"]);
  assert.deepEqual(images(readmeEn), ["assets/en/screenshot.png", "assets/en/screenshot2.png", "assets/en/screenshot3.png"]);
  const referenced = new Set([...images(readme), ...images(readmeEn)]);
  const pngs = [
    ...readdirSync(path.join(ROOT, "assets")).filter(f => f.endsWith(".png")).map(f => `assets/${f}`),
    ...readdirSync(path.join(ROOT, "assets/en")).filter(f => f.endsWith(".png")).map(f => `assets/en/${f}`)
  ];
  for (const f of pngs) assert.ok(referenced.has(f), `${f} は README から参照されていない`);
  for (const f of pngs) {
    const buf = readFileSync(path.join(ROOT, f));
    assert.ok(buf.length <= 300 * 1024, `${f}: ${buf.length}`);
    assert.equal(buf.readUInt32BE(16), 1280, `${f} の幅`);
    assert.equal(buf.readUInt32BE(20), 800, `${f} の高さ`);
  }
  for (const [, text] of BOTH) {
    const captions = [...text.matchAll(/^>\*(.+)\*$/gm)].map(m => m[1]);
    assert.equal(captions.length, 3);
  }
});

test("ディレクトリー構造に載っているファイルとディレクトリーはすべて実在する（日英）", () => {
  for (const [name, heading] of [["README.md", "## 📁 ディレクトリー構造"], ["README.en.md", "## 📁 Directory Structure"]]) {
    for (const e of parseTree(name === "README.md" ? readme : readmeEn, heading)) {
      assert.ok(readdirSync(path.join(ROOT, path.dirname(e.path))).includes(path.basename(e.path)), `${name}: ${e.path}`);
    }
  }
});
