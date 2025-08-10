// Jest セットアップファイル
// テスト環境の共通設定

// テストタイムアウトを設定
jest.setTimeout(10000);

// 未処理のPromise rejectionをキャッチ
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// 未処理の例外をキャッチ
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// テスト後のクリーンアップ
afterAll(async () => {
  // 必要に応じてクリーンアップ処理を追加
  await new Promise(resolve => setTimeout(resolve, 100));
});

// グローバルテストヘルパー
global.testHelpers = {
  // テスト用のモックデータ
  mockOrderData: {
    customer_name: "テスト顧客",
    product_category: "基礎関連",
    product_name: "基礎40cm",
    quantity: 10,
    unit_price: 1000,
    total_price: 10000,
    district_code: "001",
    department_code: "A01",
    transfer_name: "テスト担当者"
  },
  
  mockRequestData: {
    request_text: "テスト要望内容",
    district_code: "001",
    department_code: "A01",
    transfer_name: "テスト担当者"
  },
  
  // テスト用のユーザーデータ
  mockUserData: {
    username: "testuser",
    email: "test@example.com",
    role: "user",
    status: "active"
  }
};
