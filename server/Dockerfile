# 本番環境用Dockerfile
# マルチステージビルドでセキュリティとパフォーマンスを最適化

# ビルドステージ
FROM node:18-alpine AS builder

# 作業ディレクトリを設定
WORKDIR /app

# パッケージファイルをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --only=production && npm cache clean --force

# ソースコードをコピー
COPY . .

# 本番環境用の設定ファイルをコピー
COPY config.production.js ./config.js

# 本番ステージ
FROM node:18-alpine AS production

# セキュリティ強化：非rootユーザーを作成
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 作業ディレクトリを設定
WORKDIR /app

# 本番環境用の設定ファイルをコピー
COPY --from=builder /app/config.js ./

# 依存関係をコピー
COPY --from=builder /app/node_modules ./node_modules

# ソースコードをコピー
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# ログディレクトリを作成
RUN mkdir -p /app/logs /var/log/studix /var/backups/studix && \
    chown -R nodejs:nodejs /app /var/log/studix /var/backups/studix

# 非rootユーザーに切り替え
USER nodejs

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# ポートを公開
EXPOSE 3000

# 環境変数を設定
ENV NODE_ENV=production
ENV PORT=3000

# アプリケーションを起動
CMD ["node", "src/server.js"]
