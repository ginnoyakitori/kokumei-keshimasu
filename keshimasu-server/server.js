// keshimasu-server/server.js
require('dotenv').config(); // .envファイルをロード
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db'); // データベース接続設定
const initializeDatabase = require('./init_db'); // DB初期化スクリプト
const { hashPasscode, comparePasscode } = require('./utils/auth'); // 認証ヘルパー

const app = express();
// ★★★ 修正箇所: 環境変数PORTを使用する (Renderの推奨対応) ★★★
const PORT = process.env.PORT || 3000;

// 辞書データを読み込む
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
     * サーバーは既存/新規を判定し、isNewUserフラグを正確に返す
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
                // ★修正1-1: ログイン時にクリア済みIDリストを取得に含める★
                'SELECT id, nickname, passcode_hash, country_clears, capital_clears, cleared_country_ids, cleared_capital_ids FROM players WHERE nickname = $1',
                [trimmedNickname]
            );

            if (existingPlayer.rows.length > 0) {
                // ログイン処理 (既存ユーザー)
                const player = existingPlayer.rows[0];
                const match = await comparePasscode(passcode, player.passcode_hash);

                if (match) {
                    // ★ログイン成功
                    return res.json({ 
                        player: { 
                            id: player.id, 
                            nickname: player.nickname,
                            country_clears: player.country_clears,
                            capital_clears: player.capital_clears,
                            // ★修正1-2: クリア済みIDを返す★
                            cleared_country_ids: player.cleared_country_ids || [],
                            cleared_capital_ids: player.cleared_capital_ids || []
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
                    'INSERT INTO players (nickname, passcode_hash) VALUES ($1, $2) RETURNING id, nickname, country_clears, capital_clears',
                    [trimmedNickname, hashedPasscode]
                );

                const player = newPlayer.rows[0];
                // ★新規登録成功
                return res.status(201).json({ 
                    player: { 
                        id: player.id, 
                        nickname: player.nickname,
                        country_clears: player.country_clears,
                        capital_clears: player.capital_clears
                        // cleared_ids は空の配列として扱われるため、ここでは特に返さない
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
                // ★修正2: プレイヤー情報取得時にクリア済みIDリストを含める★
                'SELECT id, nickname, country_clears, capital_clears, cleared_country_ids, cleared_capital_ids FROM players WHERE id = $1',
                [req.params.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
            }
            // nullの場合は空の配列を返すようにする
            const player = result.rows[0];
            player.cleared_country_ids = player.cleared_country_ids || [];
            player.cleared_capital_ids = player.cleared_capital_ids || [];

            res.json({ player: player });
        } catch (err) {
            console.error('プレイヤー取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラー' });
        }
    });

    /**
     * POST /api/score/update
     * プレイヤーのクリアスコアを+1し、クリアした問題IDを記録する
     */
    app.post('/api/score/update', async (req, res) => {
        // ★修正3-1: puzzleIdを受け取る★
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
            
            // 1. 既にクリア済みかどうかを確認（二重加算防止）
            const checkResult = await client.query(
                `SELECT ${clearedIdsColumn} FROM players WHERE id = $1`,
                [playerId]
            );
            
            const clearedIds = checkResult.rows[0] ? checkResult.rows[0][clearedIdsColumn] || [] : [];
            
            if (clearedIds.includes(puzzleIdInt)) {
                // 既にクリア済みの場合、スコアは更新せず、現在のスコアを返す（クライアントに最新値を伝える）
                await client.query('ROLLBACK');
                const currentScoreResult = await db.query(`SELECT ${clearCountColumn} FROM players WHERE id = $1`, [playerId]);
                return res.status(200).json({ 
                    newScore: currentScoreResult.rows[0] ? currentScoreResult.rows[0][clearCountColumn] : 0, 
                    message: 'この問題は既にクリア済みです。' 
                });
            }

            // 2. スコアをインクリメントし、クリア済みIDを追加
            // ★修正3-2: スコアをインクリメントし、クリア済みIDを配列に追加する★
            const updateResult = await client.query(
                `UPDATE players SET ${clearCountColumn} = ${clearCountColumn} + 1, ${clearedIdsColumn} = array_append(${clearedIdsColumn}, $2) WHERE id = $1 RETURNING ${clearCountColumn}`,
                [playerId, puzzleIdInt]
            );
            
            await client.query('COMMIT');
            
            if (updateResult.rows.length === 0) {
                return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
            }

            res.json({ newScore: updateResult.rows[0][clearCountColumn], message: 'スコアを更新しました。' });
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('スコア更新エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラーによりスコアを更新できませんでした。' });
        } finally {
            client.release();
        }
    });
    
    // --- (ランキング、辞書、問題登録、問題リストのAPIは変更なし) ---
    
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

    /**
     * GET /api/puzzles/:mode
     * 指定されたモードの問題リストを取得する (古い登録順)
     */
    app.get('/api/puzzles/:mode', async (req, res) => {
        const { mode } = req.params;
        
        if (!['country', 'capital'].includes(mode)) {
            return res.status(400).json({ message: '無効なモードです。' });
        }
        
        try {
            // 作成日時が古い順にソートして全て取得
            const result = await db.query(
                'SELECT id, board_data AS data, creator FROM puzzles WHERE mode = $1 ORDER BY created_at ASC',
                [mode]
            );
            
            res.json(result.rows);
        } catch (err) {
            console.error('問題リスト取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラーにより問題を取得できませんでした。' });
        }
    });


    // --- サーバー起動 ---
    app.listen(PORT, () => {
        // ★★★ 修正箇所: 起動ログで実際に使用しているポートを表示 ★★★
        console.log(`🚀 サーバーはポート ${PORT} で稼働中です！`);
    });

})().catch(err => {
    console.error('❌ 致命的なサーバー起動エラー:', err.message);
    process.exit(1);
});