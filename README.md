# 単語帳 OCR コンバーター (Flashcard OCR Converter)

[cite_start]物理的な単語帳やその画像・PDFを処理し、光学文字認識（OCR）を使用してテキストを抽出し、Anki互換のCSVファイルとして出力するWebアプリケーションです [cite: 3]。

## ✨ 主な機能

* [cite_start]**ファイルアップロード**: 画像（PNG、JPG）およびPDFのドラッグ＆ドロップまたはファイル選択に対応しています [cite: 3]。
* [cite_start]**PDF対応**: PDFがアップロードされた場合、フロントエンドで `pdf.js` を使用して各ページをレンダリングし、画像データ (`image/png`) に変換してからバックエンドへ送信します [cite: 3]。
* [cite_start]**高度なOCR処理**: PaddleOCRとOpenCVを組み合わせた高精度なテキスト抽出と画像の前処理を行います [cite: 3]。
* [cite_start]**データ編集・エクスポート**: 抽出された単語や説明の編集、OCR信頼度スコアの確認、誤ったペアの削除などが可能なインタラクティブなテーブルを備え、最終的なデータをAnki用CSVとしてダウンロードできます [cite: 3]。

## 🏗️ システムアーキテクチャ

### フロントエンド
* [cite_start]**技術スタック**: React (v18.2.0), Tailwind CSS [cite: 3]
* [cite_start]**特徴**: モダンで使いやすいUIを提供し、PDFファイルのクライアントサイドレンダリング処理を担当します [cite: 3]。

### バックエンド
* [cite_start]**技術スタック**: Python (サーバーレスAPI), PaddleOCR (v2.7.0.3), OpenCV (`opencv-python` v4.8.0.74) [cite: 3]
* **処理フロー (`api/ocr.py`)**:
  * [cite_start]Base64画像データを含むPOSTリクエストを受信します [cite: 3]。
  * [cite_start]**レイアウト分析**: OpenCVを使用して画像をグレースケール化し、二値化処理を適用。垂直方向の空白を検出して、画像を左カラム（単語）と右カラム（説明）に分割します [cite: 4]。
  * [cite_start]**フォールバックロジック**: カラム分割に失敗した場合は、短いアルファベットベースの単語とそれに続くテキスト文字列をペアリングする簡略化された抽出メソッドに自動で切り替わります [cite: 4]。

## 🚀 デプロイメント

[cite_start]このプロジェクトは **Vercel** へのデプロイを前提に構成されています [cite: 4]。

[cite_start]PaddleOCRやOpenCVを用いた高度な画像処理要件に対応するため、`vercel.json` にて以下のリソース設定を行っています [cite: 4]：
* **対象関数**: `api/ocr.py`
* [cite_start]**最大実行時間**: 300秒 [cite: 4]
* [cite_start]**メモリ割り当て**: 3008 MB [cite: 4]