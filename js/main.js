/* Day083 - AI Attack Path Finder (MVP)
   - D3.js force layout
   - Dijkstra shortest path
   - JSON import/export
   - Path highlight + simple scoring
*/

const svg = d3.select("#graph");
const width = () => svg.node().clientWidth;
const height = () => svg.node().clientHeight;

let data = null;            // {meta, nodes:[{id,label,type,vuln,importance}], edges:[{source,target,weight}]}
let sim = null;
let linkSel = null;
let nodeSel = null;

// UI elements
const presetSelect = document.getElementById("presetSelect");
const loadPresetBtn = document.getElementById("loadPresetBtn");
const startSelect = document.getElementById("startSelect");
const goalSelect  = document.getElementById("goalSelect");
const analyzeBtn  = document.getElementById("analyzeBtn");
const nodePenaltyInput = document.getElementById("nodePenalty");
const kPathsInput = document.getElementById("kPaths");
const pathsListEl = document.getElementById("pathsList");
const nodeInfoEl  = document.getElementById("nodeInfo");
const exportBtn   = document.getElementById("exportBtn");
const fileInput   = document.getElementById("fileInput");
const nodePopup   = document.getElementById("nodePopup");

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
const nodeDialogId = document.getElementById("nodeDialogId");
const nodeDialogLabel = document.getElementById("nodeDialogLabel");
const nodeDialogType = document.getElementById("nodeDialogType");
const nodeDialogVuln = document.getElementById("nodeDialogVuln");
const nodeDialogImportance = document.getElementById("nodeDialogImportance");
const nodeDialogColor = document.getElementById("nodeDialogColor");
const nodeDialogColorReset = document.getElementById("nodeDialogColorReset");
const nodeDialogSave = document.getElementById("nodeDialogSave");
const nodeDialogCancel = document.getElementById("nodeDialogCancel");

const edgeDialog = document.getElementById("edgeDialog");
const edgeDialogSource = document.getElementById("edgeDialogSource");
const edgeDialogTarget = document.getElementById("edgeDialogTarget");
const edgeDialogWeight = document.getElementById("edgeDialogWeight");
const edgeDialogSave = document.getElementById("edgeDialogSave");
const edgeDialogCancel = document.getElementById("edgeDialogCancel");

let currentPaths = []; // K最短経路の結果を保存
let selectedPathIndex = 0; // 現在選択されている経路のインデックス
let selectedNode = null; // 現在選択されているノード
let editMode = null; // 'add' or 'edit'

// Load default sample
fetch("./sample-data/sample-facility.json")
  .then(r => r.json())
  .then(json => {
    data = normalizeData(json);
    buildUIOptions(data.nodes);
    drawGraph(data);
  })
  .catch(() => {
    // Fallback minimal graph if sample missing
    data = {
      nodes: [
        {id:"ext", label:"外部", type:"gateway", vuln:0.3, importance:0.1},
        {id:"pc1", label:"社員PC", type:"device", vuln:0.6, importance:0.4},
        {id:"srv1", label:"ファイルサーバー", type:"server", vuln:0.5, importance:0.9}
      ],
      edges: [
        {source:"ext", target:"pc1", weight:1.0},
        {source:"pc1", target:"srv1", weight:1.2}
      ],
      meta:{title:"Fallback"}
    };
    buildUIOptions(data.nodes);
    drawGraph(data);
  });

/* ---------- Helpers ---------- */

function normalizeData(json) {
  const nmap = new Map();
  const nodes = (json.nodes || []).map(n => {
    const node = {
      id: String(n.id),
      label: n.label ?? n.id,
      type: n.type ?? "node",
      vuln: clamp(Number(n.vuln ?? 0.5), 0, 1),
      importance: clamp(Number(n.importance ?? 0.5), 0, 1)
    };
    if (n.color) node.color = n.color;
    nmap.set(node.id, node);
    return node;
  });

  const edges = (json.edges || []).map(e => {
    return {
      source: String(e.source),
      target: String(e.target),
      weight: Number(e.weight ?? 1.0)
    };
  }).filter(e => nmap.has(e.source) && nmap.has(e.target));

  return { meta: json.meta || {}, nodes, edges, attack_goals: json.attack_goals || [] };
}

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

function buildUIOptions(nodes) {
  startSelect.innerHTML = "";
  goalSelect.innerHTML  = "";

  nodes.forEach(n => {
    const o1 = document.createElement("option");
    o1.value = n.id; o1.textContent = `${n.label} (${n.id})`;
    startSelect.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = n.id; o2.textContent = `${n.label} (${n.id})`;
    goalSelect.appendChild(o2);
  });

  // 初期選択（外部→重要度最大）
  const ext = nodes.find(n => /ext|outside|gateway/i.test(n.id));
  if (ext) startSelect.value = ext.id;
  const maxImp = [...nodes].sort((a,b)=>b.importance-a.importance)[0];
  if (maxImp) goalSelect.value = maxImp.id;
}

function drawGraph(graphData) {
  svg.selectAll("*").remove();

  const defs = svg.append("defs");
  defs.append("marker")
    .attr("id","arrow")
    .attr("viewBox","0 -5 10 10")
    .attr("refX",18).attr("refY",0)
    .attr("markerWidth",6).attr("markerHeight",6)
    .attr("orient","auto")
    .append("path").attr("d","M0,-5L10,0L0,5").attr("fill","#8aa0b6");

  linkSel = svg.append("g").attr("class","links")
    .selectAll("line")
    .data(graphData.edges)
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
    .call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));

  nodeG.append("circle")
    .attr("r", d => 10 + d.importance * 10)
    .attr("fill", colorByType);

  nodeG.append("text")
    .attr("dy", 3)
    .attr("x", d => 12 + d.importance * 4)
    .text(d => d.label);

  nodeSel = nodeG;

  nodeG.on("click",(_,d)=>showNodeInfo(d));

  sim = d3.forceSimulation(graphData.nodes)
    .force("link", d3.forceLink(graphData.edges).id(d=>d.id).distance(e=> 40 + e.weight*30).strength(0.3))
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(width()/2, height()/2))
    .force("collide", d3.forceCollide().radius(d=> 12 + d.importance*12))
    .on("tick", ticked);

  function ticked() {
    linkSel
      .attr("x1", d=>d.source.x)
      .attr("y1", d=>d.source.y)
      .attr("x2", d=>d.target.x)
      .attr("y2", d=>d.target.y);

    nodeSel.attr("transform", d=>`translate(${d.x},${d.y})`);
  }

  window.addEventListener("resize", ()=> {
    sim && sim.force("center", d3.forceCenter(width()/2, height()/2));
  });
}

function colorByType(d){
  // カスタム色が設定されていればそれを使用
  if (d.color) return d.color;

  // タイプに応じたデフォルト色
  const t = (d.type||"node").toLowerCase();
  if (t.includes("server")) return "#7cc7ff";
  if (t.includes("device")) return "#ffd580";
  if (t.includes("account")) return "#c3a6ff";
  if (t.includes("person")) return "#ffb3d9";
  if (t.includes("gateway") || t.includes("room")) return "#9affc3";
  return "#9fb3c8";
}

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

function showNodeInfo(n){
  selectedNode = n;

  // サイドバーにも表示
  nodeInfoEl.innerHTML = `
    <div class="kv"><div class="title">ID</div><div>${n.id}</div></div>
    <div class="kv"><div class="title">Label</div><div>${n.label}</div></div>
    <div class="kv"><div class="title">Type</div><div>${n.type||"-"}</div></div>
    <div class="kv"><div class="title">vuln</div><div>${n.vuln}</div></div>
    <div class="kv"><div class="title">importance</div><div>${n.importance}</div></div>
  `;

  // 編集パネルを表示
  nodeEditPanel.style.display = 'flex';

  // ポップアップを表示
  nodePopup.innerHTML = `
    <div class="popup-header">${n.label}</div>
    <div class="popup-row"><span class="popup-label">ID:</span> <span>${n.id}</span></div>
    <div class="popup-row"><span class="popup-label">Type:</span> <span>${n.type||"-"}</span></div>
    <div class="popup-row"><span class="popup-label">Vuln:</span> <span>${n.vuln}</span></div>
    <div class="popup-row"><span class="popup-label">Importance:</span> <span>${n.importance}</span></div>
  `;

  // ノードの座標を取得してポップアップを配置
  const svgRect = svg.node().getBoundingClientRect();
  const nodeRadius = 10 + n.importance * 10;
  const popupX = n.x + nodeRadius + 10; // ノードの右側に配置
  const popupY = n.y - 30; // ノードより少し上

  nodePopup.style.left = `${popupX}px`;
  nodePopup.style.top = `${popupY}px`;
  nodePopup.style.display = 'block';
}

// ポップアップを閉じる処理
svg.on("click", function(event) {
  if (event.target.tagName === 'svg') {
    nodePopup.style.display = 'none';
  }
});

/* ---------- Dijkstra ---------- */

// グラフを隣接リストへ
function buildAdjacency(nodes, edges, nodePenalty){
  const idx = new Map(nodes.map((n,i)=>[n.id,i]));
  const adj = new Array(nodes.length).fill(0).map(()=>[]);
  edges.forEach(e=>{
    // D3.jsがsource/targetをオブジェクトに変換するため、IDを取得
    const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
    const targetId = typeof e.target === 'object' ? e.target.id : e.target;

    const si = idx.get(sourceId), ti = idx.get(targetId);
    if (si==null || ti==null) return;
    const nCost = nodePenalty * (1 - nodes[ti].vuln); // 目標側ノード難易度を微加算
    const w = Number(e.weight ?? 1) + nCost;
    adj[si].push({to:ti, w, eid:`${sourceId}→${targetId}`});
    // 無向扱いにしたい場合はこちらも追加
    // const nCost2 = nodePenalty * (1 - nodes[si].vuln);
    // adj[ti].push({to:si, w:Number(e.weight ?? 1)+nCost2, eid:`${targetId}→${sourceId}`});
  });
  return {adj, idx};
}

function dijkstra(nodes, adj, startIdx, goalIdx, excludedEdges = new Set()){
  const N = nodes.length;
  const dist = new Array(N).fill(Infinity);
  const prev = new Array(N).fill(-1);
  dist[startIdx] = 0;

  const visited = new Array(N).fill(false);

  for (let t=0;t<N;t++){
    let u = -1, best = Infinity;
    for (let i=0;i<N;i++){
      if (!visited[i] && dist[i] < best){ best = dist[i]; u=i; }
    }
    if (u === -1) break;
    if (u === goalIdx) break;
    visited[u] = true;

    for (const {to, w} of adj[u]){
      const edgeKey = `${u}-${to}`;
      if (excludedEdges.has(edgeKey)) continue; // 除外エッジをスキップ

      const nd = dist[u] + w;
      if (nd < dist[to]){
        dist[to] = nd;
        prev[to] = u;
      }
    }
  }

  if (dist[goalIdx] === Infinity) return {cost:Infinity, path:[]};

  const pathIdx = [];
  for (let v=goalIdx; v!==-1; v=prev[v]) pathIdx.push(v);
  pathIdx.reverse();
  return {cost: dist[goalIdx], path: pathIdx};
}

// Yen's K-shortest paths algorithm
function yenKShortestPaths(nodes, adj, startIdx, goalIdx, K){
  const A = []; // K本の最短経路を格納
  const B = []; // 候補経路を格納

  // 最初の最短経路を計算
  const firstPath = dijkstra(nodes, adj, startIdx, goalIdx);
  if (firstPath.cost === Infinity) return A;
  A.push(firstPath);

  for (let k=1; k<K; k++){
    const prevPath = A[k-1];

    // 前回の経路の各ノードをスパーノードとして試す
    for (let i=0; i<prevPath.path.length-1; i++){
      const spurNode = prevPath.path[i];
      const rootPath = prevPath.path.slice(0, i+1);

      const excludedEdges = new Set();

      // 同じルートパスを持つ既存の経路からエッジを除外
      for (const p of A){
        if (p.path.length > i && arraysEqual(p.path.slice(0, i+1), rootPath)){
          if (p.path.length > i+1){
            const edgeKey = `${p.path[i]}-${p.path[i+1]}`;
            excludedEdges.add(edgeKey);
          }
        }
      }

      // ルートパス内のノードを除外（spurNode以外）
      const excludedNodes = new Set(rootPath.slice(0, -1));

      // 修正版隣接リストを作成（除外ノードからのエッジを削除）
      const modifiedAdj = adj.map((neighbors, idx) => {
        if (excludedNodes.has(idx)) return [];
        return neighbors.filter(({to}) => !excludedNodes.has(to));
      });

      // spurNodeからgoalまでの最短経路を計算
      const spurPath = dijkstra(nodes, modifiedAdj, spurNode, goalIdx, excludedEdges);

      if (spurPath.cost !== Infinity){
        // rootPathとspurPathを結合
        const totalPath = [...rootPath.slice(0, -1), ...spurPath.path];

        // コストを計算
        let totalCost = 0;
        for (let j=0; j<totalPath.length-1; j++){
          const from = totalPath[j];
          const to = totalPath[j+1];
          const edge = adj[from].find(e => e.to === to);
          if (edge) totalCost += edge.w;
        }

        const newPath = {cost: totalCost, path: totalPath};

        // 重複チェック
        if (!B.some(p => arraysEqual(p.path, newPath.path))){
          B.push(newPath);
        }
      }
    }

    if (B.length === 0) break;

    // Bの中から最小コストの経路を選択
    B.sort((a, b) => a.cost - b.cost);
    A.push(B.shift());
  }

  return A;
}

function arraysEqual(a, b){
  if (a.length !== b.length) return false;
  for (let i=0; i<a.length; i++){
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// 経路の成功確率とリスク指標を計算
function calculatePathMetrics(pathResult, nodes){
  if (!pathResult || !pathResult.path || pathResult.path.length === 0){
    return {successProb: 0, riskIndex: 0, avgVuln: 0, maxImportance: 0};
  }

  // 経路上の各ノードの脆弱性を取得
  const pathNodes = pathResult.path.map(idx => nodes[idx]);

  // デバッグ情報
  console.log('=== Path Metrics Calculation ===');
  console.log('Path indices:', pathResult.path);
  console.log('Path nodes:', pathNodes.map(n => ({id: n.id, vuln: n.vuln, importance: n.importance})));

  // 成功確率 = 各ノードの脆弱性の積（各ステップで成功する確率）
  let successProb = 1.0;
  for (const node of pathNodes){
    // vuln が高いほど攻撃が成功しやすい
    console.log(`Multiplying successProb ${successProb} by vuln ${node.vuln} (node: ${node.id})`);
    successProb *= node.vuln;
  }
  console.log('Final successProb:', successProb);

  // 平均脆弱性
  const avgVuln = pathNodes.reduce((sum, n) => sum + n.vuln, 0) / pathNodes.length;

  // 経路上の最大重要度（最も重要な資産を経由するか）
  const maxImportance = Math.max(...pathNodes.map(n => n.importance));

  // リスク指標 = 成功確率 × 最大重要度 × 経路長の逆数
  // 短く、脆弱で、重要な資産を含む経路ほどリスクが高い
  const pathLength = pathResult.path.length;
  const riskIndex = successProb * maxImportance * (1 / Math.sqrt(pathLength));
  console.log(`Risk Index: ${successProb} * ${maxImportance} * (1 / sqrt(${pathLength})) = ${riskIndex}`);

  return {
    successProb: successProb,
    riskIndex: riskIndex,
    avgVuln: avgVuln,
    maxImportance: maxImportance,
    pathLength: pathLength
  };
}

/* ---------- UI Events ---------- */

analyzeBtn.addEventListener("click", ()=>{
  if (!data) return;
  const sId = startSelect.value;
  const gId = goalSelect.value;
  if (!sId || !gId || sId === gId) {
    alert("開始と目標を正しく選択してください");
    return;
  }
  const nodePenalty = clamp(Number(nodePenaltyInput.value || 0), 0, 2);
  const K = clamp(Number(kPathsInput.value || 3), 1, 10);

  const nodes = data.nodes;
  const edges = data.edges;
  const {adj, idx} = buildAdjacency(nodes, edges, nodePenalty);

  const s = idx.get(sId), g = idx.get(gId);
  if (s==null || g==null){
    alert("ノードが見つかりません");
    return;
  }

  // Yen's K-shortest paths アルゴリズムを実行
  currentPaths = yenKShortestPaths(nodes, adj, s, g, K);
  selectedPathIndex = 0;
  renderKPathsResult(currentPaths, nodes, edges);
});

exportBtn.addEventListener("click", ()=>{
  if (!data) return;
  const blob = new Blob([JSON.stringify({
    meta: data.meta, nodes: data.nodes, edges: data.edges
  }, null, 2)], {type: "application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (data.meta?.title ? data.meta.title.replace(/\s+/g,"_") : "graph") + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
});

fileInput.addEventListener("change", async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;

  // ファイルサイズ制限（5MB）
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (f.size > MAX_FILE_SIZE) {
    alert("ファイルサイズが大きすぎます（最大5MB）");
    fileInput.value = "";
    return;
  }

  try{
    const txt = await f.text();

    // JSON文字列の長さ制限
    if (txt.length > MAX_FILE_SIZE) {
      alert("ファイルの内容が大きすぎます");
      fileInput.value = "";
      return;
    }

    const json = JSON.parse(txt);

    // 基本的なバリデーション
    if (typeof json !== 'object' || json === null) {
      throw new Error("無効なJSON形式です");
    }

    // ノード数・エッジ数の制限（DoS対策）
    const nodes = json.nodes || [];
    const edges = json.edges || [];

    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      throw new Error("nodes と edges は配列である必要があります");
    }

    if (nodes.length > 1000) {
      throw new Error("ノード数が多すぎます（最大1000）");
    }

    if (edges.length > 5000) {
      throw new Error("エッジ数が多すぎます（最大5000）");
    }

    data = normalizeData(json);
    buildUIOptions(data.nodes);
    drawGraph(data);

    // 結果をクリア
    pathsListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-text">経路を探索していません</div>
        <div class="empty-hint">上記の設定を行い、「K最短経路を探索」ボタンを押してください</div>
      </div>
    `;
    currentPaths = [];

  }catch(err){
    alert("JSONの読み込みに失敗しました: " + err.message);
  }finally{
    fileInput.value = "";
  }
});

/* ---------- Render K paths results ---------- */

function renderKPathsResult(paths, nodes, edges){
  // 既存ハイライト解除
  linkSel.classed("highlight", false).classed("pulse", false);

  if (!paths || paths.length === 0){
    pathsListEl.innerHTML = '<div class="no-path">到達不可</div>';
    return;
  }

  // 複数経路を表示
  pathsListEl.innerHTML = '';
  paths.forEach((path, index) => {
    const pathDiv = document.createElement('div');
    pathDiv.className = 'path-item' + (index === selectedPathIndex ? ' selected' : '');
    pathDiv.setAttribute('data-rank', index); // ランクに応じた色分け用

    const idPath = path.path.map(i => nodes[i].id);

    // リスク指標を計算
    const metrics = calculatePathMetrics(path, nodes);

    pathDiv.innerHTML = `
      <div class="path-header">
        <span class="path-rank">#${index + 1}</span>
        <span class="path-cost">コスト: ${path.cost.toFixed(3)}</span>
        <button class="play-btn" data-path-index="${index}" title="経路をアニメーション再生">▶</button>
      </div>
      <div class="path-metrics">
        <div class="metric">
          <span class="metric-label">成功確率:</span>
          <span class="metric-value success-prob">${(metrics.successProb * 100).toFixed(1)}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">リスク指標:</span>
          <span class="metric-value risk-index" data-risk="${metrics.riskIndex.toFixed(3)}">${metrics.riskIndex.toFixed(3)}</span>
        </div>
      </div>
      <div class="path-route">${idPath.join(" → ")}</div>
    `;

    // 経路選択イベント
    pathDiv.addEventListener('click', (e) => {
      if (e.target.classList.contains('play-btn')) return; // 再生ボタンは除外
      selectedPathIndex = index;
      renderKPathsResult(currentPaths, nodes, edges);
    });

    // アニメーション再生ボタンイベント
    const playBtn = pathDiv.querySelector('.play-btn');
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      animatePath(path, nodes, edges, index);
    });

    pathsListEl.appendChild(pathDiv);
  });

  // 選択された経路をハイライト
  if (selectedPathIndex < paths.length){
    highlightPath(paths[selectedPathIndex], nodes, edges);
  }
}

function highlightPath(pathResult, nodes, edges){
  // 既存ハイライト解除
  linkSel.classed("highlight", false).classed("pulse", false);
  nodeSel.classed("node-highlight", false);

  if (!pathResult || !pathResult.path || pathResult.path.length < 2){
    return;
  }

  // パスのエッジを抽出して強調
  const edgeSet = new Set();
  for (let i=0;i<pathResult.path.length-1;i++){
    const a = nodes[pathResult.path[i]].id;
    const b = nodes[pathResult.path[i+1]].id;
    // 有向エッジ優先（D3.jsがsource/targetをオブジェクトに変換するため対応）
    const e = edges.find(e => {
      const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
      const targetId = typeof e.target === 'object' ? e.target.id : e.target;
      return sourceId === a && targetId === b;
    });
    if (e) edgeSet.add(e);
  }

  linkSel.each(function(e){
    const hit = edgeSet.has(e);
    d3.select(this).classed("highlight", hit).classed("pulse", hit);
  });

  // ノードもハイライト
  const nodeSet = new Set(pathResult.path.map(i => nodes[i].id));
  nodeSel.each(function(n){
    const hit = nodeSet.has(n.id);
    d3.select(this).classed("node-highlight", hit);
  });
}

// アニメーション再生
let currentAnimation = null;

function animatePath(pathResult, nodes, edges, pathIndex){
  // 既存のアニメーションを停止
  if (currentAnimation){
    clearTimeout(currentAnimation);
    currentAnimation = null;
  }

  // すべてのアニメーションクラスをクリア
  linkSel.classed("highlight", false).classed("pulse", false).classed("animate-edge", false)
    .classed("animate-current-edge", false).classed("animate-future-edge", false).classed("animate-dim", false);
  nodeSel.classed("node-highlight", false).classed("animate-node", false).classed("animate-current", false)
    .classed("animate-future", false).classed("animate-dim", false);

  if (!pathResult || !pathResult.path || pathResult.path.length < 2){
    return;
  }

  const path = pathResult.path;
  let step = 0;

  function animateStep(){
    if (step >= path.length){
      // アニメーション完了 - 全経路を最終状態で表示
      nodeSel.each(function(n){
        const isInPath = path.map(i => nodes[i].id).includes(n.id);
        d3.select(this)
          .classed("animate-current", false)
          .classed("animate-node", isInPath)
          .classed("animate-dim", !isInPath); // 経路外を暗くする
      });

      linkSel.each(function(e){
        const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
        const targetId = typeof e.target === 'object' ? e.target.id : e.target;
        const isInPath = path.some((nodeIdx, i) => {
          if (i === 0) return false;
          const a = nodes[path[i-1]].id;
          const b = nodes[nodeIdx].id;
          return sourceId === a && targetId === b;
        });
        d3.select(this)
          .classed("animate-edge", isInPath)
          .classed("pulse", false)
          .classed("animate-dim", !isInPath); // 経路外を暗くする
      });

      currentAnimation = null;
      return;
    }

    const currentNodeIdx = path[step];
    const currentNode = nodes[currentNodeIdx];

    // すべてのノードの状態を更新
    nodeSel.each(function(n){
      const isCurrent = n.id === currentNode.id;
      const isPast = path.slice(0, step).map(i => nodes[i].id).includes(n.id);
      const isInPath = path.map(i => nodes[i].id).includes(n.id);
      d3.select(this)
        .classed("animate-current", isCurrent)
        .classed("animate-node", isPast && !isCurrent)
        .classed("animate-future", isInPath && !isCurrent && !isPast)
        .classed("animate-dim", !isInPath); // 経路外のノードを暗く
    });

    // すべてのエッジの状態を更新
    linkSel.each(function(e){
      const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
      const targetId = typeof e.target === 'object' ? e.target.id : e.target;

      let isCurrentEdge = false;
      let isPastEdge = false;
      let isFutureEdge = false;

      if (step > 0){
        const prevNodeIdx = path[step - 1];
        const prevNode = nodes[prevNodeIdx];
        isCurrentEdge = sourceId === prevNode.id && targetId === currentNode.id;
      }

      isPastEdge = path.slice(0, step).some((nodeIdx, i) => {
        if (i === 0) return false;
        const a = nodes[path[i-1]].id;
        const b = nodes[nodeIdx].id;
        return sourceId === a && targetId === b;
      });

      isFutureEdge = path.slice(step).some((nodeIdx, i) => {
        if (i === 0) return false;
        const a = nodes[path[step + i-1]].id;
        const b = nodes[nodeIdx].id;
        return sourceId === a && targetId === b;
      });

      const isInPath = isCurrentEdge || isPastEdge || isFutureEdge;

      d3.select(this)
        .classed("animate-edge", isPastEdge)
        .classed("animate-current-edge", isCurrentEdge)
        .classed("animate-future-edge", isFutureEdge)
        .classed("pulse", isCurrentEdge)
        .classed("animate-dim", !isInPath); // 経路外のエッジを暗く
    });

    step++;
    currentAnimation = setTimeout(animateStep, 1000); // 1000msごとに次のステップ
  }

  // 経路を選択状態にする
  selectedPathIndex = pathIndex;
  renderKPathsResult(currentPaths, nodes, edges);

  // アニメーション開始
  animateStep();
}

/* ---------- 編集機能 ---------- */

// ノード追加ボタン
addNodeBtn.addEventListener('click', () => {
  editMode = 'add';
  nodeDialogTitle.textContent = 'ノード追加';
  nodeDialogId.value = `node${data.nodes.length + 1}`;
  nodeDialogLabel.value = '';
  nodeDialogType.value = 'node';
  nodeDialogVuln.value = 0.5;
  nodeDialogImportance.value = 0.5;
  nodeDialogColor.value = '#9fb3c8';
  nodeDialogId.disabled = false;
  nodeDialog.style.display = 'flex';
});

// ノード編集ボタン
editNodeBtn.addEventListener('click', () => {
  if (!selectedNode) return;
  editMode = 'edit';
  nodeDialogTitle.textContent = 'ノード編集';
  nodeDialogId.value = selectedNode.id;
  nodeDialogLabel.value = selectedNode.label;
  nodeDialogType.value = selectedNode.type;
  nodeDialogVuln.value = selectedNode.vuln;
  nodeDialogImportance.value = selectedNode.importance;
  nodeDialogColor.value = selectedNode.color || colorByType(selectedNode);
  nodeDialogId.disabled = true;
  nodeDialog.style.display = 'flex';
});

// ノード削除ボタン
deleteNodeBtn.addEventListener('click', () => {
  if (!selectedNode) return;
  if (!confirm(`ノード "${selectedNode.label}" を削除しますか？`)) return;

  // ノードを削除
  data.nodes = data.nodes.filter(n => n.id !== selectedNode.id);
  // 関連するエッジも削除
  data.edges = data.edges.filter(e => {
    const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
    const targetId = typeof e.target === 'object' ? e.target.id : e.target;
    return sourceId !== selectedNode.id && targetId !== selectedNode.id;
  });

  selectedNode = null;
  nodeEditPanel.style.display = 'none';
  nodePopup.style.display = 'none';
  buildUIOptions(data.nodes);
  drawGraph(data);
});

// ノードダイアログ保存
nodeDialogSave.addEventListener('click', () => {
  const id = nodeDialogId.value.trim();
  const label = nodeDialogLabel.value.trim() || id;
  const type = nodeDialogType.value;
  const vuln = clamp(Number(nodeDialogVuln.value), 0, 1);
  const importance = clamp(Number(nodeDialogImportance.value), 0, 1);
  const color = nodeDialogColor.value;

  // 入力バリデーション
  if (!id) {
    alert('IDを入力してください');
    return;
  }

  // ID/Labelの長さ制限（XSS/DoS対策）
  if (id.length > 100) {
    alert('IDが長すぎます（最大100文字）');
    return;
  }

  if (label.length > 200) {
    alert('ラベルが長すぎます（最大200文字）');
    return;
  }

  // 英数字、アンダースコア、ハイフンのみ許可（ID）
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    alert('IDには英数字、アンダースコア、ハイフンのみ使用できます');
    return;
  }

  if (editMode === 'add') {
    // ID重複チェック
    if (data.nodes.find(n => n.id === id)) {
      alert('このIDは既に存在します');
      return;
    }

    // 新規ノード追加
    const newNode = {id, label, type, vuln, importance};
    if (color) newNode.color = color;
    data.nodes.push(newNode);
  } else if (editMode === 'edit' && selectedNode) {
    // 既存ノードを更新
    const node = data.nodes.find(n => n.id === selectedNode.id);
    if (node) {
      node.label = label;
      node.type = type;
      node.vuln = vuln;
      node.importance = importance;
      if (color) {
        node.color = color;
      } else {
        delete node.color; // カスタム色をクリア
      }
    }
  }

  nodeDialog.style.display = 'none';
  buildUIOptions(data.nodes);
  drawGraph(data);
});

// ノードダイアログキャンセル
nodeDialogCancel.addEventListener('click', () => {
  nodeDialog.style.display = 'none';
});

// カラーリセットボタン
nodeDialogColorReset.addEventListener('click', () => {
  const type = nodeDialogType.value;
  const defaultColor = colorByType({type: type});
  nodeDialogColor.value = defaultColor;
});

// エッジ追加ボタン
addEdgeBtn.addEventListener('click', () => {
  if (!data || data.nodes.length < 2) {
    alert('エッジを追加するには少なくとも2つのノードが必要です');
    return;
  }

  // ノードリストを更新
  edgeDialogSource.innerHTML = '';
  edgeDialogTarget.innerHTML = '';
  data.nodes.forEach(n => {
    const opt1 = document.createElement('option');
    opt1.value = n.id;
    opt1.textContent = `${n.label} (${n.id})`;
    edgeDialogSource.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = n.id;
    opt2.textContent = `${n.label} (${n.id})`;
    edgeDialogTarget.appendChild(opt2);
  });

  edgeDialogWeight.value = 1.0;
  edgeDialog.style.display = 'flex';
});

// エッジダイアログ保存
edgeDialogSave.addEventListener('click', () => {
  const source = edgeDialogSource.value;
  const target = edgeDialogTarget.value;
  const weight = Number(edgeDialogWeight.value);

  if (source === target) {
    alert('同じノードへのエッジは作成できません');
    return;
  }

  // エッジ追加
  data.edges.push({source, target, weight});

  edgeDialog.style.display = 'none';
  drawGraph(data);
});

// エッジダイアログキャンセル
edgeDialogCancel.addEventListener('click', () => {
  edgeDialog.style.display = 'none';
});

// ダイアログ外クリックで閉じる
nodeDialog.addEventListener('click', (e) => {
  if (e.target === nodeDialog) {
    nodeDialog.style.display = 'none';
  }
});

edgeDialog.addEventListener('click', (e) => {
  if (e.target === edgeDialog) {
    edgeDialog.style.display = 'none';
  }
});

// プリセット読込ボタン
loadPresetBtn.addEventListener('click', () => {
  const preset = presetSelect.value;
  if (!preset) {
    alert('プリセットを選択してください');
    return;
  }

  fetch(`./sample-data/${preset}.json`)
    .then(r => {
      if (!r.ok) throw new Error('Failed to load preset');
      return r.json();
    })
    .then(json => {
      data = normalizeData(json);
      buildUIOptions(data.nodes);
      drawGraph(data);

      // 結果をクリア
      currentPaths = [];
      selectedPathIndex = 0;
      pathsListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">経路を探索していません</div>
          <div class="empty-hint">上記の設定を行い、「K最短経路を探索」ボタンを押してください</div>
        </div>
      `;

      // 通知を表示
      showPresetNotification(json.meta?.title || preset, data.nodes.length, data.edges.length);
    })
    .catch(err => {
      console.error(err);
      alert('プリセットの読み込みに失敗しました');
    });
});

// プリセット読込通知を表示
function showPresetNotification(title, nodeCount, edgeCount) {
  presetNotificationTitle.textContent = 'プリセット読込完了';
  presetNotificationDetail.innerHTML = `
    <strong>${title}</strong><br>
    ノード: ${nodeCount}個、エッジ: ${edgeCount}個
  `;

  presetNotification.classList.remove('hiding');
  presetNotification.style.display = 'block';

  // 3秒後に自動で閉じる
  setTimeout(() => {
    hidePresetNotification();
  }, 3000);
}

// 通知を閉じる
function hidePresetNotification() {
  presetNotification.classList.add('hiding');
  setTimeout(() => {
    presetNotification.style.display = 'none';
    presetNotification.classList.remove('hiding');
  }, 300);
}

// 通知の閉じるボタン
presetNotificationClose.addEventListener('click', () => {
  hidePresetNotification();
});
