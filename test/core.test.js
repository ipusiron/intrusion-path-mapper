import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as core from "../js/ipm-core.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAMPLE_DIR = path.join(ROOT, "sample-data");
const SAMPLES = readdirSync(SAMPLE_DIR).filter(f => f.endsWith(".json")).sort();
const loadSample = f => JSON.parse(readFileSync(path.join(SAMPLE_DIR, f), "utf8"));

/** 全単純経路を列挙する（参照実装。Yen 法の結果と突き合わせる） */
function allSimplePaths(adj, s, g) {
  const out = [];
  const seen = new Set([s]);
  (function dfs(u, p, c) {
    if (u === g) { out.push({ path: [...p], cost: c }); return; }
    for (const { to, w } of adj[u]) {
      if (seen.has(to)) continue;
      seen.add(to); p.push(to);
      dfs(to, p, c + w);
      p.pop(); seen.delete(to);
    }
  })(s, [s], 0);
  return out.sort((a, b) => a.cost - b.cost);
}

const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

test("サンプル4件は警告なしで読み込める", () => {
  assert.equal(SAMPLES.length, 4);
  for (const f of SAMPLES) {
    const { graph, warnings } = core.normalizeGraph(loadSample(f));
    assert.deepEqual(warnings, [], f);
    assert.ok(graph.nodes.length >= 6, f);
    assert.ok(graph.attack_goals.length >= 1, f);
  }
});

test("読み込みを止める入力", () => {
  const err = (json, code) => assert.throws(() => core.normalizeGraph(json), e => e instanceof core.GraphError && e.code === code);
  err(null, "notObject");
  err([], "notObject");
  err({ nodes: {}, edges: [] }, "notArrays");
  err({ nodes: [], edges: [] }, "noNodes");
  err({ nodes: Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}` })) }, "tooManyNodes");
  err({ nodes: [{ id: "a" }], edges: Array.from({ length: 5001 }, () => ({ source: "a", target: "a" })) }, "tooManyEdges");
  err({ nodes: [{ id: 'c"><u>c</u>' }] }, "badNodeId");
  err({ nodes: [{ id: "a b" }] }, "badNodeId");
  err({ nodes: [{ id: "x".repeat(101) }] }, "badNodeId");
  err({ nodes: [{ id: "日本" }] }, "badNodeId");
  err({ nodes: [{ id: "a" }, { id: "a" }] }, "duplicateNodeId");
  err({ nodes: [{ id: "a", label: "x".repeat(201) }] }, "labelTooLong");
  err({ nodes: ["a"] }, "badNode");
  err({ nodes: [{ id: "a" }], edges: [null] }, "badEdge");
  assert.throws(() => core.parseGraphText("{"), e => e.code === "invalidJson");
  assert.throws(() => core.parseGraphText(" ".repeat(core.LIMITS.maxFileBytes + 1)), e => e.code === "fileTooLarge");
});

test("境界: ID 100文字・ラベル200文字は通る、数値の ID は文字列になる", () => {
  const { graph } = core.normalizeGraph({ nodes: [{ id: "x".repeat(100), label: "あ".repeat(200) }, { id: 7 }] });
  assert.equal(graph.nodes[0].label.length, 200);
  assert.equal(graph.nodes[1].id, "7");
  assert.equal(graph.nodes[1].label, "7");
});

test("ラベルの HTML は文字列のまま保持する（描画は textContent）", () => {
  const label = '<meta http-equiv="refresh" content="0;url=https://example.com">M';
  const { graph } = core.normalizeGraph({ nodes: [{ id: "m", label }] });
  assert.equal(graph.nodes[0].label, label);
});

test("サロゲートペアと絵文字のラベル", () => {
  const { graph } = core.normalizeGraph({ nodes: [{ id: "e", label: "𠮷野家🔐", label_en: "Yoshinoya 🔐" }] });
  assert.equal(graph.nodes[0].label, "𠮷野家🔐");
  assert.equal(core.nodeLabel(graph.nodes[0], "en"), "Yoshinoya 🔐");
  assert.equal(core.nodeLabel(graph.nodes[0], "ja"), "𠮷野家🔐");
});

test("直して続けられる入力は警告にする", () => {
  const { graph, warnings } = core.normalizeGraph({
    nodes: [
      { id: "a", type: "Camera", vuln: 2, importance: "x", color: "red" },
      { id: "b", type: "<b>", vuln: -1, label_en: 5 },
      { id: "c" }
    ],
    edges: [
      { source: "a", target: "b", weight: -5 },
      { source: "a", target: "b", weight: 1 },
      { source: "b", target: "b" },
      { source: "a", target: "zzz" },
      { source: "b", target: "c", weight: "abc" },
      { source: "c", target: "a" }
    ],
    attack_goals: ["c", "zzz", "c"]
  });
  const codes = warnings.map(w => w.code).sort();
  assert.deepEqual(codes, [
    "colorDropped", "edgesDuplicate", "edgesSelfLoop", "edgesUnknownNode", "labelEnDropped",
    "typeReplaced", "valueAdjusted", "valueAdjusted", "valueAdjusted", "weightClamped", "weightDefault"
  ]);
  assert.equal(graph.nodes[0].type, "camera");
  assert.equal(graph.nodes[0].vuln, 1);
  assert.equal(graph.nodes[0].importance, 0.5);
  assert.equal(graph.nodes[0].color, undefined);
  assert.equal(graph.nodes[1].type, "node");
  assert.equal(graph.nodes[1].vuln, 0);
  assert.deepEqual(graph.edges, [
    { source: "a", target: "b", weight: 0 },
    { source: "b", target: "c", weight: 1 },
    { source: "c", target: "a", weight: 1 }
  ]);
  assert.deepEqual(graph.attack_goals, ["c"]);
});

test("保存→読み込みで元に戻る（4サンプル）", () => {
  for (const f of SAMPLES) {
    const { graph } = core.normalizeGraph(loadSample(f));
    const again = core.normalizeGraph(JSON.parse(JSON.stringify(core.serializeGraph(graph)))).graph;
    assert.deepEqual(again, graph, f);
  }
});

test("D3 が書き換えた形（座標つきのノード、オブジェクトの端点）も保存形式に戻る", () => {
  const { graph } = core.normalizeGraph(loadSample("sample-facility.json"));
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const mutated = {
    ...graph,
    nodes: graph.nodes.map((n, i) => ({ ...n, index: i, x: 1.5, y: 2.5, vx: 0, vy: 0 })),
    edges: graph.edges.map(e => ({ ...e, source: byId.get(e.source), target: byId.get(e.target), index: 0 }))
  };
  const saved = core.serializeGraph(mutated);
  assert.equal(typeof saved.edges[0].source, "string");
  const allowed = ["id", "label", "label_en", "type", "vuln", "importance", "color"];
  for (const n of saved.nodes) assert.ok(Object.keys(n).every(k => allowed.includes(k)), JSON.stringify(n));
  for (const e of saved.edges) assert.deepEqual(Object.keys(e), ["source", "target", "weight"]);
  const again = core.normalizeGraph(JSON.parse(JSON.stringify(saved))).graph;
  assert.equal(again.edges.length, graph.edges.length);
  // 旧版が書き出した形（端点がオブジェクト）も読める
  const legacy = core.normalizeGraph(JSON.parse(JSON.stringify(mutated))).graph;
  assert.equal(legacy.edges.length, graph.edges.length);
});

test("保存するファイル名", () => {
  assert.equal(core.exportFileName({ title: "Sample Facility" }), "Sample_Facility.json");
  assert.equal(core.exportFileName({ title: "../../etc/passwd" }), "etc_passwd.json");
  assert.equal(core.exportFileName({ title: "施設" }), "intrusion-map.json");
  assert.equal(core.exportFileName({}), "intrusion-map.json");
});

test("新しいノードの ID は未使用のもの", () => {
  assert.equal(core.nextNodeId([{ id: "a" }, { id: "node3" }]), "node4");
  assert.equal(core.nextNodeId([{ id: "node2" }, { id: "node3" }]), "node4");
  assert.equal(core.nextNodeId([{ id: "a" }]), "node2");
});

test("既定の開始と目標（4サンプル）", () => {
  const expected = {
    "sample-facility.json": { start: "ext", goal: "srv1" },
    "sample-office-network.json": { start: "internet", goal: "ad_server" },
    "sample-physical-intrusion.json": { start: "outside", goal: "server_room" },
    "sample-social-engineering.json": { start: "attacker", goal: "ad_server" }
  };
  for (const f of SAMPLES) {
    assert.deepEqual(core.defaultEndpoints(core.normalizeGraph(loadSample(f)).graph), expected[f], f);
  }
  const noGoals = core.normalizeGraph({ nodes: [{ id: "a", importance: 0.2 }, { id: "b", importance: 0.9 }], edges: [{ source: "a", target: "b" }] }).graph;
  assert.deepEqual(core.defaultEndpoints(noGoals), { start: "a", goal: "b" });
});

test("Yen 法（コスト順）は全単純経路の総当たりと一致する", () => {
  let pairs = 0;
  for (const f of SAMPLES) {
    const { nodes, edges } = core.normalizeGraph(loadSample(f)).graph;
    for (const penalty of [0, 0.4, 2]) {
      const { adj } = core.buildAdjacency(nodes, edges, { mode: "cost", nodePenalty: penalty });
      for (let s = 0; s < nodes.length; s++) for (let g = 0; g < nodes.length; g++) {
        if (s === g) continue;
        const brute = allSimplePaths(adj, s, g).slice(0, 10);
        const yen = core.kShortestPaths(adj, s, g, 10);
        assert.equal(yen.length, brute.length, `${f} ${s}->${g}`);
        yen.forEach((p, i) => assert.ok(near(p.cost, brute[i].cost), `${f} ${s}->${g} #${i + 1}`));
        pairs++;
      }
    }
  }
  assert.ok(pairs > 1000);
});

test("成功確率順は確率の積の大きい順の上位 K 本と一致する", () => {
  for (const f of SAMPLES) {
    const { graph } = core.normalizeGraph(loadSample(f));
    const { nodes, edges } = graph;
    const { adj } = core.buildAdjacency(nodes, edges, { mode: "cost", nodePenalty: 0 });
    for (let s = 0; s < nodes.length; s++) for (let g = 0; g < nodes.length; g++) {
      if (s === g) continue;
      const probs = allSimplePaths(adj, s, g)
        .map(p => core.pathMetrics(nodes, edges, p.path).successProb)
        .filter(p => p > 0)
        .sort((a, b) => b - a)
        .slice(0, 10);
      const found = core.findPaths(graph, nodes[s].id, nodes[g].id, { mode: "prob", k: 10 });
      assert.equal(found.length, probs.length, `${f} ${s}->${g}`);
      found.forEach((p, i) => assert.ok(near(p.successProb, probs[i]), `${f} ${s}->${g} #${i + 1}`));
      for (let i = 1; i < found.length; i++) assert.ok(found[i - 1].successProb >= found[i].successProb - 1e-15);
    }
  }
});

test("成功確率は開始ノードを除く積、リスクは成功確率×目標の重要度", () => {
  const { graph } = core.normalizeGraph({
    nodes: [
      { id: "s", vuln: 0.1 }, { id: "a", vuln: 0.8 }, { id: "b", vuln: 0.8 }, { id: "g", vuln: 0.8, importance: 0.9 }
    ],
    edges: [{ source: "s", target: "a", weight: 1 }, { source: "a", target: "b", weight: 0.5 }, { source: "b", target: "g", weight: 2 }]
  });
  const [p] = core.findPaths(graph, "s", "g", { mode: "prob", k: 3, nodePenalty: 0.4 });
  assert.deepEqual(p.path, [0, 1, 2, 3]);
  assert.ok(near(p.successProb, 0.512));
  assert.equal(core.formatPercent(p.successProb), "51.2%");
  assert.ok(near(p.risk, 0.512 * 0.9));
  assert.equal(p.hops, 3);
  assert.ok(near(p.cost, 1 + 0.5 + 2 + 3 * 0.4 * 0.2));
});

test("vuln=0 のノードは成功確率順では通れない", () => {
  const { graph } = core.normalizeGraph({
    nodes: [{ id: "s" }, { id: "x", vuln: 0 }, { id: "g", vuln: 1 }],
    edges: [{ source: "s", target: "x" }, { source: "x", target: "g" }]
  });
  assert.deepEqual(core.findPaths(graph, "s", "g", { mode: "prob" }), []);
  const byCost = core.findPaths(graph, "s", "g", { mode: "cost" });
  assert.equal(byCost.length, 1);
  assert.equal(byCost[0].successProb, 0);
});

test("到達できない・開始と目標が同じ", () => {
  const { graph } = core.normalizeGraph({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ source: "b", target: "a" }] });
  assert.deepEqual(core.findPaths(graph, "a", "b"), []);
  assert.deepEqual(core.findPaths(graph, "a", "a"), []);
  assert.deepEqual(core.findPaths(graph, "a", "nope"), []);
});

test("1000ノードの鎖でも探索が終わる", () => {
  const nodes = Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, vuln: 0.99 }));
  const edges = [];
  for (let i = 0; i < 999; i++) {
    edges.push({ source: `n${i}`, target: `n${i + 1}`, weight: 1 });
    if (i + 2 < 1000) edges.push({ source: `n${i}`, target: `n${i + 2}`, weight: 1.5 });
  }
  const { graph } = core.normalizeGraph({ nodes, edges });
  const t0 = Date.now();
  const found = core.findPaths(graph, "n0", "n999", { mode: "cost", k: 10 });
  assert.equal(found.length, 10);
  assert.ok(Date.now() - t0 < 5000);
});

test("表示の桁", () => {
  assert.equal(core.formatPercent(0), "0%");
  assert.equal(core.formatPercent(1), "100.0%");
  assert.equal(core.formatPercent(0.512), "51.2%");
  assert.equal(core.formatPercent(0.0266), "2.66%");
  assert.equal(core.formatPercent(0.00112), "0.112%");
  assert.equal(core.formatPercent(0.000103), "0.0103%");
  assert.equal(core.formatPercent(5e-9), "5.00e-7%");
  assert.equal(core.formatScore(0), "0");
  assert.equal(core.formatScore(0.4608), "0.461");
  assert.equal(core.formatScore(0.00012345), "0.000123");
  assert.equal(core.formatScore(5e-7), "5.00e-7");
  assert.equal(core.formatCost(4.86), "4.86");
  assert.equal(core.formatCost(Infinity), "-");
});

test("K とペナルティの入力の正規化", () => {
  assert.equal(core.sanitizeK("2.7"), 2);
  assert.equal(core.sanitizeK(0), 1);
  assert.equal(core.sanitizeK(99), 10);
  assert.equal(core.sanitizeK("abc"), 3);
  assert.equal(core.sanitizePenalty(""), 0.4);
  assert.equal(core.sanitizePenalty(-1), 0);
  assert.equal(core.sanitizePenalty(3), 2);
  assert.equal(core.sanitizePenalty("0.7"), 0.7);
});

test("種類の色とカスタム色", () => {
  assert.equal(core.typeColor("server"), "#7cc7ff");
  assert.equal(core.typeColor("room"), "#9affc3");
  assert.equal(core.typeColor("camera"), "#9fb3c8");
  assert.equal(core.nodeColor({ type: "server", color: "#123456" }), "#123456");
  assert.equal(core.nodeColor({ type: "server", color: "javascript:x" }), "#7cc7ff");
});

test("初期言語", () => {
  assert.equal(core.resolveLocale({ query: "?lang=en", saved: "ja", languages: ["ja-JP"] }), "en");
  assert.equal(core.resolveLocale({ query: "?lang=xx", saved: "en" }), "en");
  assert.equal(core.resolveLocale({ saved: "fr", languages: ["en-US"] }), "en");
  assert.equal(core.resolveLocale({ languages: ["ja-JP"] }), "ja");
  assert.equal(core.resolveLocale({ languages: ["fr"] }), "en");
  assert.equal(core.resolveLocale({}), "ja");
});

test("上位K本に共通するノード（開始と目標を除く）", () => {
  const g = core.normalizeGraph(loadSample("sample-physical-intrusion.json")).graph;
  const paths = core.findPaths(g, "outside", "server_room", { mode: "prob", k: 3 });
  const ids = core.commonNodes(paths).map(i => g.nodes[i].id);
  assert.deepEqual(ids, ["corridor_2f", "ic_card_door", "server_room_door"]);
  // 返した以外の途中のノードは、どれかの経路が通らない
  const inner = new Set(paths.flatMap(p => p.path.slice(1, -1)));
  for (const i of inner) {
    const all = paths.every(p => p.path.includes(i));
    assert.equal(all, ids.includes(g.nodes[i].id), g.nodes[i].id);
  }
  assert.deepEqual(core.commonNodes(paths.slice(0, 1)), []);
  assert.deepEqual(core.commonNodes([]), []);
});

test("目標ごとのリスクは、各ノードへの成功確率の最大値（総当たり）と一致し、リスクの大きい順", () => {
  for (const f of SAMPLES) {
    const g = core.normalizeGraph(loadSample(f)).graph;
    const { adj } = core.buildAdjacency(g.nodes, g.edges, { mode: "cost", nodePenalty: 0 });
    for (let s = 0; s < g.nodes.length; s++) {
      const rows = core.targetRisks(g, g.nodes[s].id);
      const byId = new Map(rows.map(r => [r.id, r]));
      for (let t = 0; t < g.nodes.length; t++) {
        if (t === s) continue;
        const best = Math.max(0, ...allSimplePaths(adj, s, t).map(p => core.pathMetrics(g.nodes, g.edges, p.path).successProb));
        const row = byId.get(g.nodes[t].id);
        if (best === 0) { assert.equal(row, undefined, `${f} ${s}->${t}`); continue; }
        assert.ok(row && near(row.successProb, best), `${f} ${s}->${t}`);
        assert.ok(near(row.risk, best * g.nodes[t].importance));
        assert.equal(row.path[0], s);
        assert.equal(row.path[row.path.length - 1], t);
      }
      for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].risk >= rows[i].risk);
    }
  }
});

test("目標ごとのリスク（物理的侵入経路、屋外から）の上位3件", () => {
  const g = core.normalizeGraph(loadSample("sample-physical-intrusion.json")).graph;
  const top = core.targetRisks(g, "outside").slice(0, 3).map(r => [r.id, core.formatPercent(r.successProb), core.formatScore(r.risk)]);
  // 手計算: 2F窓 0.70×0.5、1F窓 0.60×0.4、一般社員 0.6×0.95×0.7＝0.399 に ×0.6
  assert.deepEqual(top, [["window_2f", "70.0%", "0.350"], ["window_1f", "60.0%", "0.240"], ["employee", "39.9%", "0.239"]]);
});

test("エッジの追加・変更・削除（元の配列は変えない）", () => {
  const g = core.normalizeGraph({ nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: [{ source: "b", target: "a", weight: 2 }] }).graph;
  const before = JSON.stringify(g.edges);
  assert.equal(core.addEdge(g, "a", "a", 1).error, "sameNode");
  assert.equal(core.addEdge(g, "a", "x", 1).error, "unknownNode");
  assert.equal(core.addEdge(g, "a", "b", -1).error, "weight");
  assert.equal(core.addEdge(g, "a", "b", "").error, "weight");
  assert.equal(core.addEdge(g, "b", "a", 1).error, "edgeExists");
  const one = core.addEdge(g, "a", "c", "1.5", { bidirectional: true });
  assert.deepEqual([one.error, one.added, one.reverseSkipped], [null, 2, false]);
  assert.deepEqual(one.edges.slice(1), [{ source: "a", target: "c", weight: 1.5 }, { source: "c", target: "a", weight: 1.5 }]);
  const skip = core.addEdge(g, "a", "b", 1, { bidirectional: true });
  assert.deepEqual([skip.added, skip.reverseSkipped], [1, true]);
  assert.equal(JSON.stringify(g.edges), before);
  assert.deepEqual(core.edgesOf({ ...g, edges: one.edges }, "a"), {
    outgoing: [{ source: "a", target: "c", weight: 1.5 }],
    incoming: [{ source: "b", target: "a", weight: 2 }, { source: "c", target: "a", weight: 1.5 }]
  });
  const up = core.updateEdgeWeight(g, "b", "a", 0);
  assert.deepEqual([up.error, up.edges[0].weight], [null, 0]);
  assert.equal(core.updateEdgeWeight(g, "a", "b", 1).error, "noEdge");
  assert.equal(core.updateEdgeWeight(g, "b", "a", "x").error, "weight");
  assert.deepEqual(core.removeEdge(g, "b", "a"), []);
  assert.equal(JSON.stringify(g.edges), before);
  assert.equal(core.parseWeight("0"), 0);
  assert.equal(core.parseWeight("1e400"), null);
});
