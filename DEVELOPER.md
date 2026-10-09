# 開発者向けドキュメント

このドキュメントでは、Intrusion Path Mapperの内部実装、アルゴリズム、特殊なロジックについて解説します。使い方と仕様の要約は[README.md](README.md)にあります。

---

## 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [コアアルゴリズム](#コアアルゴリズム)
3. [リスク評価ロジック](#リスク評価ロジック)
4. [グラフ可視化の実装](#グラフ可視化の実装)
5. [データフォーマットと正規化](#データフォーマットと正規化)
6. [セキュリティ対策](#セキュリティ対策)
7. [日英対応](#日英対応)
8. [パフォーマンス](#パフォーマンス)
9. [テストとデバッグ](#テストとデバッグ)
10. [拡張アイデア](#拡張アイデア)

---

## アーキテクチャ概要

### 技術スタック

- HTML・CSS・JavaScript（ESモジュール）。ビルドなし、サーバーなし、npmの依存なし
- D3.js 7.9.0（`vendor/d3/`に自己ホスト、ISC License）。d3-force・d3-drag・d3-zoomを使う
- テストは`node --test`（Node.js 22以上）

### ファイル構成

| ファイル | 役割 |
|---|---|
| `js/ipm-core.js` | 計算部。DOMとD3に触れない純粋な関数だけを置く（テストから直接読む） |
| `js/ipm-messages.js` | 画面の文言。`MESSAGES.ja`と`MESSAGES.en`は同じキーを持つ |
| `js/main.js` | 画面の処理。D3での描画、ズーム、結果の一覧、アニメーション、編集、インポート・エクスポート、言語の切り替え |
| `index.html` | 画面の骨組み。固定の文言は`data-i18n`で辞書から入れる |
| `css/style.css` | 配色（CSS変数）、配置、幅860px以下の1列表示、`prefers-reduced-motion` |

### データフロー

```
JSON
  → parseGraphText() / normalizeGraph()   … 検証・正規化（読み込みを止める誤りは GraphError、直せるものは warnings）
  → data = {meta, nodes, edges, attack_goals}（エッジの端点は常にIDの文字列）
  → findPaths(data, start, goal, {mode, k, nodePenalty})
      → buildAdjacency() → kShortestPaths()（Yen）→ pathMetrics()
  → renderKPathsResult() → highlightPath() / animatePath()
```

---

## コアアルゴリズム

### 1. 隣接リスト（2つの並べ方）

`buildAdjacency(nodes, edges, {mode, nodePenalty})`は、エッジごとに行き先のノード`t`の値から重みを決めます。

```javascript
// 成功確率の高い順（mode: "prob"）
w = -Math.log(nodes[t].vuln);           // vuln = 0 のノードへは辺を作らない（確率0で通れない）

// コストの低い順（mode: "cost"）
w = edge.weight + nodePenalty * (1 - nodes[t].vuln);
```

成功確率は積`v1 × v2 × … × vn`です。対数を取ると`ln v1 + … + ln vn`の和になり、符号を反転した`−ln v`は0以上なので、Dijkstra法とYen法の前提（負の重みがない）を満たします。和が最小の経路が、積が最大の経路です。

### 2. Dijkstra法

`dijkstra(adj, start, goal, blockedNodes, blockedEdges)`は二分ヒープ（`MinHeap`）で実装しています。ヒープから取り出した距離が記録より大きければ読み飛ばす、遅延削除の形です。`blockedNodes`（ノードの添字）と`blockedEdges`（`"u-v"`の文字列）は、Yen法が枝分かれを作るときに使います。

### 3. YenのK最短経路

`kShortestPaths(adj, start, goal, K)`の手順です。

1. 1本目をDijkstra法で求めてAに入れる
2. Aの最後の経路の各ノードを「枝分かれの点」として、そこまでの部分（root）を固定する
3. rootが同じAの経路について、枝分かれの点から先へ出る辺を塞ぐ。rootの途中のノードも塞ぐ
4. 枝分かれの点から目標までをDijkstra法で求め、rootとつないだ経路を候補Bに入れる（同じ経路は入れない）
5. Bの中でコストが最小のものをAに移し、K本になるかBが空になるまで2〜5を繰り返す

テスト（`test/core.test.js`）では、4つのサンプルのすべての開始と目標の組で、全単純経路を列挙した総当たりと結果を比べています（コスト順はノード難易度の重み0・0.4・2、成功確率順は確率の積の大きい順）。

### 4. 目標ごとのリスク（Dijkstra法を1回）

`targetRisks(graph, startId)`は、`−ln(vuln)`を重みにした隣接リストで、目標を決めずに最後までDijkstra法を進め（`shortestTree`）、全ノードへの最短経路の木を作ります。各ノードの成功確率の最大値は`exp(−距離)`と同じで、実装では木から経路をたどって`pathMetrics()`で計算します。リスク＝成功確率×そのノードのimportanceの大きい順（同じなら成功確率、IDの順）に並べます。開始ノードと届かないノードは含めません。画面は上位10件を表示し、いまの目標が11位以下なら本当の順位をつけて末尾に足します。

### 5. 表示中の経路がすべて通るノード

`commonNodes(paths)`は、1本目の経路の途中のノード（開始と目標を除く）のうち、ほかのすべての経路にも含まれるものを、1本目の順で返します。2本未満なら空です（1本なら全部が共通になって意味がないため）。表示中のK本についての結果で、最小頂点カット（すべての経路を断つ最小のノードの組）とは別のものです。

### 6. 対策の効果（1つ塞ぐ・最小頂点カット）

`blockImpact(graph, s, g)`は、成功確率が最大の経路（1位）の途中のノード`v`ごとに、`v`を通らない最短経路を`dijkstra(adj, s, g, new Set([v]))`で求め、その成功確率を返します。1位に乗っていないノードを塞いでも1位は残るので、調べるノードは1位の途中のノードだけです（計算は高々「1位の手数−1」回）。

`minVertexCut(graph, s, g)`は、ノード`v`を入口`2v`と出口`2v+1`に分け、`2v→2v+1`を容量1（開始と目標は大きな値）、エッジ`u→v`を`2u+1→2v`の大きな容量にして、Edmonds-Karp法で最大流を求めます。Mengerの定理により、最大流の値がすべての経路を断つのに要るノードの最小個数です。最大流のあとの残余グラフで、開始から届く入口と届かない出口の組を持つノードが、開始に近い側の最小の組です。成功確率順と同じく、vuln＝0のノードへのエッジは数えません。開始から目標へ直接のエッジがあれば、ノードを塞いでも断てないので`direct: true`を返します。

テストでは、4つのサンプルの届く全組（直接のエッジがない130組）で、返した組を塞ぐと届かなくなること、それより1つ少ないどの組でも断てないことを総当たりで確かめています。1,000ノード・3,000エッジのマップで約10ミリ秒です。

---

## リスク評価ロジック

### 成功確率

```javascript
// pathMetrics(nodes, edges, path, nodePenalty)
let successProb = 1;
for (let i = 1; i < path.length; i++) successProb *= nodes[path[i]].vuln;   // i = 0（開始ノード）は数えない
```

vulnは「手前のノードにいる攻撃者が、そのノードを突破できる確率」です。攻撃者はすでに開始ノードにいるので、開始ノードのvulnは掛けません。各ノードの突破は独立と仮定しています。

### リスク

```javascript
risk = successProb * nodes[goal].importance;   // 可能性 × 影響
```

同じ目標への経路どうしでは、リスクの順は成功確率の順と同じです。importanceは「そのノードを掌握されたときの損害」で、扉や窓のような通り道には低い値を付けます（物理的侵入経路のサンプルは0.10）。通り道に高い値があると、目標ごとのリスクで通り道が上位に並んでしまいます。

### コスト

`weightedCost()`は、コスト順の重み（`weight + nodePenalty × (1 − vuln)`）の和です。成功確率順で並べたときも、比べられるように表示します。

### 表示の桁

| 関数 | 規則 | 例 |
|---|---|---|
| `formatPercent(p)` | 10%以上は小数1桁、それ未満は有効数字3桁、0.001%未満は指数表記 | 51.2%、2.66%、0.292%、5.00e-7% |
| `formatScore(v)` | 有効数字3桁、0.0001未満は指数表記 | 0.0253、0.00997 |
| `formatCost(c)` | 小数2桁 | 8.70 |

---

## グラフ可視化の実装

### Force Simulation

```javascript
d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id(d => d.id).distance(e => 40 + Math.min(e.weight, 10) * 30).strength(0.3))
  .force("charge", d3.forceManyBody().strength(-220))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collide", d3.forceCollide().radius(d => 12 + d.importance * 12))
```

- D3は`forceLink`に渡したエッジの`source`・`target`をノードのオブジェクトに置き換えます。`drawGraph()`はエッジの写し（`links`）を渡し、`data.edges`はIDの文字列のまま保ちます（エクスポートと削除が壊れないようにするため）
- 新しいマップは、先に300回`tick()`してから描き、`fitView()`で全体が収まる縮尺にします。d3-forceの初期配置と乱数は決まっているので、同じマップなら毎回同じ配置になります
- 編集のあとは今の配置と縮尺を保ち、座標のないノード（追加したばかり）があるときだけシミュレーションを動かします

### ズーム

`d3.zoom()`をSVGに付け、`g.zoom-layer`に`transform`をかけます。ノードの座標はシミュレーションの値のままなので、ポップアップの位置は`d3.zoomTransform(svg).apply([x, y])`で画面の座標に直します。`fitView()`は、ノードの範囲（右側のラベルの幅を含む）が凡例を避けて収まるように縮尺（0.2〜1.5）と位置を決めます。

### 矢印

`marker`は`markerUnits="userSpaceOnUse"`で、線の太さによらず一定の大きさにしています。線の終端は行き先の円の縁で止めます（矢印の先端が円に隠れないため）。強調した経路はCSSの`marker-end`で緑の矢印に切り替えます。

### ノードの色

`typeColor(type)`は種類の名前に`server`・`device`・`account`・`person`・`gateway`・`room`を含むかで色を決め、どれでもなければ`node`の色です。`color`（`#rrggbb`）があればそれを使います。凡例の色（`.legend-color.type-*`）は`TYPE_COLORS`と同じ値で、テストで比べています。

### エッジの当たり判定と編集

細い線はクリックしにくいので、同じ座標に透明で太い線（`.link-hit`、`stroke-width: 12px`）を重ね、クリックでエッジの編集を開きます。線の`<title>`には「A→B（weight）」を入れます。キーボードでは、ノード情報の「出ていくエッジ」「入ってくるエッジ」の一覧のボタンから編集・削除します。

エッジの編集は計算部の関数で行い、元の配列は変えずに新しい`edges`を返します。

| 関数 | 内容 |
|---|---|
| `addEdge(graph, s, t, w, {bidirectional})` | 追加。誤りは`unknownNode`・`sameNode`・`weight`・`edgeExists`・`tooManyEdges`。双方向で逆向きがすでにあれば片方だけ足す（`reverseSkipped`） |
| `updateEdgeWeight(graph, s, t, w)` | weightだけを変える（向きや端点は削除して追加する） |
| `removeEdge(graph, s, t)` | 削除 |
| `edgesOf(graph, id)` | ノードに出入りするエッジ |

### もしも（vulnのスライダー）

ノード情報のスライダーで`vuln`を動かすと、ノードの値を書き換えてから`rerunSearch()`を呼び、直前の探索の条件（`lastSearch`＝開始・目標・並べ方・K・ペナルティ）で、経路・目標ごとのリスク・対策の効果を計算し直します。最初に動かしたときの値と1位の成功確率を`whatifOriginals`に覚え、「1位の成功確率：元→いま」と「元の値に戻す」に使います。編集のダイアログで値を確定したときと、新しいマップを読み込んだときは、この記録を消します。

### 経路以外を薄くする

経路を選ぶと、「経路以外を薄くする」がオンなら、経路に含まれないノードとエッジに`.path-dim`を付けます。表示中の経路がすべて通るノードには`.node-common`（点線の輪）を付けます。アニメーションは別のクラス（`animate-*`）を使い、始めるときに`.path-dim`を外します。

### アニメーション

`animatePath(index)`は1秒ごとに1手進め、通過したノード・いまのノード・これからのノードを別のクラスで塗ります。別の経路を選ぶ・探索し直す・マップを変える・言語を切り替えると`stopAnimation()`で止まります。

---

## データフォーマットと正規化

`normalizeGraph(json)`は次の順に検証します。

| 種類 | 扱い |
|---|---|
| オブジェクトでない、nodes・edgesが配列でない、ノードが0個、上限超え | 読み込まない（`GraphError`） |
| IDが`/^[A-Za-z0-9_-]{1,100}$/`に合わない、IDの重複、ラベルが200文字超 | 読み込まない |
| 種類が英小文字・数字・`_`・`-`の1〜30文字でない | `node`にして警告 |
| vuln・importanceが範囲外・数でない | 0〜1に直すか0.5にして警告 |
| 色が`#rrggbb`でない、英語ラベルが文字列でない・長すぎる | 捨てて警告 |
| weightが負 | 0にして警告。数でなければ1にして警告 |
| 存在しないノードへのエッジ、自分自身へのエッジ、同じ向きの重複 | 捨てて件数を警告 |

エッジの端点がオブジェクト（`{id: …}`）でも、IDを取り出して読み込みます。`serializeGraph()`は保存に要るキーだけを書き出すので、エクスポートしたファイルはそのまま読み込み直せます（テストで往復を確かめています）。

---

## セキュリティ対策

- meta要素のCSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`。HTMLに`style`属性とインラインのイベントハンドラーを置かない（スタイルはCSSのクラスか、CSSOMの`element.style`への代入で変える）
- 読み込んだ文字列は、DOMには`textContent`、SVGにはD3の`.text()`で入れる。`innerHTML`は使わない（テストで確かめる）
- GitHub Pagesはレスポンスヘッダーを設定できません。`frame-ancestors`や`X-Frame-Options`はmeta要素では無視されるので、書いていません
- localStorageに保存するのは言語の選択（`ipm_locale`）だけです。使えない環境でも動きます

---

## 日英対応

- 初期言語は`resolveLocale({query, saved, languages})`で決めます（`?lang=` → 保存した選択 → ブラウザーの言語。日本語以外は英語）
- `index.html`の固定の文言は`data-i18n`（textContent）・`data-i18n-aria`（aria-label）・`data-i18n-title`（title）で辞書から入れます
- 切り替えたときは、持っている結果・選択中のノード・知らせ・通知を同じ値で描き直し、計算はし直しません
- ノードの表示名は`nodeLabel(node, locale)`です。英語表示で`label_en`があればそれを使います
- `main.js`のコード（コメントを除く）には日本語の文字列を置きません（テストで確かめます）

---

## パフォーマンス

| 処理 | 計算量の目安 |
|---|---|
| Dijkstra法（二分ヒープ） | O((V＋E) log V) |
| Yen法 | O(K・V・(V＋E) log V) |
| 配置の事前計算 | 300回 × d3-forceの1回分（多体力はBarnes-Hut近似） |

1,000ノード・約2,000エッジの鎖でK=10の探索が終わることをテストで確かめています。描画は数百ノードを超えると重くなるので、見やすさの点でも小さなマップに分けることをおすすめします。

---

## テストとデバッグ

```bash
npm test                         # すべてのテスト
node --test test/core.test.js    # 計算部だけ
python -m http.server 8000       # 画面の確認（http://localhost:8000/?lang=ja）
```

| テスト | 内容 |
|---|---|
| `core.test.js` | 検証と正規化、往復、Yen法と総当たりの一致、目標ごとのリスクと総当たりの一致、共通ノード、1つ塞いだときと総当たりの一致、最小頂点カットの最小性、エッジの編集、指標と表示の桁、1,000ノード |
| `html.test.js` | CSP、インラインのハンドラーとstyle属性がない、要素のid、`<dialog>`、D3のSHA-256とライセンス、凡例の色 |
| `contrast.test.js` | 配色のコントラスト（4.5:1以上） |
| `i18n.test.js` | 辞書のキーと埋め込み値の一致、英語に日本語がない、サンプルの英語ラベル |
| `format.test.js` | 行の長さ、行数の下限、制御文字、計算部がDOMに触れない |
| `readme.test.js` | READMEのYAML、日英の見出しの対応、数値の再計算、ディレクトリー構造 |

計算部はDOMに依存しないので、Node.jsのREPLで直接試せます。

```javascript
const core = await import("./js/ipm-core.js");
const json = JSON.parse(require("fs").readFileSync("sample-data/sample-facility.json", "utf8"));
const { graph } = core.normalizeGraph(json);
core.findPaths(graph, "ext", "srv1", { mode: "prob", k: 3 });
```

---

## 拡張アイデア

### 1. 双方向エッジ

いまは有向グラフです。廊下のように双方向に通れる場所は、逆向きのエッジも足してください。`bidirectional: true`のような属性を足し、`buildAdjacency()`で逆向きの辺を作る形が考えられます。

### 2. 対策の組み合わせ

いまの「対策の効果」は1つ塞いだときと、すべての経路を断つ最小の組です。予算の範囲で2つ以上のノードのvulnを下げたときに、成功確率の1位を最も下げる組み合わせを探す（組み合わせ最適化）と、防御予算ゲームの答え合わせになります。

### 3. エッジ属性の拡張

```json
{ "source": "pc1", "target": "srv1", "weight": 1.2, "technique": "T1021", "protocol": "SSH" }
```

### 4. モンテカルロ法での検算

各ノードの突破を乱数で試し、成功の割合が`pathMetrics()`の成功確率に近づくことを確かめられます（開始ノードは数えない）。

```javascript
function simulate(path, nodes, trials = 10000) {
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    if (path.slice(1).every(i => Math.random() < nodes[i].vuln)) ok++;
  }
  return ok / trials;
}
```

---

## ライセンスと注意事項

本ツールはMIT Licenseで公開しています。D3.jsはISC Licenseです（`vendor/d3/LICENSE`）。

- 教育・検討の補助のためのツールです。実際の組織のセキュリティ評価の代わりにはなりません
- 実在する組織の詳しい構成や機密情報を入力しないでください

---

## 参考文献

- Jin Y. Yen, "Finding the K Shortest Loopless Paths in a Network," Management Science, Vol. 17, No. 11, pp. 712-716, 1971
- NIST SP 800-30 Rev. 1, "Guide for Conducting Risk Assessments," 2012
- [D3.js](https://d3js.org/)（[d3-force](https://d3js.org/d3-force)・[d3-zoom](https://d3js.org/d3-zoom)）
- [Content Security Policy - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
