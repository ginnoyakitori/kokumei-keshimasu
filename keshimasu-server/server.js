// keshimasu-server/server.js
require('dotenv').config(); // .envファイルをロード
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db'); // データベース接続設定
const initializeDatabase = require('./init_db'); // DB初期化スクリプト
const { hashPasscode, comparePasscode } = require('./utils/auth'); // 認証ヘルパー

const app = express();
const PORT = process.env.PORT || 3000;

// 辞書データを読み込む
// NOTE: サーバー側のロジック（単語判定など）で必要であれば、ここで読み込みます。
// フロントエンドへの提供は後述のAPIエンドポイントで行います。
const COUNTRY_WORDS = require('./data/country_words.json'); // ★パスを修正★
const CAPITAL_WORDS = require('./data/capital_words.json'); // ★パスを修正★


// --- 初期化と起動 ---
(async () => {
    // データベースの初期化（テーブル作成など）をサーバー起動前に実行
    await initializeDatabase(); 
    
    // CORS設定
    app.use(cors());
    // JSONリクエストボディの解析を有効化
    app.use(express.json());
    
    // 静的ファイル配信 (keshimasu-clientディレクトリを想定)
    // サーバーがkeshimasu-serverディレクトリにいる場合、クライアントは親ディレクトリのkeshimasu-clientです。
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
                'SELECT id, nickname, passcode_hash, country_clears, capital_clears FROM players WHERE nickname = $1',
                [trimmedNickname]
            );

            if (existingPlayer.rows.length > 0) {
                // ログイン処理
                const player = existingPlayer.rows[0];
                const match = await comparePasscode(passcode, player.passcode_hash);

                if (match) {
                    return res.json({ 
                        player: { 
                            id: player.id, 
                            nickname: player.nickname,
                            country_clears: player.country_clears,
                            capital_clears: player.capital_clears
                        },
                        isNewUser: false 
                    });
                } else {
                    return res.status(401).json({ message: 'パスコードが一致しません。' });
                }
            } else {
                // 新規登録処理
                const hashedPasscode = await hashPasscode(passcode);
                const newPlayer = await db.query(
                    'INSERT INTO players (nickname, passcode_hash) VALUES ($1, $2) RETURNING id, nickname, country_clears, capital_clears',
                    [trimmedNickname, hashedPasscode]
                );

                const player = newPlayer.rows[0];
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
            if (err.code === '23505') { // UNIQUE違反 (同じニックネーム)
                return res.status(409).json({ message: 'そのニックネームは既に使用されています。' });
            }
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
                'SELECT id, nickname, country_clears, capital_clears FROM players WHERE id = $1',
                [req.params.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
            }
            res.json({ player: result.rows[0] });
        } catch (err) {
            console.error('プレイヤー取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラー' });
        }
    });

    /**
     * POST /api/score/update
     * プレイヤーのクリアスコアを+1する
     */
    app.post('/api/score/update', async (req, res) => {
        const { playerId, mode } = req.body;
        const column = mode === 'country' ? 'country_clears' : 'capital_clears';

        if (!playerId || !['country', 'capital'].includes(mode)) {
            return res.status(400).json({ message: '無効なリクエストです。' });
        }

        try {
            const result = await db.query(
                // スコアをインクリメントし、更新後の値を取得
                `UPDATE players SET ${column} = ${column} + 1 WHERE id = $1 RETURNING ${column}`,
                [playerId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
            }

            res.json({ newScore: result.rows[0][column], message: 'スコアを更新しました。' });
        } catch (err) {
            console.error('スコア更新エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラーによりスコアを更新できませんでした。' });
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
            // スコア順にソートし、同スコアの場合は古い登録順（作成日）でソート
            const result = await db.query(
                `SELECT nickname, ${column} AS score
                 FROM players
                 ORDER BY score DESC, created_at ASC
                 LIMIT 100`
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
            
            // NOTE: PostgreSQLのJSONB列は自動的にJavaScriptオブジェクトとして返されますが、
            // 念のため、ここではデータをそのままJSONで返します。
            res.json(result.rows);
        } catch (err) {
            console.error('問題リスト取得エラー:', err.message);
            res.status(500).json({ message: 'サーバーエラーにより問題を取得できませんでした。' });
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