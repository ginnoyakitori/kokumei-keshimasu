require('dotenv').config(); // .envファイルをロード
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db'); // データベース接続設定
const initializeDatabase = require('./init_db'); // DB初期化スクリプト
const { hashPasscode, comparePasscode } = require('./utils/auth'); // 認証ヘルパー

const app = express();
const PORT = process.env.PORT || 3000;

const COUNTRY_WORDS = require('./data/country_words.json');
const CAPITAL_WORDS = require('./data/capital_words.json');

(async () => {
  await initializeDatabase();

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'keshimasu-client')));

  app.post('/api/player/register', async (req, res) => {
    const { nickname, passcode } = req.body;
    const trimmedNickname = nickname ? nickname.trim().slice(0, 10) : null;

    if (!trimmedNickname || !passcode) {
      return res.status(400).json({ message: 'ニックネームとパスコードは必須です。' });
    }

    try {
      const existingPlayer = await db.query(
        'SELECT id, nickname, passcode_hash, country_clears, capital_clears, cleared_country_ids, cleared_capital_ids FROM players WHERE nickname = $1',
        [trimmedNickname]
      );

      if (existingPlayer.rows.length > 0) {
        const player = existingPlayer.rows[0];
        const match = await comparePasscode(passcode, player.passcode_hash);

        if (match) {
          return res.json({
            player: {
              id: player.id,
              nickname: player.nickname,
              country_clears: player.country_clears,
              capital_clears: player.capital_clears,
              cleared_country_ids: player.cleared_country_ids ? JSON.parse(player.cleared_country_ids) : [],
              cleared_capital_ids: player.cleared_capital_ids ? JSON.parse(player.cleared_capital_ids) : []
            },
            isNewUser: false
          });
        } else {
          return res.status(401).json({ message: 'パスコードが一致しません。', isNewUser: false });
        }
      } else {
        const hashedPasscode = await hashPasscode(passcode);
        const newPlayer = await db.query(
          'INSERT INTO players (nickname, passcode_hash, cleared_country_ids, cleared_capital_ids) VALUES ($1, $2, $3, $4) RETURNING id, nickname, country_clears, capital_clears',
          [trimmedNickname, hashedPasscode, '[]', '[]']
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
      res.status(500).json({ message: 'サーバーエラーが発生しました。' });
    }
  });

  app.get('/api/player/:id', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT id, nickname, country_clears, capital_clears, cleared_country_ids, cleared_capital_ids FROM players WHERE id = $1',
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'プレイヤーが見つかりません。' });
      }

      const player = result.rows[0];
      player.cleared_country_ids = player.cleared_country_ids ? JSON.parse(player.cleared_country_ids) : [];
      player.cleared_capital_ids = player.cleared_capital_ids ? JSON.parse(player.cleared_capital_ids) : [];

      res.json({ player: player });
    } catch (err) {
      console.error('プレイヤー取得エラー:', err.message);
      res.status(500).json({ message: 'サーバーエラー' });
    }
  });

  app.post('/api/score/update', async (req, res) => {
    const { playerId, mode, puzzleId } = req.body;

    const clearCountColumn = mode === 'country' ? 'country_clears' : 'capital_clears';
    const clearedIdsColumn = mode === 'country' ? 'cleared_country_ids' : 'cleared_capital_ids';
    const puzzleIdInt = parseInt(puzzleId);

    if (!playerId || !['country', 'capital'].includes(mode) || isNaN(puzzleIdInt)) {
      return res.status(400).json({ message: '無効なリクエストです。' });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const checkResult = await client.query(
        `SELECT ${clearCountColumn}, ${clearedIdsColumn} FROM players WHERE id = $1 FOR UPDATE`,
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
        await client.query('ROLLBACK');
        return res.status(200).json({
          newScore: currentScore,
          message: 'この問題は既にクリア済みです。'
        });
      }

      clearedIds.push(puzzleIdInt);
      const newClearedIdsJson = JSON.stringify(clearedIds);

      const updateResult = await client.query(
        `UPDATE players SET ${clearCountColumn} = ${clearCountColumn} + 1, ${clearedIdsColumn} = $1 WHERE id = $2 RETURNING ${clearCountColumn} AS newscore`,
        [newClearedIdsJson, playerId]
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
  app.get('/api/puzzles/:mode', async (req, res) => {
    const { mode } = req.params;
    const { playerId } = req.query;

    if (!['country', 'capital'].includes(mode)) {
      return res.status(400).json({ message: '無効なモードです。' });
    }

    let clearedIds = [];
    let playerIdentified = false;

    if (playerId) {
      try {
        const clearedIdsColumn = mode === 'country' ? 'cleared_country_ids' : 'cleared_capital_ids';
        const playerResult = await db.query(
          `SELECT ${clearedIdsColumn} FROM players WHERE id = $1`,
          [playerId]
        );

        if (playerResult.rows.length > 0) {
          const clearedIdsJson = playerResult.rows[0][clearedIdsColumn];
          clearedIds = clearedIdsJson ? JSON.parse(clearedIdsJson) : [];
          playerIdentified = true;
        }
      } catch (err) {
        console.error('クリア済みID取得エラー:', err.message);
      }
    }

    try {
      const sql = 'SELECT id, board_data AS data, creator FROM puzzles WHERE mode = $1 ORDER BY created_at ASC';
      const result = await db.query(sql, [mode]);

      res.json({
        puzzles: result.rows,
        cleared_ids: clearedIds,
        player_identified: playerIdentified,
        message: playerIdentified
          ? '問題リストと最新のクリア済みIDを返却しました。'
          : 'ゲスト/未ログイン用の全問題リストを返却しました。'
      });
    } catch (err) {
      console.error('問題リスト取得エラー:', err.message);
      res.status(500).json({ message: 'サーバーエラーにより問題を取得できませんでした。' });
    }
  });

  app.get('/api/rankings/:type', async (req, res) => {
    const { type } = req.params;
    let column;

    if (type === 'country') column = 'country_clears';
    else if (type === 'capital') column = 'capital_clears';
    else if (type === 'total') column = 'country_clears + capital_clears';
    else return res.status(400).json({ message: '無効なランキングタイプです。' });

    try {
      const result = await db.query(
        `SELECT nickname, ${column} AS score FROM players ORDER BY score DESC, created_at ASC LIMIT 100`
      );

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

  app.get('/api/words/:mode', (req, res) => {
    const { mode } = req.params;
    if (mode === 'country') {
      return res.json(COUNTRY_WORDS);
    } else if (mode === 'capital') {
      return res.json(CAPITAL_WORDS);
    }
    return res.status(400).json({ message: '無効なモードです。' });
  });

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
        puzzle: {
          id: newPuzzle.rows[0].id,
          creator: newPuzzle.rows[0].creator
        },
        message: '問題が正常に登録されました。'
      });
    } catch (err) {
      console.error('問題登録エラー:', err.message);
      res.status(500).json({ message: '問題の登録中にサーバーエラーが発生しました。' });
    }
  });

  app.listen(PORT, () => {
    console.log(`🚀 サーバーはポート ${PORT} で稼働中です！`);
  });
})().catch(err => {
  console.error('❌ 致命的なサーバー起動エラー:', err.message);
  process.exit(1);
});