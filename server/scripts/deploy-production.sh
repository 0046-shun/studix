#!/bin/bash

# 本番環境展開スクリプト
# 使用方法: ./scripts/deploy-production.sh [environment]
# 例: ./scripts/deploy-production.sh production

set -e  # エラー時に停止

# 色付き出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 環境変数
ENVIRONMENT=${1:-production}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log_info "本番環境展開を開始します..."
log_info "環境: $ENVIRONMENT"
log_info "プロジェクトルート: $PROJECT_ROOT"

# 事前チェック
check_prerequisites() {
    log_info "事前チェックを実行中..."
    
    # Docker チェック
    if ! command -v docker &> /dev/null; then
        log_error "Docker がインストールされていません"
        exit 1
    fi
    
    # Docker Compose チェック
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose がインストールされていません"
        exit 1
    fi
    
    # 設定ファイルチェック
    if [ ! -f "$PROJECT_ROOT/config.production.js" ]; then
        log_error "config.production.js が見つかりません"
        exit 1
    fi
    
    # 環境変数ファイルチェック
    if [ ! -f "$PROJECT_ROOT/.env.production" ]; then
        log_warning ".env.production が見つかりません。テンプレートから作成します"
        if [ -f "$PROJECT_ROOT/.env.production.template" ]; then
            cp "$PROJECT_ROOT/.env.production.template" "$PROJECT_ROOT/.env.production"
            log_info ".env.production を作成しました。値を設定してください"
            exit 1
        else
            log_error ".env.production.template も見つかりません"
            exit 1
        fi
    fi
    
    log_success "事前チェック完了"
}

# セキュリティチェック
security_check() {
    log_info "セキュリティチェックを実行中..."
    
    # JWT_SECRET チェック
    if grep -q "dev-secret-key-change-in-production" "$PROJECT_ROOT/.env.production"; then
        log_error "JWT_SECRET がデフォルト値のままです。本番環境用の値に変更してください"
        exit 1
    fi
    
    # 環境変数チェック
    required_vars=("JWT_SECRET" "SHEET_ID_ORDERS" "SHEET_ID_REQUESTS" "CORS_ORIGIN")
    for var in "${required_vars[@]}"; do
        if ! grep -q "^$var=" "$PROJECT_ROOT/.env.production"; then
            log_error "必須環境変数 $var が設定されていません"
            exit 1
        fi
    done
    
    log_success "セキュリティチェック完了"
}

# Dockerイメージビルド
build_image() {
    log_info "Dockerイメージをビルド中..."
    
    cd "$PROJECT_ROOT"
    
    # 既存のイメージを削除
    if docker images | grep -q "studix-server"; then
        log_info "既存のイメージを削除中..."
        docker rmi $(docker images | grep "studix-server" | awk '{print $3}') || true
    fi
    
    # 新しいイメージをビルド
    docker build -f Dockerfile -t studix-server:production .
    
    if [ $? -eq 0 ]; then
        log_success "Dockerイメージビルド完了"
    else
        log_error "Dockerイメージビルドに失敗しました"
        exit 1
    fi
}

# サービス起動
start_services() {
    log_info "サービスを起動中..."
    
    cd "$PROJECT_ROOT"
    
    # 既存のサービスを停止
    if docker-compose -f docker-compose.production.yml ps | grep -q "Up"; then
        log_info "既存のサービスを停止中..."
        docker-compose -f docker-compose.production.yml down
    fi
    
    # サービス起動
    docker-compose -f docker-compose.production.yml up -d
    
    if [ $? -eq 0 ]; then
        log_success "サービス起動完了"
    else
        log_error "サービス起動に失敗しました"
        exit 1
    fi
    
    # サービス状態確認
    log_info "サービス状態を確認中..."
    docker-compose -f docker-compose.production.yml ps
}

# ヘルスチェック
health_check() {
    log_info "ヘルスチェックを実行中..."
    
    # アプリケーションの起動待機
    log_info "アプリケーションの起動を待機中..."
    sleep 30
    
    # ヘルスチェック
    local max_attempts=10
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        log_info "ヘルスチェック試行 $attempt/$max_attempts"
        
        if curl -f -s http://localhost:3000/api/v1/health > /dev/null; then
            log_success "アプリケーションが正常に起動しました"
            break
        else
            if [ $attempt -eq $max_attempts ]; then
                log_error "ヘルスチェックに失敗しました"
                log_info "ログを確認してください:"
                docker-compose -f docker-compose.production.yml logs app
                exit 1
            fi
            log_warning "アプリケーションがまだ起動していません。10秒待機..."
            sleep 10
            attempt=$((attempt + 1))
        fi
    done
}

# 監視設定
setup_monitoring() {
    log_info "監視設定を確認中..."
    
    # Prometheus 状態確認
    if curl -f -s http://localhost:9090/-/healthy > /dev/null; then
        log_success "Prometheus が正常に動作しています"
    else
        log_warning "Prometheus が正常に動作していません"
    fi
    
    # Grafana 状態確認
    if curl -f -s http://localhost:3001/api/health > /dev/null; then
        log_success "Grafana が正常に動作しています"
    else
        log_warning "Grafana が正常に動作していません"
    fi
}

# バックアップ設定
setup_backup() {
    log_info "バックアップ設定を確認中..."
    
    # バックアップディレクトリ作成
    sudo mkdir -p /var/backups/studix
    sudo chown $USER:$USER /var/backups/studix
    
    # 初回バックアップ実行
    log_info "初回バックアップを実行中..."
    docker-compose -f docker-compose.production.yml exec -T backup /scripts/backup.js create || log_warning "バックアップの実行に失敗しました"
}

# メイン処理
main() {
    log_info "=== Studix 本番環境展開スクリプト ==="
    
    # 事前チェック
    check_prerequisites
    
    # セキュリティチェック
    security_check
    
    # Dockerイメージビルド
    build_image
    
    # サービス起動
    start_services
    
    # ヘルスチェック
    health_check
    
    # 監視設定
    setup_monitoring
    
    # バックアップ設定
    setup_backup
    
    log_success "=== 本番環境展開が完了しました ==="
    log_info "以下のURLでアクセスできます:"
    log_info "- アプリケーション: http://localhost:3000"
    log_info "- Prometheus: http://localhost:9090"
    log_info "- Grafana: http://localhost:3001"
    log_info ""
    log_info "次のステップ:"
    log_info "1. ドメインとSSL証明書の設定"
    log_info "2. ファイアウォール設定"
    log_info "3. 監視ダッシュボードの設定"
    log_info "4. アラート設定"
}

# スクリプト実行
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
