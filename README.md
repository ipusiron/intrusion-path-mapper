<!--
---
title: Intrusion Path Mapper
category: attack-path
difficulty: 2
description: Interactive tool to simulate and visualize intrusion paths in simplified facility or network maps. Built with D3.js, runs entirely client-side.
tags: [attack-path, visualization, d3, education, javascript]
demo: https://ipusiron.github.io/intrusion-path-mapper/
---
-->

# Intrusion Path Mapper – 侵入経路マッピングツール

![GitHub Repo stars](https://img.shields.io/github/stars/ipusiron/intrusion-path-mapper?style=social)
![GitHub forks](https://img.shields.io/github/forks/ipusiron/intrusion-path-mapper?style=social)
![GitHub last commit](https://img.shields.io/github/last-commit/ipusiron/intrusion-path-mapper)
![GitHub license](https://img.shields.io/github/license/ipusiron/intrusion-path-mapper)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-blue)](https://ipusiron.github.io/intrusion-path-mapper/)

**Day083 - 生成AIで作るセキュリティツール100**

**Intrusion Path Mapper** は、建物やネットワークの簡易マップを入力し、ブラウザ上で攻撃者の「侵入経路」をシミュレーション・可視化する教育用ツールです。

- **完全クライアントサイド** なので、データはブラウザ内のみで処理され、外部に送信されません。
- **D3.js** によるインタラクティブなグラフ描画。
- **最短経路探索 (Dijkstra)** を利用し、脆弱性スコアや重要度を考慮した侵入経路を推定。
- 結果はSVGグラフ上でハイライト表示され、JSON形式でインポート/エクスポート可能。

---

## 🌐 デモページ

👉 **[https://ipusiron.github.io/intrusion-path-mapper/](https://ipusiron.github.io/intrusion-path-mapper/)**

ブラウザーで直接お試しいただけます。

---

## 📸 スクリーンショット

>![ダミー](assets/screenshot.png)
>*ダミー*
---

## 使い方

1. **ノードとエッジを含むJSONファイル** をインポートする  
   - ノード: `id`, `label`, `type`, `vuln`, `importance`  
   - エッジ: `source`, `target`, `weight`  
   - サンプル: [sample-facility.json](./sample-data/sample-facility.json)

2. サイドバーから **初期侵入点** と **攻撃目標ノード** を選択する  

3. 「最短経路を探索」ボタンを押すと、推定された攻撃経路が強調表示される  

4. 必要に応じて、編集したデータを **JSON エクスポート** できる  

---

## JSONフォーマット例

```json
{
  "nodes": [
    { "id": "ext",  "type": "gateway", "label": "外部", "vuln": 0.3, "importance": 0.1 },
    { "id": "srv1", "type": "server",  "label": "ファイルサーバ", "vuln": 0.5, "importance": 0.9 }
  ],
  "edges": [
    { "source": "ext", "target": "srv1", "weight": 1.2 }
  ],
  "attack_goals": ["srv1"]
}
```

---

## 注意事項

- 本ツールは教育・デモ目的であり、実運用環境でのセキュリティ評価を代替するものではありません。
- 実際の組織・施設・ネットワークを入力する場合は、機密情報を含めないようご注意ください。
- GitHub Pages上ではすべての処理がブラウザー内で完結し、データは保存されません。

---

## 📁 ディレクトリー構成

```
```

---

## 📄 ライセンス

MIT License – 詳細は [LICENSE](LICENSE) を参照してください。

---

## 🛠 このツールについて

本ツールは、「生成AIで作るセキュリティツール100」プロジェクトの一環として開発されました。
このプロジェクトでは、AIの支援を活用しながら、セキュリティに関連するさまざまなツールを100日間にわたり制作・公開していく取り組みを行っています。

プロジェクトの詳細や他のツールについては、以下のページをご覧ください。

🔗 [https://akademeia.info/?page_id=42163](https://akademeia.info/?page_id=42163)
