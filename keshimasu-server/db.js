// keshimasu-server/db.js

const { Pool } = require('pg');

// 必須環境変数を確認
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error(
        'DATABASE_URLが設定されていません。環境変数を確認してください。'
    );
}

// 接続文字列の形式だけを検証する
// URL、パスワード、ホスト名などはログに出力しない
try {
    new URL(connectionString);
} catch {
    throw new Error(
        'DATABASE_URLの形式が正しくありません。環境変数を確認してください。'
    );
}

// PostgreSQL接続プール
const pool = new Pool({
    connectionString,

    // NeonはSSL接続を使用する
    ssl: {
        rejectUnauthorized: false
    },

    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// アイドル中のDBクライアントで発生したエラーを処理
pool.on('error', (error) => {
    // 接続文字列やエラー全文はログへ出力しない
    console.error(
        'PostgreSQLプールで予期しないエラーが発生しました。',
        {
            name: error.name,
            code: error.code
        }
    );
});

// 接続確認
const checkConnection = async () => {
    try {
        await pool.query('SELECT 1');
        console.log('PostgreSQLへの接続を確認しました。');
    } catch (error) {
        // error.messageに接続情報が含まれる可能性があるため出力しない
        console.error(
            'PostgreSQLへの接続確認に失敗しました。',
            {
                name: error.name,
                code: error.code
            }
        );
    }
};

checkConnection();

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
