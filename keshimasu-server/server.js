// keshimasu-server/server.js
require('dotenv').config(); // .envファイルをロード
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db'); // データベース接続設定 (pg-poolを想定)
const initializeDatabase = require('./init_db'); // DB初期化スクリプト
const { hashPasscode, comparePasscode } = require('./utils/auth'); // 認証ヘルパー

const app = express();
// 環境変数PORTを使用する (Renderの推奨対応)
const PORT = process.env.PORT || 3000;

// 辞書データを読み込む (ファイルパスは適宜調整してください)
const COUNTRY_WORDS = require('./data/country_words.json');
const CAPITAL_WORDS = require('./data/capital_words.json');


// --- 初期化と起動 ---
(async () => {
    // データベースの初期化（テーブル作成など）をサーバー起動前に実行
    await initializeDatabase(); 
    
    // CORS設定
    app.use(cors());
    // JSONリクエストボディの解析を有効化
    app.use(express.json());
    
    // 静的ファイル配信 (keshimasu-clientディレクトリを想定)
    app.use(express.static(path.join(__dirname, '..', 'keshimasu-client')));


    // --- API エンドポイント ---

    /**
     * POST /api/player/register
     * ニックネームとパスコードでログインまたは新規登録を行う
     */
    app.post('/api/player/register', async (req, res) => {
        const { nickname, passcode } = req.body;
        const trimmedNickname = nickname ? nickname.trim().slice(0, 10) : null;
        
        if (!trimmedNickname || !passcode) {
            return res.status(400).json({ message: 'ニックネームとパスコードは必須です。' });
        }

        try {
            // 1. 既存ユーザーのチェック
            const existingPlayer = await db.query(
                'SELECT id, nickname, passcode_hash, country_clears, capital_clears, cleared_country_ids, cleared_capital_ids FROM players WHERE nickname = $1',
                [trimmedNickname]
            );

            if (existingPlayer.rows.length > 0) {
                // ログイン処理 (既存ユーザー)
                const player = existingPlayer.rows[0];
                const match = await comparePasscode(passcode, player.passcode_hash);

                if (match) {
                    // ログイン成功
                    return res.json({ 
                        player: { 
                            id: player.id, 
                            nickname: player.nickname,
                            country_clears: player.country_clears,
                            capital_clears: player.capital_clears,
                            // JSON文字列をパースして返す
                            cleared_country_ids: player.cleared_country_ids ? JSON.parse(player.cleared_country_ids) : [],
                            cleared_capital_ids: player.cleared_capital_ids ? JSON.parse(player.cleared_capital_ids) : []
                        },
                        isNewUser: false 
                    });
                } else {
                    // パスコード不一致
                    return res.status(401).json({ message: 'パスコードが一致しません。', isNewUser: false });
                }
            } else {
                // 新規登録処理 (新規ユーザー)
                const hashedPasscode = await hashPasscode(passcode);
                const newPlayer = await db.query(
                    'INSERT INTO players (nickname, passcode_hash, cleared_country_ids, cleared_capital_ids) VALUES ($1, $2, $3, $4) RETURNING id, nickname, country_clears, capital_clears',
                    [trimmedNickname, hashedPasscode, '[]', '[]'] // 新規作成時、JSON文字列'[]'を初期値とする
                );

                const player = newPlayer.rows[0];
                // 新規登録成功
                return res.status(201).json({ 
                    player: { 
                        id: player.id, 
                        nickname: player.nickname,
                        country_clears: player.country_clears,
                        capital_clears: player.capital_clears
                    },
                    isNewUser: true 
                });
            }

        } catch (err) {
            console.error('認証/登録エラー:', err.message);
            // サーバーエラー
            res.status(500).json({ message: 'サーバーエラーが発生しました。' });
        }
    });
    
    /**
     * GET /api/player/:id
     * プレイヤーの最新情報を取得（リロード時など）
     */
    app.get('/api/player/:id', async (req, res) => {
        try {
            const result = await db.query(
                // プレイヤー情報取得時にクリア済みIDリストを含める
                'SELECT id, nickname, country_clears, capital_clears, cleared_country_ids, cleared_capital_ids FROM players WHERE id = $1',
                [req.params.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
            }

            const player = result.rows[0];
            // JSON文字列をパースして配列としてクライアントに返す
            player.cleared_country_ids = player.cleared_country_ids ? JSON.parse(player.cleared_country_ids) : [];
            player.cleared_capital_ids = player.cleared_capital_ids ? JSON.parse(player.cleared_capital_ids) : [];

            res.json({ player: player });
        } catch (err) {
            console.error('プレイヤー取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラー' });
        }
    });

// keshimasu-server/server.js

/**
 * POST /api/score/update
 * プレイヤーのクリアスコアを+1し、クリアした問題IDを記録する
 */
app.post('/api/score/update', async (req, res) => {
    const { playerId, mode, puzzleId } = req.body;
    
    const clearCountColumn = mode === 'country' ? 'country_clears' : 'capital_clears';
    const clearedIdsColumn = mode === 'country' ? 'cleared_country_ids' : 'cleared_capital_ids';
    const puzzleIdInt = parseInt(puzzleId);

    if (!playerId || !['country', 'capital'].includes(mode) || isNaN(puzzleIdInt)) {
        return res.status(400).json({ message: '無効なリクエストです。' });
    }
    
    // トランザクションを開始し、原子性を確保
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. 現在のクリア済みIDリストを取得し、排他ロックをかける
        const checkResult = await client.query(
            `SELECT ${clearCountColumn}, ${clearedIdsColumn} FROM players WHERE id = $1 FOR UPDATE`, // FOR UPDATEでロック
            [playerId]
        );
        
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
        }
        
        const currentRow = checkResult.rows[0];
        const currentScore = currentRow[clearCountColumn];
        const clearedIdsJson = currentRow[clearedIdsColumn];
        
        let clearedIds = clearedIdsJson ? JSON.parse(clearedIdsJson) : [];
        
        if (clearedIds.includes(puzzleIdInt)) {
            // 既にクリア済みの場合、スコアは更新せず、現在のスコアを返す
            await client.query('ROLLBACK');
            return res.status(200).json({ 
                newScore: currentScore, 
                message: 'この問題は既にクリア済みです。' 
            });
        }

        // 2. 新しいIDを追加し、JSON文字列に変換
        clearedIds.push(puzzleIdInt);
        const newClearedIdsJson = JSON.stringify(clearedIds);

        // 3. スコアをインクリメントし、クリア済みIDのJSON文字列を更新
        // ★★★ ここを修正 ★★★
        // COALESCE(${clearCountColumn}, 0) を使い、NULLの場合でも0として扱ってから+1する
        const updateResult = await client.query(
            `UPDATE players SET ${clearCountColumn} = COALESCE(${clearCountColumn}, 0) + 1, ${clearedIdsColumn} = $2 WHERE id = $1 RETURNING ${clearCountColumn} AS newscore`,
            [playerId, newClearedIdsJson]
        );
        
        await client.query('COMMIT');
        
        if (updateResult.rows.length === 0) {
            return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
        }

        res.json({ newScore: updateResult.rows[0].newscore, message: 'スコアを更新しました。' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('スコア更新エラー:', err.message);
        res.status(500).json({ message: 'サーバーエラーによりスコアを更新できませんでした。' });
    } finally {
        client.release();
    }
});
    /**
     * GET /api/puzzles/:mode
     * 指定されたモードの問題リストを取得する (古い登録順)
     * ★修正: レスポンスに全問題、クリア済みIDリスト、およびプレイヤー特定フラグを含める★
     * クライアント側でクリア済みIDを参照してフィルタリングする責務を持つ
     */
    app.get('/api/puzzles/:mode', async (req, res) => {
        const { mode } = req.params;
        const { playerId } = req.query; // playerIdをクエリパラメータから取得
        
        if (!['country', 'capital'].includes(mode)) {
            return res.status(400).json({ message: '無効なモードです。' });
        }
        
        let clearedIds = [];
        let playerIdentified = false; // プレイヤーが特定できたかを示すフラグ
        
        // 1. プレイヤーIDがあれば、クリア済みIDを取得
        if (playerId) {
            try {
                const clearedIdsColumn = mode === 'country' ? 'cleared_country_ids' : 'cleared_capital_ids';
                const playerResult = await db.query(
                    `SELECT ${clearedIdsColumn} FROM players WHERE id = $1`,
                    [playerId]
                );

                if (playerResult.rows.length > 0) {
                    const clearedIdsJson = playerResult.rows[0][clearedIdsColumn];
                    // JSON文字列をパースし、IDリスト（数値配列）を作成
                    clearedIds = clearedIdsJson ? JSON.parse(clearedIdsJson) : [];
                    playerIdentified = true; // プレイヤー特定成功
                }
            } catch (err) {
                console.error('クリア済みID取得エラー:', err.message);
                // エラーが発生した場合も、問題リストの取得は続行（clearedIdsは[]のまま）
            }
        }

        // 2. 問題リスト全体を取得 (フィルタリングはクライアントに任せるため、ここでは全ての対象問題を取得)
        try {
            // modeに一致する全ての問題を取得する
            const sql = 'SELECT id, board_data AS data, creator FROM puzzles WHERE mode = $1 ORDER BY created_at ASC';
            
            const result = await db.query(sql, [mode]);
            
            // 3. レスポンスにすべての情報を含めて返す
            res.json({ 
                puzzles: result.rows, 
                cleared_ids: clearedIds,
                player_identified: playerIdentified, // フラグをクライアントに返す
                message: playerIdentified ? '問題リストと最新のクリア済みIDを返却しました。' : 'ゲスト/未ログイン用の全問題リストを返却しました。'
            });

        } catch (err) {
            console.error('問題リスト取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラーにより問題を取得できませんでした。' });
        }
    });

    /**
     * GET /api/rankings/:type
     * ランキングデータを取得
     */
    app.get('/api/rankings/:type', async (req, res) => {
        const { type } = req.params;
        let column;

        if (type === 'country') column = 'country_clears';
        else if (type === 'capital') column = 'capital_clears';
        else if (type === 'total') column = 'country_clears + capital_clears';
        else return res.status(400).json({ message: '無効なランキングタイプです。' });

        try {
            // SQLクエリを一行で記述し、不正なスペースの混入を防ぐ
            const result = await db.query(
                `SELECT nickname, ${column} AS score FROM players ORDER BY score DESC, created_at ASC LIMIT 100`
            );
            
            // 取得したデータに順位(rank)を付与して返す
            const rankings = result.rows.map((row, index) => ({
                rank: index + 1,
                nickname: row.nickname,
                score: row.score
            }));

            res.json(rankings);
        } catch (err) {
            console.error('ランキング取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラーによりランキングを取得できませんでした。' });
        }
    });

    /**
     * GET /api/words/:mode
     * 利用可能な国名/首都名リストをクライアントに提供
     */
    app.get('/api/words/:mode', (req, res) => {
        const { mode } = req.params;
        if (mode === 'country') {
            return res.json(COUNTRY_WORDS);
        } else if (mode === 'capital') {
            return res.json(CAPITAL_WORDS);
        }
        return res.status(400).json({ message: '無効なモードです。' });
    });

    /**
     * POST /api/puzzles
     * ユーザーが制作した問題をデータベースに登録する
     */
    app.post('/api/puzzles', async (req, res) => {
        const { mode, boardData, creator } = req.body;
        
        if (!mode || !boardData || !creator) {
            return res.status(400).json({ message: '問題のデータが不完全です。' });
        }
        
        try {
            const newPuzzle = await db.query(
                'INSERT INTO puzzles (mode, board_data, creator) VALUES ($1, $2, $3) RETURNING id, creator',
                [mode, JSON.stringify(boardData), creator]
            );

            res.status(201).json({ 
                puzzle: { id: newPuzzle.rows[0].id, creator: newPuzzle.rows[0].creator }, 
                message: '問題が正常に登録されました。'
            });
        } catch (err) {
            console.error('問題登録エラー:', err.message);
            res.status(500).json({ message: '問題の登録中にサーバーエラーが発生しました。' });
        }
    });

    // --- サーバー起動 ---
    app.listen(PORT, () => {
        console.log(`🚀 サーバーはポート ${PORT} で稼働中です！`);
    });

})().catch(err => {
    console.error('❌ 致命的なサーバー起動エラー:', err.message);
    process.exit(1);
});