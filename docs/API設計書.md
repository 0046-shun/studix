# API設計書

| 版数 | 日付 | 作成者 | 変更内容 |
|------|------|--------|----------|
| 1.0 | 2025-08-09 | API設計担当 | 初版作成（Orders/Requests Sheets 転記API、検索系、認証・ユーザー管理を定義） |

## 1. 概要
- 対象: 受注入力フォームシステムのサーバーサイドAPI
- 目的: フロントエンドとバックエンド間の契約（Contract）を明確化し、実装一貫性と将来拡張性を担保
- 参照資料: `docs/要件定義.md` v2.4、`docs/システムアーキテクチャ設計書.md` v1.2、`docs/データモデル設計書.md` v1.0
- ベースURL: `/api/v1`

## 2. 認証・認可
- 認証方式: JWT（Bearer Token）
- 取得: `POST /api/v1/auth/login`
- 送信: `Authorization: Bearer <token>`
- セキュリティ要件:
  - HTTPS 必須、CORS 設定（社内オリジン限定）
  - レート制限（標準: 60 req/min/ユーザー）
  - セキュリティヘッダー（CSP、X-Content-Type-Options 等）
- 認可: RBAC（`office`/`admin`）

## 3. 共通仕様
- 共通ヘッダー
  - `Authorization: Bearer <token>`（必要時）
  - `Content-Type: application/json`
- 共通レスポンス
  - 成功: `200 OK`／`201 Created` 等、`{ "success": true, "data": ... }`
  - エラー: 統一形式（後述）
- ページング: `page`（1始まり）, `limit`（デフォルト20, 最大100）
- 日時: ISO 8601（UTC、アプリ側でTZ補正）

## 4. エンドポイント一覧
- 認証
  - `POST /api/v1/auth/login`（ログイン）
  - `POST /api/v1/auth/logout`（ログアウト）
  - `GET  /api/v1/auth/me`（自分の情報）
- 受注・要望（Google Sheets 連携）
  - `POST /api/v1/orders/sheets`（Orders Sheetへ転記）
  - `POST /api/v1/requests/sheets`（Requests Sheetへ転記）
- マスタ・検索
  - `GET  /api/v1/products/search`（商品検索）
  - `POST /api/v1/products/calculate-price`（価格計算）
  - `GET  /api/v1/employees/search`（担当者検索）
- ユーザー管理（admin）
  - `GET  /api/v1/users`
  - `GET  /api/v1/users/{id}`
  - `POST /api/v1/users`
  - `PUT  /api/v1/users/{id}`
  - `PATCH /api/v1/users/{id}`
  - `DELETE /api/v1/users/{id}`

## 5. エンドポイント詳細
### 5.1 認証
#### POST /api/v1/auth/login
- 概要: ユーザー認証しJWTを発行
- リクエスト
```json
{
  "loginId": "user@example.com",
  "password": "string"
}
```
- レスポンス 200
```json
{
  "success": true,
  "data": {
    "token": "jwt-token",
    "user": { "id": "uuid", "name": "氏名", "role": "office" }
  }
}
```
- 401: 認証失敗

#### GET /api/v1/auth/me
- 概要: 自ユーザー情報の取得
- 認証: 必須
- レスポンス 200: `user` 情報

### 5.2 Orders Sheet 転記
#### POST /api/v1/orders/sheets
- 概要: 受注データをGoogle Orders Sheetに1行追加（要件 REQ-F-006）
- 認証: 必須（`office`以上）
- リクエスト
```json
{
  "order": {
    "reception_date": "2025-08-08",
    "greeting_time": "10:30:00",
    "customer": { "name": "山田 太郎", "age": 45, "phone_fixed": "092-xxx", "phone_mobile": "090-xxx" },
    "items": [
      { "product_name": "外基礎", "quantity": 12, "unit": "㎡", "amount_ex_tax": 137500 }
    ],
    "contract_date": "2025-08-20",
    "construction": { "start_date": "2025-08-25", "time_slot": "午後", "end_date": "2025-08-26" },
    "payment_method": "cash",
    "reception_staff": "佐藤",
    "flyer": "A",
    "estimate_no": "EST-001",
    "other_company": 0,
    "history": 0,
    "current": 137500,
    "total_history": 137500,
    "trigger": 1,
    "remarks": "備考など"
  },
  "staff": {
    "district_code": "511",
    "department_code": "123",
    "display_name": "山田"
  }
}
```
- レスポンス 200
```json
{ "success": true }
```
- 502/504: 外部API失敗（再送方針あり）

### 5.3 Requests Sheet 転記
#### POST /api/v1/requests/sheets
- 概要: 要望欄が空でない場合、要望をRequests Sheetへ追加（REQ-F-015）
- 認証: 必須（`office`以上）
- リクエスト
```json
{
  "request_text": "価格表の配布希望",
  "staff": {
    "district_code": "511",
    "department_code": "123",
    "display_name": "山田"
  },
  "created_at": "2025-08-09T09:00:00Z"
}
```
- レスポンス 200
```json
{ "success": true }
```
- 400: `request_text` 未指定/空

### 5.4 商品検索・価格計算
#### GET /api/v1/products/search
- 概要: カテゴリ/名称で商品を検索（UIの連動セレクト用）
- 認証: 必須
- パラメータ: `category_division?`, `category_1?`, `category_2?`, `product_name?`, `limit?`, `page?`
- レスポンス 200
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "product_id": "uuid",
        "category_division": "基礎関連",
        "category_1": "外基礎",
        "category_2": null,
        "product_name": "外基礎30cm",
        "quantity_unit": "㎡",
        "tax_rate": 0.1
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
  }
}
```

#### POST /api/v1/products/calculate-price
- 概要: 基本数量・超過単価・割引・基礎高さ等を考慮して試算（要件 REQ-F-004 準拠の簡易版）
- 認証: 必須
- リクエスト
```json
{ "product_id": "uuid", "quantity": 15, "height_cm": 40 }
```
- レスポンス 200
```json
{
  "success": true,
  "data": {
    "basic_amount": 100000,
    "excess_amount": 25000,
    "subtotal": 125000,
    "tax_amount": 12500,
    "total": 137500,
    "detail": {
      "basic_quantity": 10,
      "excess_quantity": 5,
      "unit_price": 5000,
      "tax_rate": 0.1
    }
  }
}
```

### 5.5 担当者検索
#### GET /api/v1/employees/search
- 概要: 実データ約300名の担当者検索（REQ-F-002）
- 認証: 必須
- パラメータ: `name_kana?`, `district_code?`, `department_code?`, `limit?`, `page?`
- レスポンス 200: 該当社員リスト（`display_last_name` を含む）

### 5.6 ユーザー管理（admin）
- 概要: アカウント管理（REQ-F-014）
- 認証: 必須（`admin`）
- バリデーション: `loginId` 一意、パスワード強度、ロール/状態制約
- 各CRUDの標準的なリクエスト/レスポンスを適用

## 6. データモデル（APIスキーマ）
- 共通型
```json
{
  "Staff": {
    "district_code": "string",  
    "department_code": "string",
    "display_name": "string"
  },
  "OrderItem": {
    "product_name": "string",
    "quantity": 0,
    "unit": "string",
    "amount_ex_tax": 0
  }
}
```
- 受注転記 `order` は `docs/データモデル設計書.md` の `ORDER_DATA`/`ORDER_ITEMS` に準拠

## 7. エラーハンドリング
- 統一フォーマット
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力値に誤りがあります",
    "details": { "field": "quantity", "message": "1以上で指定" }
  }
}
```
- 主なエラーコード
  - `AUTH_REQUIRED` 401、`FORBIDDEN` 403、`NOT_FOUND` 404
  - `VALIDATION_ERROR` 400、`RATE_LIMITED` 429
  - `EXTERNAL_SERVICE_ERROR` 502、`TIMEOUT` 504

## 8. 非機能要件対応
- パフォーマンス: レスポンス3秒以内、キャッシュ（商品/統計）
- 可用性: サーキットブレーカー（Sheets連携）、リトライ with ジッター
- レート制限: 60 req/min/ユーザー、管理APIは30 req/min
- 監査: 重要操作（ユーザー管理、転記結果）を監査ログ出力

## 9. バージョニング
- URLにバージョンを付与（`/api/v1`）。破壊的変更時は `/api/v2` を新設

## 10. 変更履歴
- 1.0（2025-08-09）: 初版（主要エンドポイント定義、エラーフォーマット、非機能対応）
