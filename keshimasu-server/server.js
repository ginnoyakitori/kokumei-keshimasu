// keshimasu-server/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const initializeDatabase = require('./init_db');
const { hashPasscode, comparePasscode } = require('./utils/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// 辞書データ
const COUNTRY_WORDS = require('./data/country_words.json');
const CAPITAL_WORDS = require('./data/capital_words.json');

// ミドルウェア
app.use(cors());
app.use(express.json());

// 必要なら静的ファイル配信
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------
// ヘルスチェック
// ------------------------------
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Keshimasu API is running.'
    });
});

// ------------------------------
// ワード一覧取得
// GET /api/words/country
// GET /api/words/capital
// ------------------------------
app.get('/api/words/:mode', (req, res) => {
    const { mode } = req.params;

    if (mode === 'country') {
        return res.json(COUNTRY_WORDS);
    }

    if (mode === 'capital') {
        return res.json(CAPITAL_WORDS);
    }

    return res.status(400).json({
        message: '無効なモードです。'
    });
});

// ------------------------------
// プレイヤー登録 / ログイン
// フロント側は /api/player/register を
// ログイン・新規登録の両方で使っている想定
// ------------------------------
app.post('/api/player/register', async (req, res) => {
    const { nickname, passcode } = req.body;

    if (!nickname || !passcode) {
        return res.status(400).json({
            message: 'ニックネームとパスコードは必須です。'
        });
    }

    const finalNickname = String(nickname).trim().slice(0, 20);

    if (!finalNickname) {
        return res.status(400).json({
            message: 'ニックネームを入力してください。'
        });
    }

    try {
        const existingResult = await db.query(
            `
            SELECT
                id,
                nickname,
                passcode_hash,
                country_clears,
                capital_clears,
                cleared_country_ids,
                cleared_capital_ids
            FROM players
            WHERE nickname = $1;
            `,
            [finalNickname]
        );

        // 既存ユーザーの場合：パスコード確認
        if (existingResult.rows.length > 0) {
            const player = existingResult.rows[0];

            const isMatch = await comparePasscode(passcode, player.passcode_hash);

            if (!isMatch) {
                return res.status(401).json({
                    message: 'パスコードが違います。'
                });
            }

            return res.status(200).json({
                message: 'ログイン成功です。',
                isNewUser: false,
                player: {
                    id: player.id,
                    nickname: player.nickname,
                    country_clears: player.country_clears || 0,
                    capital_clears: player.capital_clears || 0,
                    cleared_country_ids: player.cleared_country_ids || [],
                    cleared_capital_ids: player.cleared_capital_ids || []
                }
            });
        }

        // 新規ユーザーの場合：作成
        const passcodeHash = await hashPasscode(passcode);

        const insertResult = await db.query(
            `
            INSERT INTO players (
                nickname,
                passcode_hash,
                country_clears,
                capital_clears,
                cleared_country_ids,
                cleared_capital_ids
            )
            VALUES ($1, $2, 0, 0, '[]'::jsonb, '[]'::jsonb)
            RETURNING
                id,
                nickname,
                country_clears,
                capital_clears,
                cleared_country_ids,
                cleared_capital_ids;
            `,
            [finalNickname, passcodeHash]
        );

        const newPlayer = insertResult.rows[0];

        return res.status(200).json({
            message: '新規登録成功です。',
            isNewUser: true,
            player: {
                id: newPlayer.id,
                nickname: newPlayer.nickname,
                country_clears: newPlayer.country_clears || 0,
                capital_clears: newPlayer.capital_clears || 0,
                cleared_country_ids: newPlayer.cleared_country_ids || [],
                cleared_capital_ids: newPlayer.cleared_capital_ids || []
            }
        });

    } catch (error) {
        console.error('プレイヤー登録/ログインエラー:', error);

        return res.status(500).json({
            message: 'プレイヤー登録/ログイン中にエラーが発生しました。'
        });
    }
});

// ------------------------------
// プレイヤー情報取得
// GET /api/player/:id
// ------------------------------
app.get('/api/player/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query(
            `
            SELECT
                id,
                nickname,
                country_clears,
                capital_clears,
                cleared_country_ids,
                cleared_capital_ids
            FROM players
            WHERE id = $1;
            `,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'プレイヤーが見つかりません。'
            });
        }

        const player = result.rows[0];

        return res.json({
            player: {
                id: player.id,
                nickname: player.nickname,
                country_clears: player.country_clears || 0,
                capital_clears: player.capital_clears || 0,
                cleared_country_ids: player.cleared_country_ids || [],
                cleared_capital_ids: player.cleared_capital_ids || []
            }
        });

    } catch (error) {
        console.error('プレイヤー情報取得エラー:', error);

        return res.status(500).json({
            message: 'プレイヤー情報の取得に失敗しました。'
        });
    }
});

// ------------------------------
// 問題一覧取得
// GET /api/puzzles/country
// GET /api/puzzles/capital
//
// clear_count を各問題に追加して返す
// ------------------------------
app.get('/api/puzzles/:mode', async (req, res) => {
    const { mode } = req.params;
    const { playerId } = req.query;

    if (!['country', 'capital'].includes(mode)) {
        return res.status(400).json({
            message: '無効なモードです。'
        });
    }

    const clearedColumn =
        mode === 'country'
            ? 'cleared_country_ids'
            : 'cleared_capital_ids';

    try {
        const puzzlesResult = await db.query(
            `
            SELECT
                p.id,
                p.mode,
                p.data,
                p.creator,
                p.created_at,
                (
                    SELECT COUNT(*)
                    FROM players pl
                    WHERE EXISTS (
                        SELECT 1
                        FROM jsonb_array_elements_text(
                            COALESCE(pl.${clearedColumn}, '[]'::jsonb)
                        ) AS cleared_id(value)
                        WHERE cleared_id.value::integer = p.id
                    )
                )::integer AS clear_count
            FROM puzzles p
            WHERE p.mode = $1
            ORDER BY p.id ASC;
            `,
            [mode]
        );

        let clearedIds = [];
        let playerIdentified = false;

        if (playerId) {
            const playerResult = await db.query(
                `
                SELECT ${clearedColumn} AS cleared_ids
                FROM players
                WHERE id = $1;
                `,
                [playerId]
            );

            if (playerResult.rows.length > 0) {
                playerIdentified = true;
                clearedIds = playerResult.rows[0].cleared_ids || [];
            }
        }

        return res.json({
            puzzles: puzzlesResult.rows,
            cleared_ids: clearedIds,
            player_identified: playerIdentified
        });

    } catch (error) {
        console.error('問題一覧の取得に失敗しました:', error);

        return res.status(500).json({
            message: '問題一覧の取得に失敗しました。'
        });
    }
});

// ------------------------------
// 問題登録
// POST /api/puzzles
// ------------------------------
app.post('/api/puzzles', async (req, res) => {
    const { mode, boardData, creator } = req.body;

    if (!['country', 'capital'].includes(mode)) {
        return res.status(400).json({
            message: '無効なモードです。'
        });
    }

    if (!boardData) {
        return res.status(400).json({
            message: 'boardData は必須です。'
        });
    }

    const finalCreator = creator || '名無し';

    try {
        const result = await db.query(
            `
            INSERT INTO puzzles (
                mode,
                data,
                creator
            )
            VALUES ($1, $2::jsonb, $3)
            RETURNING
                id,
                mode,
                data,
                creator,
                created_at;
            `,
            [
                mode,
                JSON.stringify(boardData),
                finalCreator
            ]
        );

        return res.status(201).json({
            message: '問題を登録しました。',
            puzzle: result.rows[0]
        });

    } catch (error) {
        console.error('問題登録エラー:', error);

        return res.status(500).json({
            message: '問題の登録に失敗しました。'
        });
    }
});

// ------------------------------
// スコア更新
// POST /api/score/update
// ------------------------------
app.post('/api/score/update', async (req, res) => {
    const { playerId, mode, puzzleId } = req.body;

    if (!playerId || !mode || puzzleId === undefined || puzzleId === null) {
        return res.status(400).json({
            message: 'playerId, mode, puzzleId は必須です。'
        });
    }

    if (!['country', 'capital'].includes(mode)) {
        return res.status(400).json({
            message: '無効なモードです。'
        });
    }

    const clearField = mode === 'country' ? 'country_clears' : 'capital_clears';
    const idListField = mode === 'country' ? 'cleared_country_ids' : 'cleared_capital_ids';
    const numericPuzzleId = Number(puzzleId);

    if (!Number.isInteger(numericPuzzleId)) {
        return res.status(400).json({
            message: 'puzzleId が不正です。'
        });
    }

    let client;

    try {
        client = await db.pool.connect();

        await client.query('BEGIN');

        const checkResult = await client.query(
            `
            SELECT
                ${idListField},
                ${clearField}
            FROM players
            WHERE id = $1
            FOR UPDATE;
            `,
            [playerId]
        );

        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');

            return res.status(404).json({
                message: 'プレイヤーが見つかりません。'
            });
        }

        const player = checkResult.rows[0];
        const clearedIds = (player[idListField] || []).map(id => Number(id));

        if (clearedIds.includes(numericPuzzleId)) {
            await client.query('COMMIT');

            return res.status(200).json({
                message: 'この問題は既にクリア済みです。',
                newScore: player[clearField]
            });
        }

        clearedIds.push(numericPuzzleId);

        const updateResult = await client.query(
            `
            UPDATE players
            SET
                ${idListField} = $2::jsonb,
                ${clearField} = jsonb_array_length($2::jsonb)
            WHERE id = $1
            RETURNING ${clearField} AS "newScore";
            `,
            [
                playerId,
                JSON.stringify(clearedIds)
            ]
        );

        await client.query('COMMIT');

        return res.status(200).json({
            message: 'スコアとクリア済み問題IDを更新しました。',
            newScore: updateResult.rows[0].newScore
        });

    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }

        console.error('スコア更新エラー:', error);

        return res.status(500).json({
            message: 'スコア更新中にエラーが発生しました。'
        });

    } finally {
        if (client) {
            client.release();
        }
    }
});

// ------------------------------
// ランキング取得
// GET /api/rankings/total
// GET /api/rankings/country
// GET /api/rankings/capital
// ------------------------------
app.get('/api/rankings/:type', async (req, res) => {
    const { type } = req.params;

    if (!['total', 'country', 'capital'].includes(type)) {
        return res.status(400).json({
            message: '無効なランキング種別です。'
        });
    }

    let scoreExpression;

    if (type === 'country') {
        scoreExpression = 'country_clears';
    } else if (type === 'capital') {
        scoreExpression = 'capital_clears';
    } else {
        scoreExpression = '(country_clears + capital_clears)';
    }

    try {
        const result = await db.query(
            `
            SELECT
                ROW_NUMBER() OVER (
                    ORDER BY ${scoreExpression} DESC, created_at ASC
                ) AS rank,
                nickname,
                ${scoreExpression} AS score
            FROM players
            ORDER BY ${scoreExpression} DESC, created_at ASC
            LIMIT 100;
            `
        );

        return res.json(result.rows);

    } catch (error) {
        console.error('ランキング取得エラー:', error);

        return res.status(500).json({
            message: 'ランキングの取得に失敗しました。'
        });
    }
});

// ------------------------------
// 404
// ------------------------------
app.use((req, res) => {
    res.status(404).json({
        message: 'Not Found'
    });
});

// ------------------------------
// 初期化と起動
// ------------------------------
(async () => {
    await initializeDatabase();

    app.listen(PORT, () => {
        console.log(`✅ Server is running on port ${PORT}`);
    });

})().catch(err => {
    console.error('❌ 致命的なサーバー起動エラー:', err.message);
    process.exit(1);
});