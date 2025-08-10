module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // UNCパス対応
  roots: ['<rootDir>'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  // テスト実行時の詳細ログ
  verbose: true,
  // テストの並列実行を無効化
  maxWorkers: 1,
  // テスト終了後のクリーンアップ
  forceExit: true,
  // ハンドル検出
  detectOpenHandles: true
};
