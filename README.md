# コマノート (KomaNote)

iPad + Apple Pencil で漫画を描くための、必要最低限の機能に絞ったお絵かきアプリです。
ブラウザ(Safari)で動く Web アプリ(PWA)で、ホーム画面に追加するとアプリのように使えます。

## なぜ Web アプリ(PWA)なのか

- 開発環境に Xcode が無くてもビルド・動作確認ができる
- iPad の Safari は Pointer Events で Apple Pencil の筆圧(`pressure`)を取得できる
- 「ホーム画面に追加」で全画面のアプリとして起動でき、オフラインでも動く(Service Worker)
- 外部ライブラリなし・ビルド不要の素の HTML / CSS / JavaScript(ES Modules)

## 機能

| 分類 | 機能 |
| --- | --- |
| 原稿 | 用紙サイズのプリセット(B4投稿 / A4 / B5同人誌 / A5 / Webtoon縦読み / カスタム)、解像度(150/200/300dpi)、裁ち切り・仕上がり・基本枠ガイド |
| ページ | ページの追加・複製・削除・並べ替え、サムネイル一覧 |
| 描画 | 筆圧対応ペン、消しゴム、塗りつぶし(ベタ・グレー・網点トーン)、色とブラシサイズ |
| レイヤー | 追加・削除・表示切替・不透明度・並べ替え、下書き用の青レイヤー |
| コマ割り | 基本枠テンプレート、ドラッグで枠作成、線を引いてコマを分割(間隔は自動)、頂点の移動、コマの削除、枠線の太さ、コマ外マスク |
| テキスト | 縦書き/横書き、フォント(明朝/ゴシック/丸ゴシック)、文字サイズ、吹き出し(楕円・角丸・雲・トゲ)としっぽ |
| 編集 | 取り消し/やり直し、選択ツールで移動・拡大縮小 |
| 操作 | ピンチで拡大縮小・2本指で移動、2本指タップで取り消し、3本指タップでやり直し、Pencil のみで描画(指は移動用) |
| 保存 | 端末内(IndexedDB)へ自動保存、作品一覧、PNG 書き出し(ページ単位/全ページ)、作品ファイル(.komanote)の書き出し・読み込み |

## 使い方(開発時)

```bash
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開きます。iPad から試す場合は同じ Wi-Fi で Mac の IP アドレスにアクセスしてください
(Service Worker によるオフライン動作は HTTPS か localhost のときのみ有効です)。

## ディレクトリ構成

```
index.html              画面の骨組み
manifest.webmanifest    PWA の設定
sw.js                   オフライン用 Service Worker
css/style.css           スタイル
js/main.js              起動・画面の切り替え
js/model.js             作品データ(原稿・ページ・レイヤー・コマ・テキスト)
js/paper.js             用紙サイズのプリセット
js/editor.js            エディタ本体(描画・入力・ツール)
js/geometry.js          コマ分割などの幾何計算
js/text.js              縦書き/横書きテキストと吹き出しの描画
js/fill.js              塗りつぶし・トーン
js/history.js           取り消し/やり直し
js/storage.js           IndexedDB への保存
js/export.js            PNG・作品ファイルの書き出し
docs/DEVLOG.md          開発作業の記録
```

## 開発の進め方

- `main` ブランチは常に動く状態を保つ
- 機能ごとに `feature/〇〇` ブランチを切って作業し、`--no-ff` でマージする
- 作業内容は [docs/DEVLOG.md](docs/DEVLOG.md) に記録していく
