// ----------------------------------------------------
// Node.js (Express) サーバーコード - server.js (データベース永続化版)
// ----------------------------------------------------
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQLクライアントをインポート
const app = express();

const PORT = process.env.PORT || 3000; 

// RenderのPostgreSQLデータベース接続設定
// DATABASE_URLはRenderの環境変数として設定してください
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false // Render環境でのSSL設定
});

app.use(cors()); 
app.use(express.json()); 

// ----------------------------------------------------
// データベース初期化
// ----------------------------------------------------
async function initializeDatabase() {
    try {
        const client = await pool.connect();
        
        // プレイヤーテーブルが存在しない場合、作成する
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                nickname VARCHAR(10) UNIQUE NOT NULL,
                country_clears INTEGER DEFAULT 0,
                capital_clears INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await client.query(createTableQuery);
        console.log("✅ データベース接続およびテーブル作成に成功しました。");
        client.release();
        
    } catch (err) {
        console.error("❌ データベースの初期化エラー:", err);
    }
}


// ----------------------------------------------------
// 1. 認証/登録API: POST /api/player/register
// ----------------------------------------------------
app.post('/api/player/register', async (req, res) => {
    const { nickname } = req.body;
    if (!nickname) {
        return res.status(400).json({ message: "ニックネームが必要です。" });
    }

    try {
        // ニックネームでプレイヤーを検索
        let result = await pool.query('SELECT * FROM players WHERE nickname = $1', [nickname]);
        let player = result.rows[0];

        if (!player) {
            // 新規登録
            const insertQuery = `
                INSERT INTO players (nickname)
                VALUES ($1)
                RETURNING id, nickname, country_clears, capital_clears
            `;
            result = await pool.query(insertQuery, [nickname]);
            player = result.rows[0];
            console.log(`新規プレイヤー登録: ID${player.id}, ${nickname}`);
        } else {
            console.log(`既存プレイヤー識別: ID${player.id}, ${nickname}`);
        }

        res.json({ 
            message: "プレイヤー情報取得成功",
            player: {
                id: player.id,
                nickname: player.nickname,
                country_clears: player.country_clears,
                capital_clears: player.capital_clears
            }
        });
    } catch (error) {
        console.error("プレイヤー登録/取得エラー:", error);
        res.status(500).json({ message: "サーバーエラーが発生しました。" });
    }
});


// ----------------------------------------------------
// 2. スコア更新API: POST /api/score/update
// ----------------------------------------------------
app.post('/api/score/update', async (req, res) => {
    const { playerId, mode } = req.body;
    
    if (!playerId || !['country', 'capital'].includes(mode)) {
        return res.status(400).json({ message: "無効なリクエストです。" });
    }
    
    const scoreKey = mode + '_clears';
    
    try {
        // スコアをインクリメントして更新
        const updateQuery = `
            UPDATE players
            SET ${scoreKey} = ${scoreKey} + 1, last_updated = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING ${scoreKey}
        `;
        const result = await pool.query(updateQuery, [playerId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: "プレイヤーが見つかりません。" });
        }

        const newScore = result.rows[0][scoreKey];
        console.log(`スコア更新: ID${playerId} (${mode}: ${newScore})`);

        res.json({ message: "スコア更新成功", newScore });
    } catch (error) {
        console.error("スコア更新エラー:", error);
        res.status(500).json({ message: "サーバーエラーが発生しました。" });
    }
});


// ----------------------------------------------------
// 3. ランキング取得API: GET /api/rankings/:type
// ----------------------------------------------------
app.get('/api/rankings/:type', async (req, res) => {
    const type = req.params.type;
    let orderByClause = '';

    if (type === 'total') {
        orderByClause = '(country_clears + capital_clears) DESC';
    } else if (type === 'country' || type === 'capital') {
        const key = type + '_clears';
        orderByClause = `${key} DESC`;
    } else {
        return res.status(400).json({ message: "無効なランキングタイプです。" });
    }

    try {
        const selectQuery = `
            SELECT 
                nickname, 
                country_clears, 
                capital_clears,
                (country_clears + capital_clears) as total_clears
            FROM players 
            WHERE nickname != 'ゲスト'
            ORDER BY ${orderByClause}, last_updated ASC
            LIMIT 10
        `;
        
        const result = await pool.query(selectQuery);
        
        const ranking = result.rows.map((p, index) => ({
            rank: index + 1,
            nickname: p.nickname,
            score: type === 'total' ? p.total_clears : p[type + '_clears']
        }));

        res.json(ranking);

    } catch (error) {
        console.error("ランキング取得エラー:", error);
        res.status(500).json({ message: "サーバーエラーが発生しました。" });
    }
});


// サーバー起動とDB初期化
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`★ Node.js Server running on port ${PORT}`);
        console.log(`==================================================`);
    });
});