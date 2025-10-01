# 開発者向けドキュメント

このドキュメントでは、Intrusion Path Mapperの内部実装、アルゴリズム、特殊なロジックについて解説します。

---

## 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [コアアルゴリズム](#コアアルゴリズム)
3. [リスク評価ロジック](#リスク評価ロジック)
4. [グラフ可視化の実装](#グラフ可視化の実装)
5. [データフォーマットと正規化](#データフォーマットと正規化)
6. [セキュリティ対策](#セキュリティ対策)
7. [パフォーマンス最適化](#パフォーマンス最適化)

---

## アーキテクチャ概要

### 技術スタック

- **フロントエンドのみ**: HTML/CSS/JavaScript（バックエンド不要）
- **D3.js v7**: グラフ可視化とforce-directedレイアウト
- **完全クライアントサイド処理**: すべてのデータ処理がブラウザー内で完結
- **GitHub Pages対応**: 静的サイトホスティング

### ファイル構成

```
intrusion-path-mapper/
├── index.html              # メインHTMLファイル（UI構造）
├── js/main.js              # コアロジック（1050行）
├── css/style.css           # ダークテーマスタイル
└── sample-data/            # プリセットシナリオ
    ├── sample-facility.json
    ├── sample-office-network.json
    ├── sample-physical-intrusion.json
    └── sample-social-engineering.json
```

### データフロー

```
ユーザー入力 (JSON/UI)
    ↓
normalizeData() → データ検証・クリーニング
    ↓
buildAdjacency() → グラフを隣接リスト形式に変換
    ↓
yenKShortestPaths() → K最短経路を計算
    ↓
calculatePathMetrics() → リスク指標を計算
    ↓
renderKPathsResult() → 結果をUIに表示
```

---

## コアアルゴリズム

### 1. Dijkstraの最短経路アルゴリズム

**実装箇所**: `js/main.js:303-338`

```javascript
function dijkstra(nodes, adj, startIdx, goalIdx, excludedEdges = new Set())
```

**特徴**:
- 隣接リスト形式のグラフ表現
- エッジ除外機能（Yen's algorithmでの使用）
- 計算量: O(V²)（V = ノード数）

**コスト計算**:
```javascript
// エッジコスト = エッジ重み + ノードペナルティ
const nCost = nodePenalty * (1 - nodes[ti].vuln);
const w = Number(e.weight ?? 1) + nCost;
```

- `nodePenalty`: ユーザー設定可能（0〜2、デフォルト0.4）
- `vuln`: ノードの脆弱性（0〜1、高いほど攻撃成功しやすい）
- **逆説的設計**: 脆弱性が高い（vuln=1）→ コストが低い → 攻撃しやすい経路

### 2. Yen's K-shortest paths アルゴリズム

**実装箇所**: `js/main.js:341-412`

```javascript
function yenKShortestPaths(nodes, adj, startIdx, goalIdx, K)
```

**アルゴリズムの流れ**:

1. **初期化**: Dijkstraで最短経路を計算（A[0]）
2. **ループ**: k=1 から K-1 まで繰り返し
3. **Spur Path探索**:
   - 前回の経路の各ノードを「スパーノード」として試す
   - ルートパスと同じ経路を除外
   - ルートパス内のノードを除外（スパーノード以外）
   - 残りのグラフでDijkstraを実行
4. **候補経路の管理**:
   - 候補経路Bをコスト順にソート
   - 最小コストの経路をAに追加
5. **重複除去**: 既存経路と同一の経路は除外

**計算量**: O(K × V × (E + V log V))
- K: 経路数
- V: ノード数
- E: エッジ数

**重要な最適化**:
```javascript
// エッジ除外（同じルートパスを持つ経路から）
for (const p of A){
  if (p.path.length > i && arraysEqual(p.path.slice(0, i+1), rootPath)){
    if (p.path.length > i+1){
      const edgeKey = `${p.path[i]}-${p.path[i+1]}`;
      excludedEdges.add(edgeKey);
    }
  }
}
```

---

## リスク評価ロジック

### 成功確率の計算

**実装箇所**: `js/main.js:436-442`

```javascript
// 成功確率 = 各ノードの脆弱性の積
let successProb = 1.0;
for (const node of pathNodes){
  successProb *= node.vuln;
}
```

**意味**:
- 各ノードでの攻撃成功確率を連鎖的に乗算
- 例: 3つのノード（vuln=0.8, 0.7, 0.6）
  - 成功確率 = 0.8 × 0.7 × 0.6 = 33.6%

**特性**:
- 経路が長いほど成功確率は低下（リスク軽減）
- 1つでも脆弱性が低いノードがあると全体確率が下がる

### リスク指標の計算

**実装箇所**: `js/main.js:451-454`

```javascript
// リスク指標 = 成功確率 × 最大重要度 × (1/√経路長)
const riskIndex = successProb * maxImportance * (1 / Math.sqrt(pathLength));
```

**各要素の意味**:

| 要素 | 意味 | 範囲 |
|---|---|---|
| `successProb` | 攻撃成功確率 | 0.0〜1.0 |
| `maxImportance` | 経路上の最大重要度 | 0.0〜1.0 |
| `1/√pathLength` | 経路長の逆数（平方根） | 小さいほど長い経路 |

**設計思想**:
- **高リスク経路**: 短く、脆弱で、重要な資産を含む
- **低リスク経路**: 長く、堅牢で、重要度が低い

**平方根を使う理由**:
- 線形の逆数（1/n）では経路長の影響が大きすぎる
- 平方根（1/√n）で経路長の影響を緩和
- 例:
  - 経路長3 → 1/√3 ≈ 0.577
  - 経路長6 → 1/√6 ≈ 0.408（約71%）
  - 経路長9 → 1/√9 ≈ 0.333（約58%）

### リスク指標の具体例

**ケース1: 高リスク経路**
```
経路: ext → pc1 → srv1（3ノード）
vuln: 0.8, 0.7, 0.9
importance: 0.1, 0.4, 0.95
```
- 成功確率 = 0.8 × 0.7 × 0.9 = 0.504 (50.4%)
- 最大重要度 = 0.95
- リスク指標 = 0.504 × 0.95 × (1/√3) = 0.276

**ケース2: 低リスク経路**
```
経路: ext → lobby → corridor → door1 → door2 → room → srv1（7ノード）
vuln: 0.4, 0.3, 0.2, 0.3, 0.3, 0.4, 0.5
importance: 0.1, 0.2, 0.1, 0.2, 0.2, 0.3, 0.9
```
- 成功確率 = 0.4 × 0.3 × 0.2 × 0.3 × 0.3 × 0.4 × 0.5 = 0.000216 (0.0216%)
- 最大重要度 = 0.9
- リスク指標 = 0.000216 × 0.9 × (1/√7) = 0.000074

→ ケース1はケース2の約**3,730倍**のリスク

---

## グラフ可視化の実装

### D3.js Force Simulationの設定

**実装箇所**: `js/main.js:190-195`

```javascript
sim = d3.forceSimulation(graphData.nodes)
  .force("link", d3.forceLink(graphData.edges)
    .id(d=>d.id)
    .distance(e=> 40 + e.weight*30)
    .strength(0.3))
  .force("charge", d3.forceManyBody().strength(-220))
  .force("center", d3.forceCenter(width()/2, height()/2))
  .force("collide", d3.forceCollide().radius(d=> 12 + d.importance*12))
  .on("tick", ticked);
```

**各Forceの役割**:

| Force | パラメーター | 効果 |
|---|---|---|
| `link` | distance: 40 + weight×30 | エッジの長さ（重いエッジほど長く） |
| `link` | strength: 0.3 | リンクの強度（柔軟性） |
| `charge` | strength: -220 | ノード間の反発力（負＝反発） |
| `center` | width/2, height/2 | 中心への引力 |
| `collide` | radius: 12 + importance×12 | 衝突回避（重要なノードほど大きい） |

### ノードの色分けロジック

**実装箇所**: `js/main.js:212-224`

```javascript
function colorByType(d){
  if (d.color) return d.color;  // カスタムカラー優先

  const t = (d.type||"node").toLowerCase();
  if (t.includes("server")) return "#7cc7ff";   // 青系
  if (t.includes("device")) return "#ffd580";   // オレンジ系
  if (t.includes("account")) return "#c3a6ff";  // 紫系
  if (t.includes("person")) return "#ffb3d9";   // ピンク系
  if (t.includes("gateway") || t.includes("room")) return "#9affc3"; // 緑系
  return "#9fb3c8";  // デフォルト（グレー）
}
```

**部分一致検索の理由**:
- `includes()`で柔軟なマッチング
- 例: `"file_server"`, `"ad_server"`, `"server01"` すべてマッチ

### アニメーション実装

**実装箇所**: `js/main.js:678-792`

**ステップバイステップ処理**:
```javascript
function animateStep(){
  // 現在のノード: animate-current
  // 過去のノード: animate-node
  // 未来のノード: animate-future
  // 経路外のノード: animate-dim（暗くする）

  step++;
  currentAnimation = setTimeout(animateStep, 1000); // 1秒ごと
}
```

**CSS連携**:
```css
.animate-current { fill: #ffd700; }  /* ゴールド */
.animate-node { fill: #4caf50; }     /* 緑 */
.animate-future { fill: #2196f3; }   /* 青 */
.animate-dim { opacity: 0.2; }       /* 半透明 */
```

---

## データフォーマットと正規化

### normalizeData関数

**実装箇所**: `js/main.js:96-120`

```javascript
function normalizeData(json) {
  const nmap = new Map();
  const nodes = (json.nodes || []).map(n => {
    const node = {
      id: String(n.id),              // 文字列化
      label: n.label ?? n.id,        // デフォルト値
      type: n.type ?? "node",
      vuln: clamp(Number(n.vuln ?? 0.5), 0, 1),       // 範囲制限
      importance: clamp(Number(n.importance ?? 0.5), 0, 1)
    };
    if (n.color) node.color = n.color;  // カスタムカラー
    nmap.set(node.id, node);
    return node;
  });

  const edges = (json.edges || []).map(e => {
    return {
      source: String(e.source),
      target: String(e.target),
      weight: Number(e.weight ?? 1.0)
    };
  }).filter(e => nmap.has(e.source) && nmap.has(e.target));  // 孤立エッジ除去

  return { meta: json.meta || {}, nodes, edges, attack_goals: json.attack_goals || [] };
}
```

**重要な処理**:
1. **型変換**: すべてのIDを文字列化
2. **デフォルト値**: 未定義フィールドに安全なデフォルト値
3. **範囲クランプ**: vuln/importanceを0〜1に制限
4. **孤立エッジ除去**: 存在しないノードを参照するエッジを削除
5. **カスタムカラー対応**: v1.1で追加

### D3.jsのデータ変換問題

**問題**: D3.jsがエッジのsource/targetをオブジェクトに変換

```javascript
// 元のデータ
{source: "pc1", target: "srv1"}

// D3.js force simulationが変換
{source: {id: "pc1", ...}, target: {id: "srv1", ...}}
```

**解決策**: 両方の形式に対応

```javascript
const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
const targetId = typeof e.target === 'object' ? e.target.id : e.target;
```

---

## セキュリティ対策

### 入力検証（バリデーション）

**実装箇所**: `js/main.js:508-572`

#### 1. ファイルサイズ制限

```javascript
const MAX_FILE_SIZE = 5 * 1024 * 1024;  // 5MB
if (f.size > MAX_FILE_SIZE) {
  alert("ファイルサイズが大きすぎます（最大5MB）");
  return;
}
```

**理由**: DoS攻撃防止

#### 2. ノード/エッジ数制限

```javascript
if (nodes.length > 1000) {
  throw new Error("ノード数が多すぎます（最大1000）");
}
if (edges.length > 5000) {
  throw new Error("エッジ数が多すぎます（最大5000）");
}
```

**理由**: ブラウザーのメモリー枯渇防止

#### 3. ID/Label長制限

```javascript
if (id.length > 100) {
  alert('IDが長すぎます（最大100文字）');
  return;
}
if (label.length > 200) {
  alert('ラベルが長すぎます（最大200文字）');
  return;
}
```

**理由**: XSS攻撃とメモリー効率

#### 4. ID形式制限

```javascript
if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
  alert('IDには英数字、アンダースコア、ハイフンのみ使用できます');
  return;
}
```

**理由**: インジェクション攻撃防止

### Content Security Policy (CSP)

**実装箇所**: `index.html:9`

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://d3js.org;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self';
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
">
```

**各ディレクティブの意味**:

| ディレクティブ | 許可 | 理由 |
|---|---|---|
| `default-src 'self'` | 同一オリジンのみ | デフォルト制限 |
| `script-src 'self' https://d3js.org` | 自身とD3.js CDN | D3.js読込 |
| `style-src 'self' 'unsafe-inline'` | 自身とインラインCSS | D3動的スタイル |
| `img-src 'self' data:` | 自身とdata URI | faviconとSVG |
| `object-src 'none'` | すべて禁止 | Flash等のプラグイン防止 |

### その他のセキュリティヘッダー

```html
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta name="referrer" content="no-referrer">
```

- **X-Content-Type-Options**: MIMEタイプスニッフィング防止
- **Referrer Policy**: リファラー情報を送信しない

---

## パフォーマンス最適化

### 1. アルゴリズムの計算量

| アルゴリズム | 計算量 | 1000ノードの場合 |
|---|---|---|
| Dijkstra | O(V²) | 1,000,000回 |
| Yen's K-shortest | O(K×V×(E+V log V)) | K×1000×(E+10,000) |
| Force Simulation | O(V²) per tick | 1,000,000回/tick |

### 2. 推奨ノード数

| ノード数 | 経路探索速度 | Force Simulation |
|---|---|---|
| 〜50 | 瞬時 | スムーズ |
| 50〜200 | 1秒以内 | 快適 |
| 200〜500 | 数秒 | やや重い |
| 500〜1000 | 10秒以上 | 重い（アニメーション推奨オフ） |

### 3. 最適化テクニック

#### エッジのインデックス化

```javascript
const idx = new Map(nodes.map((n,i)=>[n.id,i]));
```

- O(1)でノードIDからインデックスを取得

#### Set による重複チェック

```javascript
const excludedEdges = new Set();
if (excludedEdges.has(edgeKey)) continue;
```

- O(1)でエッジ除外を判定

#### Force Simulation の早期終了

```javascript
if (u === goalIdx) break;  // ゴール到達で終了
```

- 不要な計算をスキップ

### 4. メモリー使用量の見積もり

**1ノードあたり**:
```javascript
{
  id: "string",         // ~50 bytes
  label: "string",      // ~100 bytes
  type: "string",       // ~20 bytes
  vuln: 0.5,           // 8 bytes (Number)
  importance: 0.5,     // 8 bytes (Number)
  x: 100, y: 100,      // 16 bytes (D3追加)
  vx: 0, vy: 0         // 16 bytes (D3追加)
}
// 合計: ~218 bytes
```

**1000ノード**: 約218KB
**5000エッジ**: 約100KB
**合計**: 約320KB（許容範囲）

---

## デバッグ方法

### コンソールログの活用

**リスク計算のデバッグ** (`js/main.js:432-455`):

```javascript
console.log('=== Path Metrics Calculation ===');
console.log('Path indices:', pathResult.path);
console.log('Path nodes:', pathNodes.map(n => ({id: n.id, vuln: n.vuln, importance: n.importance})));
console.log(`Multiplying successProb ${successProb} by vuln ${node.vuln} (node: ${node.id})`);
console.log('Final successProb:', successProb);
console.log(`Risk Index: ${successProb} * ${maxImportance} * (1 / sqrt(${pathLength})) = ${riskIndex}`);
```

**使い方**:
1. ブラウザーでF12キーを押す
2. Consoleタブを開く
3. 経路探索を実行
4. 計算過程を確認

### よくある問題と対処法

#### 問題1: 成功確率が0%になる

**原因**: 経路上にvuln=0のノードがある

**確認方法**:
```javascript
console.log('Path nodes:', pathNodes.map(n => ({id: n.id, vuln: n.vuln})));
```

**対処法**: すべてのノードのvulnを0.01以上に設定

#### 問題2: リスク指標が異常に高い

**原因**: 経路長が1（開始＝目標）

**確認方法**:
```javascript
console.log('Path length:', pathResult.path.length);
```

**対処法**: 開始と目標を別のノードに設定

#### 問題3: 経路が見つからない

**原因**: グラフが連結されていない

**確認方法**:
```javascript
console.log('Adjacency list:', adj);
```

**対処法**: すべてのノードが経路で繋がっているか確認

---

## 拡張アイデア

### 1. 双方向エッジのサポート

現在は有向グラフのみサポート。無向グラフにするには:

```javascript
// buildAdjacency関数内に追加
const nCost2 = nodePenalty * (1 - nodes[si].vuln);
adj[ti].push({to:si, w:Number(e.weight ?? 1)+nCost2, eid:`${targetId}→${sourceId}`});
```

### 2. エッジ属性の拡張

```json
{
  "source": "pc1",
  "target": "srv1",
  "weight": 1.2,
  "type": "network",          // 追加
  "protocol": "SSH",          // 追加
  "authenticated": true       // 追加
}
```

### 3. 時系列分析

```javascript
// ノードに時間属性を追加
{
  "id": "server01",
  "available_hours": [9, 10, 11, 12, 13, 14, 15, 16, 17]  // 9時〜17時のみ
}
```

### 4. 確率的シミュレーション

```javascript
// モンテカルロシミュレーション
function simulateAttacks(path, nodes, trials = 10000) {
  let successes = 0;
  for (let i = 0; i < trials; i++) {
    let success = true;
    for (const nodeIdx of path.path) {
      if (Math.random() > nodes[nodeIdx].vuln) {
        success = false;
        break;
      }
    }
    if (success) successes++;
  }
  return successes / trials;
}
```

---

## トラブルシューティング

### Force Simulationが動かない

**症状**: ノードが固定されたまま動かない

**原因**: D3.jsのバージョン不一致

**確認**:
```javascript
console.log(d3.version);  // "7.x.x" であることを確認
```

**対処**: `index.html`のD3.js CDNリンクを確認

### JSONが読み込めない

**症状**: "JSONの読み込みに失敗しました"エラー

**原因**:
1. JSON構文エラー（カンマ忘れ、クォート不足等）
2. ファイルサイズが5MBを超えている
3. ノード数/エッジ数が上限を超えている

**対処**:
```bash
# JSON構文チェック
python -m json.tool sample.json
```

### アニメーションが途中で止まる

**症状**: 経路アニメーションが途中で停止

**原因**: `currentAnimation`のタイムアウトがクリアされている

**対処**: 再度▶ボタンをクリック

---

## 貢献ガイドライン

### コードスタイル

- **インデント**: 2スペース
- **文字列**: シングルクォート推奨
- **セミコロン**: 必須
- **関数名**: キャメルケース（例: `calculatePathMetrics`）
- **定数**: UPPER_SNAKE_CASE（例: `MAX_FILE_SIZE`）

### テスト方法

```bash
# ローカルサーバー起動
python -m http.server 8000

# ブラウザーで開く
# http://localhost:8000

# 各プリセットで動作確認
# 1. 施設侵入（シンプル）
# 2. オフィスネットワーク攻撃
# 3. 物理的侵入経路
# 4. ソーシャルエンジニアリング
```

### プルリクエストのチェックリスト

- [ ] コンソールエラーがない
- [ ] すべてのプリセットで動作する
- [ ] 1000ノードでパフォーマンス劣化がない
- [ ] セキュリティチェックに通過
- [ ] README.mdを更新（必要に応じて）

---

## ライセンスと注意事項

本ツールはMITライセンスの下で公開されています。

**重要な注意**:
- 教育・デモ目的専用
- 実際の攻撃に使用しないこと
- 機密情報を入力しないこと
- 実運用環境でのセキュリティ評価を代替するものではない

---

## 参考文献

- [Yen's Algorithm - Wikipedia](https://en.wikipedia.org/wiki/Yen%27s_algorithm)
- [Dijkstra's Algorithm - Wikipedia](https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm)
- [D3.js Force Simulation](https://d3js.org/d3-force)
- [Content Security Policy - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

---

**最終更新**: 2025-10-01
**バージョン**: 1.1
**メンテナー**: ipusiron
