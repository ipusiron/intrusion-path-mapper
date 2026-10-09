/* Intrusion Path Mapper - 画面の文言（日本語・英語）
   main.js は t(key, params) でここから引く。{name} は params の値に置き換わる。
*/

export const MESSAGES = {
  ja: {
    "notify.loaded": "読み込み完了",
    "notify.detail": "ノード: {nodes}個、エッジ: {edges}個",
    "notify.close": "通知を閉じる",

    "results.emptyTitle": "経路を探索していません",
    "results.emptyHint": "上記の設定を行い、「経路を探索」ボタンを押してください",
    "results.none": "到達できる経路がありません",
    "results.noneProb": "成功確率が0より大きい経路がありません（vuln が0のノードは通れません）",
    "results.summary": "{count}本の経路を見つけました（{mode}）",
    "results.prob": "成功確率",
    "results.risk": "リスク",
    "results.cost": "コスト",
    "results.hops": "{n}手",
    "results.play": "経路 #{n} をアニメーション再生",
    "results.select": "経路 #{n} を選ぶ",
    "mode.prob": "成功確率の高い順",
    "mode.cost": "コストの低い順",

    "info.empty": "（ノードをクリック）",
    "info.id": "ID",
    "info.label": "ラベル",
    "info.labelEn": "英語ラベル",
    "info.type": "種類",
    "info.vuln": "vuln",
    "info.importance": "importance",
    "info.setStart": "開始にする",
    "info.setGoal": "目標にする",
    "info.edit": "ノードを編集",
    "info.delete": "ノードを削除",

    "dialog.addTitle": "ノード追加",
    "dialog.editTitle": "ノード編集",

    "err.selectEndpoints": "開始と目標に別々のノードを選んでください",
    "err.idPattern": "ID は英数字・アンダースコア・ハイフンの1〜100文字にしてください",
    "err.idExists": "この ID はすでに使われています",
    "err.labelTooLong": "ラベルは200文字以内にしてください",
    "err.needTwoNodes": "エッジを追加するには、ノードが2つ以上必要です",
    "err.sameNode": "同じノードへのエッジは作れません",
    "err.edgeExists": "同じ向きのエッジがすでにあります",
    "err.weight": "weight は0以上の数にしてください",
    "err.selectPreset": "プリセットを選んでください",
    "err.presetLoad": "プリセットの読み込みに失敗しました",
    "err.importFailed": "読み込めませんでした: {reason}",

    "confirm.deleteNode": "ノード「{label}」を削除しますか？",

    "graph.notObject": "JSON のオブジェクトではありません",
    "graph.notArrays": "nodes と edges は配列にしてください",
    "graph.noNodes": "ノードが1つもありません",
    "graph.tooManyNodes": "ノードが多すぎます（最大{max}）",
    "graph.tooManyEdges": "エッジが多すぎます（最大{max}）",
    "graph.badNode": "{index}番目のノードがオブジェクトではありません",
    "graph.badNodeId": "{index}番目のノードの ID が不正です（英数字・_・- の1〜{max}文字）",
    "graph.duplicateNodeId": "ノードの ID「{id}」が重複しています",
    "graph.labelTooLong": "ノード「{id}」のラベルが長すぎます（最大{max}文字）",
    "graph.badEdge": "{index}番目のエッジがオブジェクトではありません",
    "graph.invalidJson": "JSON として読めません",
    "graph.fileTooLarge": "ファイルが大きすぎます（最大{mb}MB）",

    "warn.summary": "{title} を読み込みました。直した箇所が{count}件あります: {list}",
    "warn.typeReplaced": "種類を node にした",
    "warn.valueAdjusted": "vuln・importance を0〜1に直した",
    "warn.labelEnDropped": "英語ラベルを捨てた",
    "warn.colorDropped": "色を捨てた",
    "warn.weightDefault": "weight を1にした",
    "warn.weightClamped": "負の weight を0にした",
    "warn.edgesUnknownNode": "存在しないノードへのエッジを捨てた",
    "warn.edgesSelfLoop": "自分自身へのエッジを捨てた",
    "warn.edgesDuplicate": "重複したエッジを捨てた",

    "fallback.title": "最小のマップ",
    "fallback.ext": "外部",
    "fallback.pc": "社員PC",
    "fallback.srv": "ファイルサーバー"
  }
};
