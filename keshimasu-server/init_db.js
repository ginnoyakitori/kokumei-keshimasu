// keshimasu-server/init_db.js
const db = require('./db');
// パスワード認証にbcryptを使用
const bcrypt = require('bcrypt');
const WORDS = require('./data/word_lists'); // 問題テスト用辞書

async function initializeDatabase() {
    console.log('データベース初期化を開始...');
    try {
        // UUID生成拡張機能の有効化 (PostgreSQLでのみ必要)
        await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        console.log('UUID拡張機能を有効化しました。');
        
        // 1. players テーブルの作成
        await db.query(`
            CREATE TABLE IF NOT EXISTS players (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                nickname VARCHAR(10) UNIQUE NOT NULL,
                passcode_hash VARCHAR(60) NOT NULL,
                country_clears INTEGER DEFAULT 0,
                capital_clears INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Table "players" created or already exists.');

        // 2. puzzles テーブルの作成
        await db.query(`
            CREATE TABLE IF NOT EXISTS puzzles (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                mode VARCHAR(10) NOT NULL, -- 'country' or 'capital'
                board_data JSONB NOT NULL, -- 8x5の盤面データをJSON形式で保存
                creator VARCHAR(10) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Table "puzzles" created or already exists.');

        // 3. テスト用問題の登録 (初回のみ)
        // 初めてゲームをデプロイした際、すぐに遊べるようにテスト問題があれば登録します。
        // 例: initialPuzzles.jsなどから読み込み、DBに存在しない場合のみ登録するロジックをここに記述します。

        console.log('🎉 データベース初期化が完了しました。');

    } catch (err) {
        console.error('❌ データベース初期化中にエラーが発生しました:', err.message);
        // エラーが発生してもプロセスを終了しない
    }
}

// サーバーファイルから呼び出す
module.exports = initializeDatabase;