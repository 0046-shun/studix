# Studix API Server

Orders/Requests を Google Sheets に転記する最小APIサーバーです（エミュレーション対応）。

## 要件
- Node.js 18+

## セットアップ
```
cd server
npm install
```

## 実行
```
npm start
```
- デフォルト: `http://localhost:3000`
- ヘルスチェック: `GET /api/v1/health`

## 環境変数
- `PORT`（任意）: ポート番号（デフォルト 3000）
- `GOOGLE_SHEETS_EMULATE`（任意）: `true` でローカルCSVへ追記（デフォルト: true）
- 実運用でGoogle Sheetsを使用する場合:
  - `GOOGLE_APPLICATION_CREDENTIALS`: サービスアカウントJSONへのパス
  - `SHEET_ID_ORDERS`: Orders Sheet のスプレッドシートID
  - `SHEET_ID_REQUESTS`: Requests Sheet のスプレッドシートID

## エンドポイント（抜粋）
- `POST /api/v1/orders/sheets` — 受注データを転記
- `POST /api/v1/requests/sheets` — 要望データを転記（空欄は400）

## 監査ログ
- `server/logs/audit.log` にJSONラインで追記

## リトライ方針
- 失敗時に指数バックオフ（0.5s, 1s, 2s）で最大3回再試行

## エミュレーション
- デフォルトで `server/data/orders.csv` / `server/data/requests.csv` に行追記します。
- 実環境でSheetsに転記する場合は `GOOGLE_SHEETS_EMULATE=false` とし、各ID/認証を設定してください。
