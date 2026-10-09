/* Day083 - Intrusion Path Mapper（画面の処理）
   - D3.js の force レイアウトでマップを描く（D3 は vendor/ に自己ホスト）
   - 計算（検証・正規化・Yen の K 最短経路・指標）は ipm-core.js、文言は ipm-messages.js
   - 成功確率の高い順／コストの低い順で経路を並べ、ハイライトとアニメーションで見せる
   - マップの編集、JSON のインポート／エクスポート
*/

import * as core from "./ipm-core.js";
import { MESSAGES } from "./ipm-messages.js";

const svg = d3.select("#graph");
const canvasWrap = document.querySelector(".canvas-wrap");
const width = () => svg.node().clientWidth;
const height = () => svg.node().clientHeight;

let data = null;            // {meta, nodes:[{id,label,label_en?,type,vuln,importance,color?}], edges:[{source,target,weight}], attack_goals}
let sim = null;
let linkSel = null;
let nodeSel = null;
let locale = "ja";

// UI elements
const presetSelect = document.getElementById("presetSelect");
const loadPresetBtn = document.getElementById("loadPresetBtn");
const startSelect = document.getElementById("startSelect");
const goalSelect  = document.getElementById("goalSelect");
const rankModeSelect = document.getElementById("rankMode");
const analyzeBtn  = document.getElementById("analyzeBtn");
const nodePenaltyInput = document.getElementById("nodePenalty");
const kPathsInput = document.getElementById("kPaths");
const pathsListEl = document.getElementById("pathsList");
const resultsSummaryEl = document.getElementById("resultsSummary");
const nodeInfoEl  = document.getElementById("nodeInfo");
const exportBtn   = document.getElementById("exportBtn");
const fileInput   = document.getElementById("fileInput");
const nodePopup   = document.getElementById("nodePopup");
const statusMsg   = document.getElementById("statusMsg");

// 通知UI
const presetNotification = document.getElementById("presetNotification");
const presetNotificationTitle = document.getElementById("presetNotificationTitle");
const presetNotificationDetail = document.getElementById("presetNotificationDetail");
const presetNotificationClose = document.getElementById("presetNotificationClose");

// 編集UI要素
const addNodeBtn = document.getElementById("addNodeBtn");
const addEdgeBtn = document.getElementById("addEdgeBtn");
const nodeEditPanel = document.getElementById("nodeEditPanel");
const editNodeBtn = document.getElementById("editNodeBtn");
const deleteNodeBtn = document.getElementById("deleteNodeBtn");

const nodeDialog = document.getElementById("nodeDialog");
const nodeDialogTitle = document.getElementById("nodeDialogTitle");
const nodeDialogError = document.getElementById("nodeDialogError");
const nodeDialogId = document.getElementById("nodeDialogId");
const nodeDialogLabel = document.getElementById("nodeDialogLabel");
const nodeDialogType = document.getElementById("nodeDialogType");
const nodeDialogVuln = document.getElementById("nodeDialogVuln");
const nodeDialogImportance = document.getElementById("nodeDialogImportance");
const nodeDialogColor = document.getElementById("nodeDialogColor");
const nodeDialogColorAuto = document.getElementById("nodeDialogColorAuto");
const nodeDialogColorReset = document.getElementById("nodeDialogColorReset");
const nodeDialogSave = document.getElementById("nodeDialogSave");
const nodeDialogCancel = document.getElementById("nodeDialogCancel");

const edgeDialog = document.getElementById("edgeDialog");
const edgeDialogError = document.getElementById("edgeDialogError");
const edgeDialogSource = document.getElementById("edgeDialogSource");
const edgeDialogTarget = document.getElementById("edgeDialogTarget");
const edgeDialogWeight = document.getElementById("edgeDialogWeight");
const edgeDialogSave = document.getElementById("edgeDialogSave");
const edgeDialogCancel = document.getElementById("edgeDialogCancel");

let currentPaths = []; // 探索の結果（findPaths の戻り値）
let currentMode = "prob"; // 結果を出したときの並べ方
let selectedPathIndex = 0; // 現在選択されている経路のインデックス
let selectedNode = null; // 現在選択されているノード
let editMode = null; // 'add' or 'edit'
let notificationTimer = null;

/* ---------- 文言 ---------- */

function t(key, params = {}) {
  const dict = MESSAGES[locale] || MESSAGES.ja;
  const s = dict[key] ?? MESSAGES.ja[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

function labelOf(n) {
  return core.nodeLabel(n, locale);
}

function graphErrorText(err) {
  if (err instanceof core.GraphError) return t(`graph.${err.code}`, err.params);
  return String(err && err.message ? err.message : err);
}

/** サイドバー上部の知らせ（kind: "info" | "error"）。空文字で消す */
function showStatus(text, kind = "info") {
  statusMsg.textContent = text;
  statusMsg.classList.toggle("is-error", kind === "error");
  statusMsg.hidden = !text;
}

/* ---------- 読み込み ---------- */

function fallbackGraph() {
  return core.normalizeGraph({
    meta: { title: t("fallback.title") },
    nodes: [
      { id: "ext", label: MESSAGES.ja["fallback.ext"], label_en: "Outside", type: "gateway", vuln: 1, importance: 0.1 },
      { id: "pc1", label: MESSAGES.ja["fallback.pc"], label_en: "Employee PC", type: "device", vuln: 0.6, importance: 0.4 },
      { id: "srv1", label: MESSAGES.ja["fallback.srv"], label_en: "File server", type: "server", vuln: 0.5, importance: 0.9 }
    ],
    edges: [
      { source: "ext", target: "pc1", weight: 1.0 },
      { source: "pc1", target: "srv1", weight: 1.2 }
    ],
    attack_goals: ["srv1"]
  }).graph;
}

/** 新しいマップに差し替える。開始・目標は既定に戻し、結果と選択を消す */
function setGraph(graph) {
  data = graph;
  selectedNode = null;
  buildUIOptions(data.nodes, { keepSelection: false });
  renderNodeInfo(null);
  drawGraph(data);
  resetResults();
}

async function loadSample(name) {
  const r = await fetch(`./sample-data/${name}.json`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return core.normalizeGraph(await r.json()).graph;
}

/* ---------- Helpers ---------- */

function buildUIOptions(nodes, { keepSelection = true } = {}) {
  const prevStart = startSelect.value;
  const prevGoal = goalSelect.value;
  startSelect.replaceChildren();
  goalSelect.replaceChildren();
  edgeDialogSource.replaceChildren();
  edgeDialogTarget.replaceChildren();

  nodes.forEach(n => {
    for (const sel of [startSelect, goalSelect, edgeDialogSource, edgeDialogTarget]) {
      const o = document.createElement("option");
      o.value = n.id;
      o.textContent = `${labelOf(n)} (${n.id})`;
      sel.appendChild(o);
    }
  });

  const ids = new Set(nodes.map(n => n.id));
  const def = core.defaultEndpoints(data);
  startSelect.value = keepSelection && ids.has(prevStart) ? prevStart : (def.start ?? "");
  goalSelect.value = keepSelection && ids.has(prevGoal) ? prevGoal : (def.goal ?? "");
}

function nodeRadius(d) {
  return 10 + d.importance * 10;
}

function drawGraph(graphData) {
  stopAnimation();
  if (sim) sim.stop();
  svg.selectAll("*").remove();
  hidePopup();

  // 矢印は線の太さに比例させず一定の大きさにする（強調した経路は色だけ変える。CSS の marker-end で切り替え）
  const defs = svg.append("defs");
  for (const [id, fill] of [["arrow", "#8aa0b6"], ["arrow-hi", "#a3ffa8"]]) {
    defs.append("marker")
      .attr("id", id)
      .attr("viewBox","0 -5 10 10")
      .attr("refX",10).attr("refY",0)
      .attr("markerUnits","userSpaceOnUse")
      .attr("markerWidth",10).attr("markerHeight",10)
      .attr("orient","auto")
      .append("path").attr("d","M0,-5L10,0L0,5").attr("fill", fill);
  }

  // D3 は source/target をノードのオブジェクトに置き換えるので、描画用の写しを渡す（data.edges は ID のまま）
  const links = graphData.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight }));

  linkSel = svg.append("g").attr("class","links")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("class","link")
    .attr("stroke","#8aa0b6")
    .attr("marker-end","url(#arrow)");

  const nodeG = svg.append("g").attr("class","nodes")
    .selectAll("g")
    .data(graphData.nodes, d => d.id)
    .enter()
    .append("g")
    .attr("class","node")
    .attr("tabindex", 0)
    .attr("role", "button")
    .attr("aria-label", d => `${labelOf(d)} (${d.id})`)
    .call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));

  nodeG.append("circle")
    .attr("r", nodeRadius)
    .attr("fill", d => core.nodeColor(d));

  nodeG.append("text")
    .attr("dy", 3)
    .attr("x", d => 12 + d.importance * 4)
    .text(d => labelOf(d));

  nodeSel = nodeG;

  nodeG.on("click", (event, d) => {
    event.stopPropagation();
    showNodeInfo(d);
  });
  nodeG.on("keydown", (event, d) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showNodeInfo(d);
    }
  });

  sim = d3.forceSimulation(graphData.nodes)
    .force("link", d3.forceLink(links).id(d=>d.id).distance(e=> 40 + Math.min(e.weight, 10)*30).strength(0.3))
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(width()/2, height()/2))
    .force("collide", d3.forceCollide().radius(d=> 12 + d.importance*12))
    .on("tick", ticked);

  function ticked() {
    // 線の終端を行き先の円の縁で止め、矢印の先端が円に隠れないようにする
    linkSel.each(function(d){
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const len = Math.hypot(dx, dy) || 1;
      const r = nodeRadius(d.target) + 2;
      d3.select(this)
        .attr("x1", d.source.x)
        .attr("y1", d.source.y)
        .attr("x2", d.target.x - dx / len * r)
        .attr("y2", d.target.y - dy / len * r);
    });

    nodeSel.attr("transform", d=>`translate(${d.x},${d.y})`);
  }
}

// 画面の大きさが変わったら中心を合わせ直す（リスナーは1つだけ）
window.addEventListener("resize", ()=> {
  if (sim) sim.force("center", d3.forceCenter(width()/2, height()/2)).alpha(0.3).restart();
});

function dragstarted(event,d){
  if (!event.active) sim.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}
function dragged(event,d){
  d.fx = event.x; d.fy = event.y;
}
function dragended(event,d){
  if (!event.active) sim.alphaTarget(0);
  d.fx = null; d.fy = null;
}

function kv(title, value) {
  const row = document.createElement("div");
  row.className = "kv";
  const k = document.createElement("div");
  k.className = "title";
  k.textContent = title;
  const v = document.createElement("div");
  v.textContent = value;
  row.append(k, v);
  return row;
}

function renderNodeInfo(n) {
  nodeInfoEl.replaceChildren();
  nodeEditPanel.hidden = !n;
  if (!n) {
    nodeInfoEl.textContent = t("info.empty");
    return;
  }
  nodeInfoEl.append(
    kv(t("info.id"), n.id),
    kv(t("info.label"), n.label)
  );
  if (n.label_en) nodeInfoEl.append(kv(t("info.labelEn"), n.label_en));
  nodeInfoEl.append(
    kv(t("info.type"), n.type || "-"),
    kv(t("info.vuln"), String(n.vuln)),
    kv(t("info.importance"), String(n.importance))
  );

  const actions = document.createElement("div");
  actions.className = "node-info-actions";
  const toStart = document.createElement("button");
  toStart.type = "button";
  toStart.className = "small-btn";
  toStart.textContent = t("info.setStart");
  toStart.addEventListener("click", () => { startSelect.value = n.id; });
  const toGoal = document.createElement("button");
  toGoal.type = "button";
  toGoal.className = "small-btn";
  toGoal.textContent = t("info.setGoal");
  toGoal.addEventListener("click", () => { goalSelect.value = n.id; });
  actions.append(toStart, toGoal);
  nodeInfoEl.append(actions);
}

function popupRow(label, value) {
  const row = document.createElement("div");
  row.className = "popup-row";
  const l = document.createElement("span");
  l.className = "popup-label";
  l.textContent = `${label}:`;
  const v = document.createElement("span");
  v.textContent = value;
  row.append(l, " ", v);
  return row;
}

function showNodeInfo(n){
  selectedNode = n;

  // サイドバーにも表示
  renderNodeInfo(n);

  // ポップアップを表示（中身は textContent で組み立てる）
  const header = document.createElement("div");
  header.className = "popup-header";
  header.textContent = labelOf(n);
  nodePopup.replaceChildren(
    header,
    popupRow(t("info.id"), n.id),
    popupRow(t("info.type"), n.type || "-"),
    popupRow(t("info.vuln"), String(n.vuln)),
    popupRow(t("info.importance"), String(n.importance))
  );
  nodePopup.hidden = false;

  // ノードの右側に置き、キャンバスの外へはみ出さないように寄せる
  const wrapW = canvasWrap.clientWidth;
  const wrapH = canvasWrap.clientHeight;
  const pw = nodePopup.offsetWidth;
  const ph = nodePopup.offsetHeight;
  let x = n.x + nodeRadius(n) + 10;
  if (x + pw > wrapW - 8) x = n.x - nodeRadius(n) - 10 - pw;
  x = core.clamp(x, 8, Math.max(8, wrapW - pw - 8));
  const y = core.clamp(n.y - 30, 8, Math.max(8, wrapH - ph - 8));
  nodePopup.style.left = `${x}px`;
  nodePopup.style.top = `${y}px`;
}

function hidePopup() {
  nodePopup.hidden = true;
}

// ポップアップを閉じる処理
svg.on("click", function(event) {
  if (event.target === svg.node()) hidePopup();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !nodePopup.hidden) hidePopup();
});

/* ---------- 探索 ---------- */

function updateModeFields() {
  // ノード難易度の重みはコスト順でだけ使う
  nodePenaltyInput.disabled = rankModeSelect.value !== "cost";
}

analyzeBtn.addEventListener("click", ()=>{
  if (!data) return;
  const sId = startSelect.value;
  const gId = goalSelect.value;
  if (!sId || !gId || sId === gId) {
    showStatus(t("err.selectEndpoints"), "error");
    return;
  }
  showStatus("");
  const nodePenalty = core.sanitizePenalty(nodePenaltyInput.value);
  const k = core.sanitizeK(kPathsInput.value);
  nodePenaltyInput.value = String(nodePenalty);
  kPathsInput.value = String(k);

  currentMode = rankModeSelect.value === "cost" ? "cost" : "prob";
  currentPaths = core.findPaths(data, sId, gId, { mode: currentMode, k, nodePenalty });
  selectedPathIndex = 0;
  stopAnimation();
  renderKPathsResult();
  revealResults();
});

/** 広い画面（サイドバーだけがスクロールする）では、結果が隠れていればサイドバーを送る */
function revealResults() {
  const sidebar = document.querySelector(".sidebar");
  const results = document.getElementById("results");
  if (getComputedStyle(sidebar).overflowY !== "auto") return; // 狭い画面ではページを動かさない
  const top = results.offsetTop;
  if (top + 120 > sidebar.scrollTop + sidebar.clientHeight) {
    sidebar.scrollTo({ top: Math.max(0, top - 8) });
  }
}

rankModeSelect.addEventListener("change", updateModeFields);

exportBtn.addEventListener("click", ()=>{
  if (!data) return;
  const json = JSON.stringify(core.serializeGraph(data), null, 2) + "\n";
  const blob = new Blob([json], {type: "application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = core.exportFileName(data.meta);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

fileInput.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;

  try{
    // ファイルサイズ制限（5MB）
    if (f.size > core.LIMITS.maxFileBytes) {
      throw new core.GraphError("fileTooLarge", { mb: core.LIMITS.maxFileBytes / 1024 / 1024 });
    }
    const { graph, warnings } = core.parseGraphText(await f.text());
    setGraph(graph);
    const title = graph.meta.title || f.name;
    if (warnings.length) {
      const list = [...new Set(warnings.map(w => t(`warn.${w.code}`)))].join("、");
      showStatus(t("warn.summary", { title, count: warnings.length, list }));
    } else {
      showStatus("");
    }
    showPresetNotification(title, graph.nodes.length, graph.edges.length);
  }catch(err){
    showStatus(t("err.importFailed", { reason: graphErrorText(err) }), "error");
  }finally{
    fileInput.value = "";
  }
});

/* ---------- Render K paths results ---------- */

function emptyState() {
  const box = document.createElement("div");
  box.className = "empty-state";
  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.textContent = "🔍";
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("div");
  text.className = "empty-text";
  text.textContent = t("results.emptyTitle");
  const hint = document.createElement("div");
  hint.className = "empty-hint";
  hint.textContent = t("results.emptyHint");
  box.append(icon, text, hint);
  return box;
}

/** 結果を消す（マップが変わったときは必ず呼ぶ。古い経路の添字は新しいマップと合わない） */
function resetResults() {
  stopAnimation();
  currentPaths = [];
  selectedPathIndex = 0;
  pathsListEl.replaceChildren(emptyState());
  resultsSummaryEl.textContent = "";
  clearHighlight();
}

function metric(label, value, cls) {
  const m = document.createElement("span");
  m.className = "metric";
  const l = document.createElement("span");
  l.className = "metric-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = `metric-value ${cls}`;
  v.textContent = value;
  m.append(l, v);
  return m;
}

function renderKPathsResult(){
  const nodes = data.nodes;
  clearHighlight();

  if (!currentPaths.length){
    const none = document.createElement("div");
    none.className = "no-path";
    none.textContent = currentMode === "prob" ? t("results.noneProb") : t("results.none");
    pathsListEl.replaceChildren(none);
    resultsSummaryEl.textContent = none.textContent;
    return;
  }

  // 複数経路を表示
  pathsListEl.replaceChildren();
  currentPaths.forEach((p, index) => {
    const item = document.createElement("div");
    item.className = "path-item" + (index === selectedPathIndex ? " selected" : "");
    item.dataset.rank = String(index); // ランクに応じた色分け用

    const select = document.createElement("button");
    select.type = "button";
    select.className = "path-select";
    select.setAttribute("aria-pressed", String(index === selectedPathIndex));

    const header = document.createElement("span");
    header.className = "path-header";
    const rank = document.createElement("span");
    rank.className = "path-rank";
    rank.textContent = `#${index + 1}`;
    const hops = document.createElement("span");
    hops.className = "path-hops";
    hops.textContent = t("results.hops", { n: p.hops });
    header.append(rank, hops);

    const metrics = document.createElement("span");
    metrics.className = "path-metrics";
    metrics.append(
      metric(t("results.prob"), core.formatPercent(p.successProb), "success-prob"),
      metric(t("results.risk"), core.formatScore(p.risk), "risk-index"),
      metric(t("results.cost"), core.formatCost(p.cost), "cost-value")
    );

    const route = document.createElement("span");
    route.className = "path-route";
    route.textContent = p.path.map(i => labelOf(nodes[i])).join(" → ");
    route.title = p.path.map(i => nodes[i].id).join(" → ");

    select.append(header, metrics, route);
    select.addEventListener("click", () => {
      stopAnimation();
      selectedPathIndex = index;
      renderKPathsResult();
    });

    // アニメーション再生ボタン
    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "play-btn";
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", t("results.play", { n: index + 1 }));
    playBtn.title = t("results.play", { n: index + 1 });
    playBtn.addEventListener("click", () => animatePath(index));

    item.append(select, playBtn);
    pathsListEl.appendChild(item);
  });

  resultsSummaryEl.textContent = t("results.summary", { count: currentPaths.length, mode: t(`mode.${currentMode}`) });

  // 選択された経路をハイライト
  if (selectedPathIndex < currentPaths.length){
    highlightPath(currentPaths[selectedPathIndex].path);
  }
}

/** 経路（ノードの添字の列）を ID の組の集合にする */
function pathEdgeKeys(path) {
  const keys = new Set();
  for (let i = 0; i < path.length - 1; i++) {
    keys.add(`${data.nodes[path[i]].id}>${data.nodes[path[i + 1]].id}`);
  }
  return keys;
}

function linkKey(e) {
  return `${core.endpointId(e.source)}>${core.endpointId(e.target)}`;
}

function clearHighlight() {
  if (!linkSel || !nodeSel) return;
  linkSel.classed("highlight", false).classed("pulse", false).classed("animate-edge", false)
    .classed("animate-current-edge", false).classed("animate-future-edge", false).classed("animate-dim", false);
  nodeSel.classed("node-highlight", false).classed("animate-node", false).classed("animate-current", false)
    .classed("animate-future", false).classed("animate-dim", false);
}

function highlightPath(path){
  clearHighlight();
  if (!path || path.length < 2) return;

  // パスのエッジを強調
  const keys = pathEdgeKeys(path);
  linkSel.each(function(e){
    const hit = keys.has(linkKey(e));
    d3.select(this).classed("highlight", hit).classed("pulse", hit);
  });

  // ノードもハイライト
  const nodeSet = new Set(path.map(i => data.nodes[i].id));
  nodeSel.each(function(n){
    d3.select(this).classed("node-highlight", nodeSet.has(n.id));
  });
}

// アニメーション再生
let currentAnimation = null;

function stopAnimation() {
  if (currentAnimation){
    clearTimeout(currentAnimation);
    currentAnimation = null;
  }
}

function animatePath(pathIndex){
  // 経路を選択状態にする（既存のアニメーションもここで止まる）
  stopAnimation();
  selectedPathIndex = pathIndex;
  renderKPathsResult();
  clearHighlight();

  const path = currentPaths[pathIndex]?.path;
  if (!path || path.length < 2) return;
  const ids = path.map(i => data.nodes[i].id);
  const inPath = new Set(ids);
  const allKeys = pathEdgeKeys(path);
  let step = 0;

  function animateStep(){
    if (step >= ids.length){
      // アニメーション完了 - 全経路を最終状態で表示
      nodeSel.each(function(n){
        d3.select(this)
          .classed("animate-current", false)
          .classed("animate-future", false)
          .classed("animate-node", inPath.has(n.id))
          .classed("animate-dim", !inPath.has(n.id)); // 経路外を暗くする
      });
      linkSel.each(function(e){
        const hit = allKeys.has(linkKey(e));
        d3.select(this)
          .classed("animate-edge", hit)
          .classed("animate-current-edge", false)
          .classed("animate-future-edge", false)
          .classed("pulse", false)
          .classed("animate-dim", !hit); // 経路外を暗くする
      });
      currentAnimation = null;
      return;
    }

    const past = new Set(ids.slice(0, step));
    const current = ids[step];
    const pastKeys = new Set();
    for (let i = 1; i < step; i++) pastKeys.add(`${ids[i - 1]}>${ids[i]}`);
    const currentKey = step > 0 ? `${ids[step - 1]}>${current}` : null;

    // すべてのノードの状態を更新
    nodeSel.each(function(n){
      const isCurrent = n.id === current;
      const isPast = past.has(n.id);
      d3.select(this)
        .classed("animate-current", isCurrent)
        .classed("animate-node", isPast && !isCurrent)
        .classed("animate-future", inPath.has(n.id) && !isCurrent && !isPast)
        .classed("animate-dim", !inPath.has(n.id)); // 経路外のノードを暗く
    });

    // すべてのエッジの状態を更新
    linkSel.each(function(e){
      const key = linkKey(e);
      const isCurrentEdge = key === currentKey;
      const isPastEdge = pastKeys.has(key);
      const isFutureEdge = allKeys.has(key) && !isCurrentEdge && !isPastEdge;
      d3.select(this)
        .classed("animate-edge", isPastEdge)
        .classed("animate-current-edge", isCurrentEdge)
        .classed("animate-future-edge", isFutureEdge)
        .classed("pulse", isCurrentEdge)
        .classed("animate-dim", !allKeys.has(key)); // 経路外のエッジを暗く
    });

    step++;
    currentAnimation = setTimeout(animateStep, 1000); // 1000msごとに次のステップ
  }

  // アニメーション開始
  animateStep();
}

/* ---------- 編集機能 ---------- */

/** マップを書き換えたあとの共通処理。開始・目標の選択は残し、結果は消す */
function afterEdit() {
  buildUIOptions(data.nodes, { keepSelection: true });
  drawGraph(data);
  resetResults();
}

function setTypeOptions(type) {
  // 選択肢にない種類（インポートしたファイルの独自の種類）は一時的に足して、保存で空にならないようにする
  nodeDialogType.querySelectorAll("option[data-extra]").forEach(o => o.remove());
  if (!core.NODE_TYPES.includes(type)) {
    const o = document.createElement("option");
    o.value = type;
    o.textContent = type;
    o.dataset.extra = "1";
    nodeDialogType.appendChild(o);
  }
  nodeDialogType.value = type;
}

function setColorAuto(auto) {
  nodeDialogColorAuto.checked = auto;
  if (auto) nodeDialogColor.value = core.typeColor(nodeDialogType.value);
}

function openDialog(dlg, errEl) {
  errEl.textContent = "";
  errEl.hidden = true;
  dlg.showModal();
}

function dialogError(errEl, text) {
  errEl.textContent = text;
  errEl.hidden = false;
}

// ノード追加ボタン
addNodeBtn.addEventListener('click', () => {
  if (!data) return;
  editMode = 'add';
  nodeDialogTitle.textContent = t("dialog.addTitle");
  nodeDialogId.value = core.nextNodeId(data.nodes);
  nodeDialogLabel.value = '';
  setTypeOptions('node');
  nodeDialogVuln.value = 0.5;
  nodeDialogImportance.value = 0.5;
  setColorAuto(true);
  nodeDialogId.disabled = false;
  openDialog(nodeDialog, nodeDialogError);
});

// ノード編集ボタン
editNodeBtn.addEventListener('click', () => {
  if (!selectedNode) return;
  editMode = 'edit';
  nodeDialogTitle.textContent = t("dialog.editTitle");
  nodeDialogId.value = selectedNode.id;
  nodeDialogLabel.value = selectedNode.label;
  setTypeOptions(selectedNode.type);
  nodeDialogVuln.value = selectedNode.vuln;
  nodeDialogImportance.value = selectedNode.importance;
  setColorAuto(!selectedNode.color);
  if (selectedNode.color) nodeDialogColor.value = selectedNode.color;
  nodeDialogId.disabled = true;
  openDialog(nodeDialog, nodeDialogError);
});

// ノード削除ボタン
deleteNodeBtn.addEventListener('click', () => {
  if (!selectedNode) return;
  if (!confirm(t("confirm.deleteNode", { label: labelOf(selectedNode) }))) return;

  const id = selectedNode.id;
  data.nodes = data.nodes.filter(n => n.id !== id);
  // 関連するエッジと攻撃目標からも外す
  data.edges = data.edges.filter(e => e.source !== id && e.target !== id);
  data.attack_goals = (data.attack_goals || []).filter(g => g !== id);

  selectedNode = null;
  renderNodeInfo(null);
  afterEdit();
});

// ノードダイアログ保存
nodeDialogSave.addEventListener('click', () => {
  const id = nodeDialogId.value.trim();
  const label = nodeDialogLabel.value.trim() || id;
  const type = nodeDialogType.value || 'node';
  const vuln = core.toUnit(nodeDialogVuln.value, 0.5);
  const importance = core.toUnit(nodeDialogImportance.value, 0.5);
  const auto = nodeDialogColorAuto.checked;
  const color = nodeDialogColor.value;

  // 入力バリデーション（インポートと同じ規則）
  if (editMode === 'add' && !core.ID_PATTERN.test(id)) {
    dialogError(nodeDialogError, t("err.idPattern"));
    return;
  }
  if (label.length > core.LIMITS.maxLabelLength) {
    dialogError(nodeDialogError, t("err.labelTooLong"));
    return;
  }

  if (editMode === 'add') {
    // ID重複チェック
    if (data.nodes.some(n => n.id === id)) {
      dialogError(nodeDialogError, t("err.idExists"));
      return;
    }
    const newNode = {id, label, type, vuln, importance};
    if (!auto && core.COLOR_PATTERN.test(color)) newNode.color = color.toLowerCase();
    data.nodes.push(newNode);
  } else if (editMode === 'edit' && selectedNode) {
    // 既存ノードを更新
    const node = data.nodes.find(n => n.id === selectedNode.id);
    if (node) {
      if (label !== node.label) delete node.label_en; // 日本語のラベルを変えたら古い英語ラベルは外す
      node.label = label;
      node.type = type;
      node.vuln = vuln;
      node.importance = importance;
      if (!auto && core.COLOR_PATTERN.test(color)) {
        node.color = color.toLowerCase();
      } else {
        delete node.color; // 種類に応じた自動の色に戻す
      }
      selectedNode = node;
    }
  }

  nodeDialog.close();
  renderNodeInfo(selectedNode);
  afterEdit();
});

// ノードダイアログキャンセル
nodeDialogCancel.addEventListener('click', () => nodeDialog.close());

// 色: 自動にする／色を選んだら自動を外す
nodeDialogColorReset.addEventListener('click', () => setColorAuto(true));
nodeDialogColorAuto.addEventListener('change', () => setColorAuto(nodeDialogColorAuto.checked));
nodeDialogColor.addEventListener('input', () => { nodeDialogColorAuto.checked = false; });
nodeDialogType.addEventListener('change', () => {
  if (nodeDialogColorAuto.checked) nodeDialogColor.value = core.typeColor(nodeDialogType.value);
});

// エッジ追加ボタン
addEdgeBtn.addEventListener('click', () => {
  if (!data || data.nodes.length < 2) {
    showStatus(t("err.needTwoNodes"), "error");
    return;
  }
  edgeDialogSource.value = startSelect.value || data.nodes[0].id;
  edgeDialogTarget.value = data.nodes.find(n => n.id !== edgeDialogSource.value).id;
  edgeDialogWeight.value = 1.0;
  openDialog(edgeDialog, edgeDialogError);
});

// エッジダイアログ保存
edgeDialogSave.addEventListener('click', () => {
  const source = edgeDialogSource.value;
  const target = edgeDialogTarget.value;
  const raw = edgeDialogWeight.value.trim();
  const weight = raw === "" ? NaN : Number(raw);

  if (source === target) {
    dialogError(edgeDialogError, t("err.sameNode"));
    return;
  }
  if (data.edges.some(e => e.source === source && e.target === target)) {
    dialogError(edgeDialogError, t("err.edgeExists"));
    return;
  }
  if (!Number.isFinite(weight) || weight < 0) {
    dialogError(edgeDialogError, t("err.weight"));
    return;
  }

  // エッジ追加
  data.edges.push({source, target, weight});

  edgeDialog.close();
  afterEdit();
});

// エッジダイアログキャンセル
edgeDialogCancel.addEventListener('click', () => edgeDialog.close());

// ダイアログ外（背景）クリックで閉じる
for (const dlg of [nodeDialog, edgeDialog]) {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

// プリセット読込ボタン
loadPresetBtn.addEventListener('click', async () => {
  const preset = presetSelect.value;
  if (!preset) {
    showStatus(t("err.selectPreset"), "error");
    return;
  }

  try {
    const graph = await loadSample(preset);
    setGraph(graph);
    showStatus("");
    // 通知を表示
    showPresetNotification(graph.meta.title || preset, graph.nodes.length, graph.edges.length);
  } catch {
    showStatus(t("err.presetLoad"), "error");
  }
});

// 読み込みの通知を表示
function showPresetNotification(title, nodeCount, edgeCount) {
  presetNotificationTitle.textContent = t("notify.loaded");
  const strong = document.createElement("strong");
  strong.textContent = title;
  presetNotificationDetail.replaceChildren(strong, document.createElement("br"),
    t("notify.detail", { nodes: nodeCount, edges: edgeCount }));

  presetNotification.classList.remove('hiding');
  presetNotification.hidden = false;

  // 3秒後に自動で閉じる
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(hidePresetNotification, 3000);
}

// 通知を閉じる
function hidePresetNotification() {
  clearTimeout(notificationTimer);
  presetNotification.classList.add('hiding');
  notificationTimer = setTimeout(() => {
    presetNotification.hidden = true;
    presetNotification.classList.remove('hiding');
  }, 300);
}

// 通知の閉じるボタン
presetNotificationClose.addEventListener('click', hidePresetNotification);

/* ---------- 起動 ---------- */

updateModeFields();
loadSample("sample-facility")
  .then(setGraph)
  .catch(() => {
    // サンプルを読めないとき（オフラインなど）は最小のマップで動かす
    setGraph(fallbackGraph());
  });
