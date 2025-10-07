// ----------------------------------------------------
// server.js（国名ケシマス 完全動作版）
// ----------------------------------------------------
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { hashPasscode, comparePasscode } = require('./utils/auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------
// ✅ 1. プレイヤー登録 API
// ----------------------------------------------------
app.post('/api/signup', async (req, res) => {
    const { nickname, passcode } = req.body;

    if (!nickname || !passcode) {
        return res.status(400).json({ message: 'ニックネームとパスコードは必須です。' });
    }

    try {
        // 重複チェック
        const existing = await db.query('SELECT * FROM players WHERE nickname = $1', [nickname]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ message: 'このニックネームは既に使われています。' });
        }

        const hash = await hashPasscode(passcode);
        const result = await db.query(
            `INSERT INTO players (nickname, passcode_hash, country_clears, capital_clears, 
              cleared_country_ids, cleared_capital_ids)
             VALUES ($1, $2, 0, 0, $3, $4)
             RETURNING id, nickname, country_clears, capital_clears`,
            [nickname, hash, JSON.stringify([]), JSON.stringify([])]
        );

        res.json({ 
            message: '登録完了！', 
            player: result.rows[0] 
        });
    } catch (err) {
        console.error('サインアップエラー:', err.message);
        res.status(500).json({ message: 'サーバーエラーにより登録できませんでした。' });
    }
});

// ----------------------------------------------------
// ✅ 2. ログイン API
// ----------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { nickname, passcode } = req.body;

    if (!nickname || !passcode) {
        return res.status(400).json({ message: 'ニックネームとパスコードを入力してください。' });
    }

    try {
        const result = await db.query('SELECT * FROM players WHERE nickname = $1', [nickname]);
        if (result.rows.length === 0) {
            return res.status(400).json({ message: 'ユーザーが存在しません。' });
        }

        const player = result.rows[0];
        const match = await comparePasscode(passcode, player.passcode_hash);
        if (!match) {
            return res.status(401).json({ message: 'パスコードが違います。' });
        }

        res.json({
            message: 'ログイン成功！',
            player: {
                id: player.id,
                nickname: player.nickname,
                country_clears: player.country_clears,
                capital_clears: player.capital_clears,
                cleared_country_ids: player.cleared_country_ids ? JSON.parse(player.cleared_country_ids) : [],
                cleared_capital_ids: player.cleared_capital_ids ? JSON.parse(player.cleared_capital_ids) : []
            }
        });
    } catch (err) {
        console.error('ログインエラー:', err.message);
        res.status(500).json({ message: 'ログイン失敗: サーバーエラーが発生しました。' });
    }
});

// ----------------------------------------------------
// ✅ 3. 問題取得 API（未クリアのみ出題）
// ----------------------------------------------------
app.get('/api/puzzle/:mode/:playerId', async (req, res) => {
    const { mode, playerId } = req.params;
    if (!['country', 'capital'].includes(mode)) {
        return res.status(400).json({ message: '不正なモードです。' });
    }

    try {
        const playerRes = await db.query(
            `SELECT cleared_${mode}_ids FROM players WHERE id = $1`,
            [playerId]
        );

        if (playerRes.rows.length === 0) {
            return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
        }

        const clearedIds = playerRes.rows[0][`cleared_${mode}_ids`]
            ? JSON.parse(playerRes.rows[0][`cleared_${mode}_ids`])
            : [];

        const puzzleRes = await db.query(
            `SELECT * FROM puzzles WHERE mode = $1 ORDER BY created_at ASC`,
            [mode]
        );

        const nextPuzzle = puzzleRes.rows.find(p => !clearedIds.includes(p.id));

        if (!nextPuzzle) {
            return res.json({ message: '全ての問題をクリアしました！', puzzle: null });
        }

        res.json({
            puzzle: {
                id: nextPuzzle.id,
                mode: nextPuzzle.mode,
                board_data: nextPuzzle.board_data,
                creator_name: nextPuzzle.creator_name
            }
        });
    } catch (err) {
        console.error('問題取得エラー:', err.message);
        res.status(500).json({ message: '問題を取得できませんでした。' });
    }
});

// ----------------------------------------------------
// ✅ 4. スコア更新 API（JSON配列対応版）
// ----------------------------------------------------
app.post('/api/score/update', async (req, res) => {
    const { playerId, mode, puzzleId } = req.body;
    const clearCountColumn = mode === 'country' ? 'country_clears' : 'capital_clears';
    const clearedIdsColumn = mode === 'country' ? 'cleared_country_ids' : 'cleared_capital_ids';
    const puzzleIdInt = parseInt(puzzleId);

    if (!playerId || !['country', 'capital'].includes(mode) || isNaN(puzzleIdInt)) {
        return res.status(400).json({ message: '無効なリクエストです。' });
    }

    try {
        const playerRes = await db.query(
            `SELECT ${clearCountColumn}, ${clearedIdsColumn} FROM players WHERE id = $1`,
            [playerId]
        );

        if (playerRes.rows.length === 0) {
            return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
        }

        const player = playerRes.rows[0];
        const clearedIds = player[clearedIdsColumn] ? JSON.parse(player[clearedIdsColumn]) : [];

        if (clearedIds.includes(puzzleIdInt)) {
            return res.json({
                newScore: player[clearCountColumn],
                message: 'この問題は既にクリア済みです。'
            });
        }

        clearedIds.push(puzzleIdInt);
        const newScore = player[clearCountColumn] + 1;

        await db.query(
            `UPDATE players 
             SET ${clearCountColumn} = $1, ${clearedIdsColumn} = $2 
             WHERE id = $3`,
            [newScore, JSON.stringify(clearedIds), playerId]
        );

        res.json({ newScore, message: 'スコアを更新しました。' });
    } catch (err) {
        console.error('スコア更新エラー:', err.message);
        res.status(500).json({ message: 'サーバーエラーによりスコアを更新できませんでした。' });
    }
});

// ----------------------------------------------------
// ✅ 5. 問題作成 API
// ----------------------------------------------------
app.post('/api/puzzle/create', async (req, res) => {
    const { mode, creatorName, boardData } = req.body;

    if (!mode || !creatorName || !boardData) {
        return res.status(400).json({ message: '全ての項目を入力してください。' });
    }

    try {
        await db.query(
            `INSERT INTO puzzles (mode, creator_name, board_data)
             VALUES ($1, $2, $3)`,
            [mode, creatorName, JSON.stringify(boardData)]
        );
        res.json({ message: '問題を登録しました。' });
    } catch (err) {
        console.error('問題登録エラー:', err.message);
        res.status(500).json({ message: '問題登録に失敗しました。' });
    }
});

// ----------------------------------------------------
// ✅ 6. ランキング API
// ----------------------------------------------------
app.get('/api/ranking/:type', async (req, res) => {
    const { type } = req.params;
    const column =
        type === 'country' ? 'country_clears' :
        type === 'capital' ? 'capital_clears' :
        type === 'total' ? '(country_clears + capital_clears)' : null;

    if (!column) return res.status(400).json({ message: '不正なランキングタイプです。' });

    try {
        const result = await db.query(
            `SELECT nickname, country_clears, capital_clears, 
                    (country_clears + capital_clears) AS total_clears
             FROM players
             ORDER BY ${column} DESC, id ASC
             LIMIT 50`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('ランキング取得エラー:', err.message);
        res.status(500).json({ message: 'ランキング取得に失敗しました。' });
    }
});

// ----------------------------------------------------
// ✅ 7. 国名/首都名ワード一覧 API
// ----------------------------------------------------
app.get('/api/wordlist/:mode', async (req, res) => {
    const { mode } = req.params;
    try {
        const filePath = path.join(__dirname, `../data/${mode}_puzzles.json`);
        const words = require(filePath);
        res.json(words);
    } catch (err) {
        console.error('ワードリスト取得エラー:', err.message);
        res.status(500).json({ message: 'ワードリストを取得できませんでした。' });
    }
});

// ----------------------------------------------------
// ✅ 起動
// ----------------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ 国名ケシマスサーバー起動中: http://localhost:${PORT}`);
});
