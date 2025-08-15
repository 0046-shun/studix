#!/usr/bin/env node

/**
 * バックアップスクリプト
 * データファイルとログファイルのバックアップを作成します
 */

const fs = require('fs');
const path = require('path');

const BACKUP_CONFIG = {
  sourceDir: path.join(__dirname, '..'),
  backupDir: path.join(__dirname, '..', '..', 'backups'),
  dataFiles: [
    'data/users.json',
    'data/products.json',
    'tantou/test-staff.json'
  ],
  logFiles: [
    'logs/audit.log'
  ],
  maxBackups: 10
};

function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_CONFIG.backupDir, `backup-${timestamp}`);
  
  try {
    // バックアップディレクトリを作成
    fs.mkdirSync(backupPath, { recursive: true });
    console.log(`バックアップディレクトリを作成: ${backupPath}`);
    
    // データファイルをコピー
    BACKUP_CONFIG.dataFiles.forEach(file => {
      const sourcePath = path.join(BACKUP_CONFIG.sourceDir, file);
      const destPath = path.join(backupPath, file);
      
      if (fs.existsSync(sourcePath)) {
        // ディレクトリを作成
        const destDir = path.dirname(destPath);
        fs.mkdirSync(destDir, { recursive: true });
        
        // ファイルをコピー
        fs.copyFileSync(sourcePath, destPath);
        console.log(`データファイルをバックアップ: ${file}`);
      } else {
        console.warn(`ファイルが存在しません: ${file}`);
      }
    });
    
    // ログファイルをコピー
    BACKUP_CONFIG.logFiles.forEach(file => {
      const sourcePath = path.join(BACKUP_CONFIG.sourceDir, file);
      const destPath = path.join(backupPath, file);
      
      if (fs.existsSync(sourcePath)) {
        // ディレクトリを作成
        const destDir = path.dirname(destPath);
        fs.mkdirSync(destDir, { recursive: true });
        
        // ファイルをコピー
        fs.copyFileSync(sourcePath, destPath);
        console.log(`ログファイルをバックアップ: ${file}`);
      } else {
        console.warn(`ファイルが存在しません: ${file}`);
      }
    });
    
    // バックアップ情報ファイルを作成
    const backupInfo = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      files: [...BACKUP_CONFIG.dataFiles, ...BACKUP_CONFIG.logFiles],
      sourceDir: BACKUP_CONFIG.sourceDir
    };
    
    fs.writeFileSync(
      path.join(backupPath, 'backup-info.json'),
      JSON.stringify(backupInfo, null, 2)
    );
    
    console.log('バックアップが完了しました');
    
    // 古いバックアップを削除
    cleanupOldBackups();
    
  } catch (error) {
    console.error('バックアップでエラーが発生しました:', error.message);
    process.exit(1);
  }
}

function cleanupOldBackups() {
  try {
    if (!fs.existsSync(BACKUP_CONFIG.backupDir)) return;
    
    const backups = fs.readdirSync(BACKUP_CONFIG.backupDir)
      .filter(dir => dir.startsWith('backup-'))
      .map(dir => ({
        name: dir,
        path: path.join(BACKUP_CONFIG.backupDir, dir),
        time: fs.statSync(path.join(BACKUP_CONFIG.backupDir, dir)).mtime
      }))
      .sort((a, b) => b.time - a.time);
    
    if (backups.length > BACKUP_CONFIG.maxBackups) {
      const toDelete = backups.slice(BACKUP_CONFIG.maxBackups);
      toDelete.forEach(backup => {
        try {
          fs.rmSync(backup.path, { recursive: true, force: true });
          console.log(`古いバックアップを削除: ${backup.name}`);
        } catch (error) {
          console.warn(`バックアップの削除に失敗: ${backup.name}`, error.message);
        }
      });
    }
  } catch (error) {
    console.warn('古いバックアップの削除でエラーが発生しました:', error.message);
  }
}

function listBackups() {
  try {
    if (!fs.existsSync(BACKUP_CONFIG.backupDir)) {
      console.log('バックアップディレクトリが存在しません');
      return;
    }
    
    const backups = fs.readdirSync(BACKUP_CONFIG.backupDir)
      .filter(dir => dir.startsWith('backup-'))
      .map(dir => {
        const backupPath = path.join(BACKUP_CONFIG.backupDir, dir);
        const stats = fs.statSync(backupPath);
        return {
          name: dir,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => b.created - a.created);
    
    console.log('利用可能なバックアップ:');
    backups.forEach((backup, index) => {
      console.log(`${index + 1}. ${backup.name}`);
      console.log(`   サイズ: ${(backup.size / 1024).toFixed(2)} KB`);
      console.log(`   作成日時: ${backup.created.toLocaleString('ja-JP')}`);
      console.log(`   更新日時: ${backup.modified.toLocaleString('ja-JP')}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('バックアップ一覧の取得でエラーが発生しました:', error.message);
  }
}

// メイン処理
const command = process.argv[2];

switch (command) {
  case 'create':
    createBackup();
    break;
  case 'list':
    listBackups();
    break;
  default:
    console.log('使用方法:');
    console.log('  node backup.js create  - バックアップを作成');
    console.log('  node backup.js list    - バックアップ一覧を表示');
    break;
}
