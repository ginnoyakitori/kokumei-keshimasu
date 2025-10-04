// ----------------------------------------------------
// Node.js (Express) サーバーコード - server.js (認証・データベース永続化版)
// ----------------------------------------------------
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); 
const bcrypt = require('bcryptjs');  // パスコードのハッシュ化用ライブラリ
const app = express();

const PORT = process.env.PORT || 3000; 
const SALT_ROUNDS = 10; // bcryptの計算コスト

// RenderのPostgreSQLデータベース接続設定
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
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
        // passcode_hash カラムを追加/修正
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                nickname VARCHAR(10) UNIQUE NOT NULL,
                passcode_hash VARCHAR(255),  -- ★パスコードのハッシュを保存するカラム★
                country_clears INTEGER DEFAULT 0,
                capital_clears INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            -- 既存のテーブルにカラムがない場合にのみ追加 (Renderで初回デプロイなら不要だが、安全のため)
            DO $$ BEGIN
                ALTER TABLE players ADD COLUMN passcode_hash VARCHAR(255);
            EXCEPTION
                WHEN duplicate_column THEN null;
            END $$;
        `;
        await client.query(createTableQuery);
        console.log("✅ データベース接続およびテーブル作成/修正に成功しました。");
        client.release();
        
    } catch (err) {
        console.error("❌ データベースの初期化エラー:", err);
    }
}


// ----------------------------------------------------
// 1. 認証/登録API: POST /api/player/register
// ----------------------------------------------------
app.post('/api/player/register', async (req, res) => {
    const { nickname, passcode } = req.body;
    
    if (!nickname || !passcode) {
        return res.status(400).json({ message: "ニックネームとパスコードが必要です。" });
    }
    if (nickname.toLowerCase() === 'ゲスト') {
        return res.status(400).json({ message: "ニックネームとして「ゲスト」は使用できません。" });
    }

    try {
        // ニックネームでプレイヤーを検索
        let result = await pool.query('SELECT * FROM players WHERE nickname = $1', [nickname]);
        let player = result.rows[0];

        if (player) {
            // --- ログイン処理 ---
            if (!player.passcode_hash) {
                return res.status(401).json({ message: "既存のユーザーですが、パスコードが設定されていません。別のニックネームを使ってください。" });
            }
            
            const match = await bcrypt.compare(passcode, player.passcode_hash);
            
            if (match) {
                console.log(`既存プレイヤー認証成功: ID${player.id}, ${nickname}`);
                return res.json({ 
                    message: "ログイン成功",
                    player: {
                        id: player.id,
                        nickname: player.nickname,
                        country_clears: player.country_clears,
                        capital_clears: player.capital_clears
                    }
                });
            } else {
                return res.status(401).json({ message: "パスコードが正しくありません。" });
            }
            
        } else {
            // --- 新規登録処理 ---
            const passcodeHash = await bcrypt.hash(passcode, SALT_ROUNDS);
            
            const insertQuery = `
                INSERT INTO players (nickname, passcode_hash)
                VALUES ($1, $2)
                RETURNING id, nickname, country_clears, capital_clears
            `;
            result = await pool.query(insertQuery, [nickname, passcodeHash]);
            player = result.rows[0];
            
            console.log(`新規プレイヤー登録成功: ID${player.id}, ${nickname}`);
            return res.json({ 
                message: "新規登録成功",
                player: {
                    id: player.id,
                    nickname: player.nickname,
                    country_clears: player.country_clears,
                    capital_clears: player.capital_clears
                }
            });
        }
    } catch (error) {
        console.error("プレイヤー認証/登録エラー:", error);
        // 重複エラーなど、一般的なエラーに対応
        if (error.code === '23505') { 
             return res.status(409).json({ message: "そのニックネームは既に使用されています。ログインしてください。" });
        }
        res.status(500).json({ message: "サーバーエラーが発生しました。" });
    }
});


// ----------------------------------------------------
// 2. スコア更新API: POST /api/score/update (変更なし)
// ----------------------------------------------------
app.post('/api/score/update', async (req, res) => {
    // ... スコア更新ロジック (変更なし) ...
    const { playerId, mode } = req.body;
    
    if (!playerId || !['country', 'capital'].includes(mode)) {
        return res.status(400).json({ message: "無効なリクエストです。" });
    }
    
    const scoreKey = mode + '_clears';
    
    try {
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
// 3. ランキング取得API: GET /api/rankings/:type (変更なし)
// ----------------------------------------------------
app.get('/api/rankings/:type', async (req, res) => {
    // ... ランキング取得ロジック (変更なし) ...
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