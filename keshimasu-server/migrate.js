// keshimasu-server/migrate.js
// データベースのテーブル作成・カラム追加・初期問題の投入を行うスクリプト。
//
// 使い方:
//   node migrate.js
//   npm run migrate
//
// Render では Build Command に組み込むと、デプロイのたびに1回だけ実行されます。
//   例: npm install && npm run migrate

require('dotenv').config();

const db = require('./db');
const { runMigrations } = require('./init_db');

(async () => {
    console.log('マイグレーションを開始します。');

    await runMigrations();

    console.log('マイグレーションが完了しました。');
})()
    .then(async () => {
        await db.pool.end();
        process.exit(0);
    })
    .catch(async error => {
        console.error('マイグレーションに失敗しました。', {
            name: error.name,
            code: error.code
        });

        try {
            await db.pool.end();
        } catch {
            // 終了処理の失敗は無視する
        }

        process.exit(1);
    });