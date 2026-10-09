/* Intrusion Path Mapper - 計算部（DOM に触れない純粋な ES module）
   - マップ（JSON）の検証と正規化、保存形式への書き出し
   - 隣接リスト（成功確率順＝−ln(vuln)、コスト順＝weight＋ペナルティ）
   - Dijkstra（二分ヒープ）と Yen の K 最短経路
   - 経路の指標（成功確率・リスク・コスト）と表示の桁
   - 既定の開始・目標、言語の初期値
*/

export const LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,
  maxNodes: 1000,
  maxEdges: 5000,
  maxIdLength: 100,
  maxLabelLength: 200,
  maxMetaLength: 200,
  maxK: 10,
  maxPenalty: 2
});

export const NODE_TYPES = Object.freeze(["gateway", "device", "server", "account", "room", "person", "node"]);

export const TYPE_COLORS = Object.freeze({
  server: "#7cc7ff",
  device: "#ffd580",
  account: "#c3a6ff",
  person: "#ffb3d9",
  gateway: "#9affc3",
  room: "#9affc3",
  node: "#9fb3c8"
});

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const TYPE_PATTERN = /^[a-z0-9_-]{1,30}$/;
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const META_KEYS = ["title", "title_en", "author", "created_at"];

/** 読み込みを止める誤り。code は辞書のキー、params は埋め込む値 */
export class GraphError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = "GraphError";
    this.code = code;
    this.params = params;
  }
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** 0〜1 の数に直す。数でなければ fallback */
export function toUnit(v, fallback = 0.5) {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 0, 1);
}

/** 経路の数 K（1〜10 の整数、既定 3） */
export function sanitizeK(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return 3;
  return clamp(n, 1, LIMITS.maxK);
}

/** ノード難易度の重み（0〜2、既定 0.4） */
export function sanitizePenalty(v) {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  if (!Number.isFinite(n)) return 0.4;
  return clamp(n, 0, LIMITS.maxPenalty);
}

/** エッジの端点の ID（D3 が source/target をノードのオブジェクトに置き換えた後でも取れる） */
export function endpointId(v) {
  if (v && typeof v === "object") return String(v.id);
  return String(v);
}

export function typeColor(type) {
  const t = String(type || "node").toLowerCase();
  for (const key of ["server", "device", "account", "person", "gateway", "room"]) {
    if (t.includes(key)) return TYPE_COLORS[key];
  }
  return TYPE_COLORS.node;
}

export function nodeColor(node) {
  if (node && typeof node.color === "string" && COLOR_PATTERN.test(node.color)) return node.color;
  return typeColor(node && node.type);
}

/** 表示名。英語表示で label_en があればそれを使う */
export function nodeLabel(node, locale = "ja") {
  if (locale === "en" && node.label_en) return node.label_en;
  return node.label;
}

function shortText(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

/**
 * JSON（オブジェクト）を検証して正規化する。
 * 読み込みを止める誤りは GraphError を投げる。直して続けられるものは warnings に入れる。
 * @returns {{graph: object, warnings: Array<{code: string, params: object}>}}
 */
export function normalizeGraph(json) {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new GraphError("notObject");
  }
  const rawNodes = json.nodes ?? [];
  const rawEdges = json.edges ?? [];
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) throw new GraphError("notArrays");
  if (rawNodes.length === 0) throw new GraphError("noNodes");
  if (rawNodes.length > LIMITS.maxNodes) throw new GraphError("tooManyNodes", { max: LIMITS.maxNodes });
  if (rawEdges.length > LIMITS.maxEdges) throw new GraphError("tooManyEdges", { max: LIMITS.maxEdges });

  const warnings = [];
  const warn = (code, params = {}) => warnings.push({ code, params });

  const ids = new Set();
  const nodes = rawNodes.map((n, i) => {
    if (typeof n !== "object" || n === null) throw new GraphError("badNode", { index: i + 1 });
    const id = typeof n.id === "number" ? String(n.id) : n.id;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      throw new GraphError("badNodeId", { index: i + 1, max: LIMITS.maxIdLength });
    }
    if (ids.has(id)) throw new GraphError("duplicateNodeId", { id });
    ids.add(id);

    let label = n.label ?? id;
    if (typeof label !== "string") label = String(label);
    label = label.trim() || id;
    if (label.length > LIMITS.maxLabelLength) throw new GraphError("labelTooLong", { id, max: LIMITS.maxLabelLength });

    let type = typeof n.type === "string" ? n.type.trim().toLowerCase() : "node";
    if (!TYPE_PATTERN.test(type)) {
      warn("typeReplaced", { id });
      type = "node";
    }

    const vuln = toUnit(n.vuln, 0.5);
    const importance = toUnit(n.importance, 0.5);
    if (n.vuln !== undefined && Number(n.vuln) !== vuln) warn("valueAdjusted", { id, field: "vuln", value: vuln });
    if (n.importance !== undefined && Number(n.importance) !== importance) {
      warn("valueAdjusted", { id, field: "importance", value: importance });
    }

    const node = { id, label, type, vuln, importance };
    if (n.label_en !== undefined) {
      const en = shortText(n.label_en, LIMITS.maxLabelLength);
      if (en) node.label_en = en;
      else warn("labelEnDropped", { id });
    }
    if (n.color !== undefined) {
      if (typeof n.color === "string" && COLOR_PATTERN.test(n.color)) node.color = n.color.toLowerCase();
      else warn("colorDropped", { id });
    }
    return node;
  });

  const seenEdges = new Set();
  const edges = [];
  let unknown = 0, selfLoops = 0, duplicates = 0;
  rawEdges.forEach((e, i) => {
    if (typeof e !== "object" || e === null) throw new GraphError("badEdge", { index: i + 1 });
    const source = endpointId(e.source);
    const target = endpointId(e.target);
    if (!ids.has(source) || !ids.has(target)) { unknown++; return; }
    if (source === target) { selfLoops++; return; }
    const key = `${source}\u0000${target}`;
    if (seenEdges.has(key)) { duplicates++; return; }
    seenEdges.add(key);

    let weight = e.weight === undefined || e.weight === null || e.weight === "" ? 1 : Number(e.weight);
    if (!Number.isFinite(weight)) {
      warn("weightDefault", { source, target });
      weight = 1;
    } else if (weight < 0) {
      warn("weightClamped", { source, target });
      weight = 0;
    }
    edges.push({ source, target, weight });
  });
  if (unknown) warn("edgesUnknownNode", { count: unknown });
  if (selfLoops) warn("edgesSelfLoop", { count: selfLoops });
  if (duplicates) warn("edgesDuplicate", { count: duplicates });

  const meta = {};
  if (json.meta && typeof json.meta === "object") {
    for (const key of META_KEYS) {
      const v = shortText(json.meta[key], LIMITS.maxMetaLength);
      if (v) meta[key] = v;
    }
  }

  const goals = Array.isArray(json.attack_goals) ? json.attack_goals.map(String) : [];
  const attack_goals = [...new Set(goals.filter(id => ids.has(id)))];

  return { graph: { meta, nodes, edges, attack_goals }, warnings };
}

/** ファイルの中身（文字列）を読む。サイズと JSON の誤りも GraphError にする */
export function parseGraphText(text) {
  if (typeof text !== "string") throw new GraphError("notObject");
  if (text.length > LIMITS.maxFileBytes) throw new GraphError("fileTooLarge", { mb: LIMITS.maxFileBytes / 1024 / 1024 });
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GraphError("invalidJson");
  }
  return normalizeGraph(json);
}

/** 保存用のオブジェクト。D3 が足した座標や、オブジェクトに置き換わった端点を落とす */
export function serializeGraph(graph) {
  const nodes = graph.nodes.map(n => {
    const out = { id: n.id, label: n.label };
    if (n.label_en) out.label_en = n.label_en;
    out.type = n.type;
    out.vuln = n.vuln;
    out.importance = n.importance;
    if (n.color) out.color = n.color;
    return out;
  });
  const edges = graph.edges.map(e => ({ source: endpointId(e.source), target: endpointId(e.target), weight: e.weight }));
  const out = { meta: { ...graph.meta }, nodes, edges };
  if (graph.attack_goals && graph.attack_goals.length) out.attack_goals = [...graph.attack_goals];
  return out;
}

/** 保存するファイル名（英数字・_・- だけにする） */
export function exportFileName(meta) {
  const base = String(meta?.title ?? "").trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return (base || "intrusion-map") + ".json";
}

/** 新しいノードの ID（node1, node2, … のうち未使用のもの） */
export function nextNodeId(nodes) {
  const used = new Set(nodes.map(n => n.id));
  for (let i = nodes.length + 1; ; i++) {
    if (!used.has(`node${i}`)) return `node${i}`;
  }
}

/** 既定の開始と目標。目標＝attack_goals の先頭か重要度の最大、開始＝入ってくるエッジのないノード */
export function defaultEndpoints(graph) {
  const { nodes, edges } = graph;
  if (!nodes.length) return { start: null, goal: null };
  let goal = graph.attack_goals?.find(id => nodes.some(n => n.id === id)) ?? null;
  if (!goal) {
    goal = nodes.reduce((best, n) => (n.importance > best.importance ? n : best), nodes[0]).id;
  }
  const hasIncoming = new Set(edges.map(e => endpointId(e.target)));
  const start = nodes.find(n => n.id !== goal && !hasIncoming.has(n.id)) ?? nodes.find(n => n.id !== goal) ?? null;
  return { start: start ? start.id : null, goal };
}

/* ---------- 経路探索 ---------- */

/**
 * 隣接リスト。mode="prob" は −ln(行き先の vuln)、mode="cost" は weight＋ペナルティ×(1−行き先の vuln)。
 * 成功確率順では vuln=0 のノードへは進めない（確率0）。
 */
export function buildAdjacency(nodes, edges, { mode = "prob", nodePenalty = 0.4 } = {}) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const adj = nodes.map(() => []);
  for (const e of edges) {
    const si = index.get(endpointId(e.source));
    const ti = index.get(endpointId(e.target));
    if (si === undefined || ti === undefined) continue;
    const v = nodes[ti].vuln;
    let w;
    if (mode === "prob") {
      if (!(v > 0)) continue;
      w = -Math.log(v);
    } else {
      w = Number(e.weight) + nodePenalty * (1 - v);
    }
    adj[si].push({ to: ti, w });
  }
  return { adj, index };
}

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** start から goal への最短経路。blockedNodes（添字）と blockedEdges（"u-v"）は通らない */
export function dijkstra(adj, start, goal, blockedNodes = new Set(), blockedEdges = new Set()) {
  const N = adj.length;
  const dist = new Array(N).fill(Infinity);
  const prev = new Array(N).fill(-1);
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push([0, start]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === goal) break;
    for (const { to, w } of adj[u]) {
      if (blockedNodes.has(to) || blockedEdges.has(`${u}-${to}`)) continue;
      const nd = d + w;
      if (nd < dist[to]) {
        dist[to] = nd;
        prev[to] = u;
        heap.push([nd, to]);
      }
    }
  }
  if (dist[goal] === Infinity) return null;
  const path = [];
  for (let v = goal; v !== -1; v = prev[v]) path.push(v);
  path.reverse();
  return { cost: dist[goal], path };
}

function pathCostOnAdj(adj, path) {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    let best = Infinity;
    for (const e of adj[path[i]]) if (e.to === path[i + 1] && e.w < best) best = e.w;
    total += best;
  }
  return total;
}

/** Yen の K 最短経路（単純経路、コストの小さい順） */
export function kShortestPaths(adj, start, goal, K) {
  if (start === goal) return [];
  const first = dijkstra(adj, start, goal);
  if (!first) return [];
  const A = [first];
  const B = [];
  const seen = new Set([first.path.join(",")]);

  for (let k = 1; k < K; k++) {
    const prevPath = A[k - 1].path;
    for (let i = 0; i < prevPath.length - 1; i++) {
      const spur = prevPath[i];
      const root = prevPath.slice(0, i + 1);
      const blockedEdges = new Set();
      for (const p of A) {
        if (p.path.length > i + 1 && root.every((v, j) => p.path[j] === v)) {
          blockedEdges.add(`${p.path[i]}-${p.path[i + 1]}`);
        }
      }
      const blockedNodes = new Set(root.slice(0, -1));
      const spurPath = dijkstra(adj, spur, goal, blockedNodes, blockedEdges);
      if (!spurPath) continue;
      const path = [...root.slice(0, -1), ...spurPath.path];
      const key = path.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      B.push({ cost: pathCostOnAdj(adj, path), path });
    }
    if (!B.length) break;
    B.sort((a, b) => a.cost - b.cost || a.path.length - b.path.length);
    A.push(B.shift());
  }
  return A;
}

/** 経路の重みとペナルティによるコスト（コスト順で使う値） */
export function weightedCost(nodes, edges, path, nodePenalty) {
  const w = new Map(edges.map(e => [`${endpointId(e.source)}\u0000${endpointId(e.target)}`, Number(e.weight)]));
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = nodes[path[i]], b = nodes[path[i + 1]];
    total += (w.get(`${a.id}\u0000${b.id}`) ?? NaN) + nodePenalty * (1 - b.vuln);
  }
  return total;
}

/**
 * 経路の指標。成功確率＝開始ノードを除く経路上のノードの vuln の積、リスク＝成功確率×目標の重要度。
 * @param {number[]} path ノードの添字の列（先頭が開始、末尾が目標）
 */
export function pathMetrics(nodes, edges, path, nodePenalty = 0.4) {
  if (!path || path.length < 2) return { successProb: 0, risk: 0, hops: 0, cost: 0, goalImportance: 0 };
  let successProb = 1;
  for (let i = 1; i < path.length; i++) successProb *= nodes[path[i]].vuln;
  const goalImportance = nodes[path[path.length - 1]].importance;
  return {
    successProb,
    risk: successProb * goalImportance,
    hops: path.length - 1,
    cost: weightedCost(nodes, edges, path, nodePenalty),
    goalImportance
  };
}

/**
 * 開始から目標までの経路を探す。mode="prob" は成功確率の高い順、"cost" はコストの低い順。
 * @returns {Array<{path: number[], successProb: number, risk: number, hops: number, cost: number}>}
 */
export function findPaths(graph, startId, goalId, { mode = "prob", k = 3, nodePenalty = 0.4 } = {}) {
  const { nodes, edges } = graph;
  const { adj, index } = buildAdjacency(nodes, edges, { mode, nodePenalty });
  const s = index.get(startId), g = index.get(goalId);
  if (s === undefined || g === undefined || s === g) return [];
  return kShortestPaths(adj, s, g, sanitizeK(k)).map(r => ({ path: r.path, ...pathMetrics(nodes, edges, r.path, nodePenalty) }));
}

/**
 * 経路の列がすべて通るノード（開始と目標を除く）の添字を、1本目の経路の順で返す。
 * 2本未満なら空（1本だけなら全部が「共通」になって意味がない）。
 */
export function commonNodes(paths) {
  if (!paths || paths.length < 2) return [];
  const first = paths[0].path;
  const inner = first.slice(1, -1);
  return inner.filter(i => paths.every(p => p.path.slice(1, -1).includes(i)));
}

/** start から全ノードへの最短経路の木（距離と直前のノード） */
function shortestTree(adj, start) {
  const N = adj.length;
  const dist = new Array(N).fill(Infinity);
  const prev = new Array(N).fill(-1);
  dist[start] = 0;
  const heap = new MinHeap();
  heap.push([0, start]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    for (const { to, w } of adj[u]) {
      const nd = d + w;
      if (nd < dist[to]) {
        dist[to] = nd;
        prev[to] = u;
        heap.push([nd, to]);
      }
    }
  }
  return { dist, prev };
}

/**
 * 目標ごとのリスク。開始ノードから到達できる各ノードについて、成功確率が最大の経路
 * （−ln(vuln) を重みにした Dijkstra を1回）と、リスク＝成功確率×そのノードの importance を求める。
 * リスクの大きい順（同じなら成功確率の大きい順、ID の順）に並べる。
 * @returns {Array<{id: string, path: number[], successProb: number, importance: number, risk: number, hops: number}>}
 */
export function targetRisks(graph, startId) {
  const { nodes, edges } = graph;
  const { adj, index } = buildAdjacency(nodes, edges, { mode: "prob" });
  const s = index.get(startId);
  if (s === undefined) return [];
  const { dist, prev } = shortestTree(adj, s);
  const out = [];
  nodes.forEach((n, i) => {
    if (i === s || dist[i] === Infinity) return;
    const path = [];
    for (let v = i; v !== -1; v = prev[v]) path.push(v);
    path.reverse();
    const { successProb } = pathMetrics(nodes, edges, path);
    out.push({ id: n.id, path, successProb, importance: n.importance, risk: successProb * n.importance, hops: path.length - 1 });
  });
  return out.sort((a, b) => b.risk - a.risk || b.successProb - a.successProb || (a.id < b.id ? -1 : 1));
}

/* ---------- 対策の効果 ---------- */

/**
 * 1位の経路（成功確率が最大の経路）の途中のノードを1つずつ塞いだときの、成功確率の1位。
 * 1位の経路に乗っていないノードを塞いでも1位は変わらないので、途中のノードだけを調べる。
 * 塞いだあとの成功確率が小さい順（効果の大きい順）に並べる。届かなくなれば after は 0。
 * @returns {{before: number, path: number[], rows: Array<{id: string, before: number, after: number, drop: number}>}}
 */
export function blockImpact(graph, startId, goalId) {
  const { nodes, edges } = graph;
  const { adj, index } = buildAdjacency(nodes, edges, { mode: "prob" });
  const s = index.get(startId), g = index.get(goalId);
  if (s === undefined || g === undefined || s === g) return { before: 0, path: [], rows: [] };
  const best = dijkstra(adj, s, g);
  if (!best) return { before: 0, path: [], rows: [] };
  const before = pathMetrics(nodes, edges, best.path).successProb;
  const rows = best.path.slice(1, -1).map(v => {
    const r = dijkstra(adj, s, g, new Set([v]));
    const after = r ? pathMetrics(nodes, edges, r.path).successProb : 0;
    return { id: nodes[v].id, before, after, drop: before - after };
  });
  rows.sort((a, b) => a.after - b.after || (a.id < b.id ? -1 : 1));
  return { before, path: best.path, rows };
}

/**
 * すべての経路を断つ最小のノードの組（最小頂点カット）。成功確率が0より大きい経路だけを数える
 * （vuln=0 のノードへは進めない）。ノードを入口と出口に分けた容量1の辺にして最大流を求め、
 * 残余グラフで開始から届く側と届かない側の境目のノードを返す（開始に近い側の組）。
 * @returns {{size: number, nodes: number[], direct: boolean}}
 *   direct=true は開始から目標へ直接のエッジがある（ノードを塞いでも断てない）。届く経路がなければ size=0
 */
export function minVertexCut(graph, startId, goalId) {
  const { nodes, edges } = graph;
  const { adj, index } = buildAdjacency(nodes, edges, { mode: "prob" });
  const s = index.get(startId), g = index.get(goalId);
  if (s === undefined || g === undefined || s === g) return { size: 0, nodes: [], direct: false };
  if (adj[s].some(e => e.to === g)) return { size: Infinity, nodes: [], direct: true };
  const N = nodes.length;
  const INF = N + 1;
  // 頂点 v の入口は 2v、出口は 2v+1。開始と目標は内部の辺を容量 INF にする
  const cap = new Map();
  const nbr = Array.from({ length: 2 * N }, () => new Set());
  const addArc = (a, b, c) => {
    cap.set(`${a},${b}`, (cap.get(`${a},${b}`) || 0) + c);
    if (!cap.has(`${b},${a}`)) cap.set(`${b},${a}`, 0);
    nbr[a].add(b);
    nbr[b].add(a);
  };
  for (let v = 0; v < N; v++) addArc(2 * v, 2 * v + 1, v === s || v === g ? INF : 1);
  adj.forEach((list, u) => list.forEach(({ to }) => addArc(2 * u + 1, 2 * to, INF)));
  const source = 2 * s + 1, sink = 2 * g;
  let flow = 0;
  for (;;) {
    const prev = new Array(2 * N).fill(-1);
    prev[source] = source;
    const queue = [source];
    while (queue.length && prev[sink] === -1) {
      const a = queue.shift();
      for (const b of nbr[a]) {
        if (prev[b] === -1 && cap.get(`${a},${b}`) > 0) {
          prev[b] = a;
          queue.push(b);
        }
      }
    }
    if (prev[sink] === -1) break;
    for (let b = sink; b !== source; b = prev[b]) {
      const a = prev[b];
      cap.set(`${a},${b}`, cap.get(`${a},${b}`) - 1);
      cap.set(`${b},${a}`, cap.get(`${b},${a}`) + 1);
    }
    flow++;
  }
  // 残余グラフで開始から届く頂点の集合
  const seen = new Set([source]);
  const queue = [source];
  while (queue.length) {
    const a = queue.shift();
    for (const b of nbr[a]) {
      if (!seen.has(b) && cap.get(`${a},${b}`) > 0) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  const cut = [];
  for (let v = 0; v < N; v++) {
    if (v !== s && v !== g && seen.has(2 * v) && !seen.has(2 * v + 1)) cut.push(v);
  }
  return { size: flow, nodes: cut, direct: false };
}

/* ---------- エッジの編集（元の配列は変えず、新しい edges を返す） ---------- */

/** ノードに出入りするエッジ */
export function edgesOf(graph, id) {
  return {
    outgoing: graph.edges.filter(e => endpointId(e.source) === id),
    incoming: graph.edges.filter(e => endpointId(e.target) === id)
  };
}

/** weight の入力（0以上の有限の数）。不正なら null */
export function parseWeight(v) {
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function hasEdge(edges, source, target) {
  return edges.some(e => endpointId(e.source) === source && endpointId(e.target) === target);
}

/**
 * エッジを足す。bidirectional なら逆向きも足す（逆向きがすでにあれば足さない）。
 * @returns {{edges: Array, added: number, reverseSkipped: boolean, error: string|null}}
 *   error は "unknownNode" | "sameNode" | "weight" | "edgeExists" | "tooManyEdges"
 */
export function addEdge(graph, source, target, weight, { bidirectional = false } = {}) {
  const fail = error => ({ edges: graph.edges, added: 0, reverseSkipped: false, error });
  const ids = new Set(graph.nodes.map(n => n.id));
  if (!ids.has(source) || !ids.has(target)) return fail("unknownNode");
  if (source === target) return fail("sameNode");
  const w = parseWeight(weight);
  if (w === null) return fail("weight");
  if (hasEdge(graph.edges, source, target)) return fail("edgeExists");
  const edges = [...graph.edges, { source, target, weight: w }];
  let reverseSkipped = false;
  if (bidirectional) {
    if (hasEdge(graph.edges, target, source)) reverseSkipped = true;
    else edges.push({ source: target, target: source, weight: w });
  }
  if (edges.length > LIMITS.maxEdges) return fail("tooManyEdges");
  return { edges, added: edges.length - graph.edges.length, reverseSkipped, error: null };
}

/** エッジの weight を変える。@returns {{edges: Array, error: string|null}}（error は "weight" | "noEdge"） */
export function updateEdgeWeight(graph, source, target, weight) {
  const w = parseWeight(weight);
  if (w === null) return { edges: graph.edges, error: "weight" };
  if (!hasEdge(graph.edges, source, target)) return { edges: graph.edges, error: "noEdge" };
  const edges = graph.edges.map(e =>
    endpointId(e.source) === source && endpointId(e.target) === target ? { source, target, weight: w } : e);
  return { edges, error: null };
}

/** エッジを消す */
export function removeEdge(graph, source, target) {
  return graph.edges.filter(e => !(endpointId(e.source) === source && endpointId(e.target) === target));
}

/* ---------- 表示 ---------- */

/** 確率を百分率で。10%以上は小数1桁、それ未満は有効数字3桁、0.001%未満は指数表記 */
export function formatPercent(p) {
  if (!(p > 0)) return "0%";
  const x = p * 100;
  if (x >= 10) return `${x.toFixed(1)}%`;
  if (x >= 0.001) return `${x.toPrecision(3)}%`;
  return `${x.toExponential(2)}%`;
}

/** 0〜1 の値を有効数字3桁で（0.0001未満は指数表記） */
export function formatScore(v) {
  if (!(v > 0)) return "0";
  if (v >= 0.0001) return v.toPrecision(3);
  return v.toExponential(2);
}

export function formatCost(c) {
  return Number.isFinite(c) ? c.toFixed(2) : "-";
}

/* ---------- 言語 ---------- */

/** 初期言語。?lang= → 保存した選択 → ブラウザーの言語（日本語以外は英語） */
export function resolveLocale({ query = "", saved = null, languages = [] } = {}) {
  const fromQuery = new URLSearchParams(query).get("lang");
  if (fromQuery === "ja" || fromQuery === "en") return fromQuery;
  if (saved === "ja" || saved === "en") return saved;
  const first = (languages && languages[0]) || "";
  if (!first) return "ja";
  return String(first).toLowerCase().startsWith("ja") ? "ja" : "en";
}
