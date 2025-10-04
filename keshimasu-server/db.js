// keshimasu-server/db.js
const { Pool } = require('pg');

// dotenvがロードされていることを前提とします（server.jsで実行）

// 環境変数から接続情報を取得
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // 本番環境（production）でのSSL接続設定
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 接続テスト
pool.query('SELECT NOW()')
    .then(res => console.log('✅ PostgreSQL接続成功:', res.rows[0].now))
    .catch(err => console.error('❌ PostgreSQL接続エラー:', err.message));

module.exports = {
    // クエリ実行のラッパー関数
    query: (text, params) => pool.query(text, params),
};