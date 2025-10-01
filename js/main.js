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
const startSelect = document.getElementById("startSelect");
const goalSelect  = document.getElementById("goalSelect");
const analyzeBtn  = document.getElementById("analyzeBtn");
const nodePenaltyInput = document.getElementById("nodePenalty");
const costValEl   = document.getElementById("costVal");
const pathValEl   = document.getElementById("pathVal");
const nodeInfoEl  = document.getElementById("nodeInfo");
const exportBtn   = document.getElementById("exportBtn");
const fileInput   = document.getElementById("fileInput");

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
        {id:"srv1", label:"ファイルサーバ", type:"server", vuln:0.5, importance:0.9}
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
  const t = (d.type||"node").toLowerCase();
  if (t.includes("server")) return "#7cc7ff";
  if (t.includes("device")) return "#ffd580";
  if (t.includes("account")) return "#c3a6ff";
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
  nodeInfoEl.innerHTML = `
    <div class="kv"><div class="title">ID</div><div>${n.id}</div></div>
    <div class="kv"><div class="title">Label</div><div>${n.label}</div></div>
    <div class="kv"><div class="title">Type</div><div>${n.type||"-"}</div></div>
    <div class="kv"><div class="title">vuln</div><div>${n.vuln}</div></div>
    <div class="kv"><div class="title">importance</div><div>${n.importance}</div></div>
  `;
}

/* ---------- Dijkstra ---------- */

// グラフを隣接リストへ
function buildAdjacency(nodes, edges, nodePenalty){
  const idx = new Map(nodes.map((n,i)=>[n.id,i]));
  const adj = new Array(nodes.length).fill(0).map(()=>[]);
  edges.forEach(e=>{
    const si = idx.get(e.source), ti = idx.get(e.target);
    if (si==null || ti==null) return;
    const nCost = nodePenalty * (1 - nodes[ti].vuln); // 目標側ノード難易度を微加算
    const w = Number(e.weight ?? 1) + nCost;
    adj[si].push({to:ti, w, eid:`${e.source}→${e.target}`});
    // 無向扱いにしたい場合はこちらも追加
    // const nCost2 = nodePenalty * (1 - nodes[si].vuln);
    // adj[ti].push({to:si, w:Number(e.weight ?? 1)+nCost2, eid:`${e.target}→${e.source}`});
  });
  return {adj, idx};
}

function dijkstra(nodes, adj, startIdx, goalIdx){
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

  const nodes = data.nodes;
  const edges = data.edges;
  const {adj, idx} = buildAdjacency(nodes, edges, nodePenalty);

  const s = idx.get(sId), g = idx.get(gId);
  if (s==null || g==null){
    alert("ノードが見つかりません");
    return;
  }

  const res = dijkstra(nodes, adj, s, g);
  renderPathResult(res, nodes, edges);
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
  try{
    const txt = await f.text();
    const json = JSON.parse(txt);
    data = normalizeData(json);
    buildUIOptions(data.nodes);
    drawGraph(data);
    costValEl.textContent = "-";
    pathValEl.textContent = "経路: -";
  }catch(err){
    alert("JSONの読み込みに失敗しました: " + err.message);
  }finally{
    fileInput.value = "";
  }
});

/* ---------- Render path highlight ---------- */

function renderPathResult(res, nodes, edges){
  // 既存ハイライト解除
  linkSel.classed("highlight", false).classed("pulse", false);

  if (!res || !res.path || res.cost===Infinity || res.path.length < 2){
    costValEl.textContent = "到達不可";
    pathValEl.textContent = "経路: なし";
    return;
  }

  costValEl.textContent = res.cost.toFixed(3);
  const idPath = res.path.map(i => nodes[i].id);
  pathValEl.textContent = "経路: " + idPath.join(" → ");

  // パスのエッジを抽出して強調
  const edgeSet = new Set();
  for (let i=0;i<res.path.length-1;i++){
    const a = nodes[res.path[i]].id;
    const b = nodes[res.path[i+1]].id;
    // 有向エッジ優先（無ければ逆向きを探す場合は以下を拡張）
    const e = edges.find(e => e.source===a && e.target===b);
    if (e) edgeSet.add(e);
  }

  linkSel.each(function(e){
    const hit = edgeSet.has(e);
    d3.select(this).classed("highlight", hit).classed("pulse", hit);
  });
}
