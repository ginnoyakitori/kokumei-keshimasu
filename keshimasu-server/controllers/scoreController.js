// controllers/scoreController.js
const db = require('../db');

const updateScore = async (req, res) => {
    const { playerId, mode, puzzleId } = req.body;

    if (!playerId || !mode || puzzleId === undefined || puzzleId === null) {
        return res.status(400).json({
            message: 'playerId, mode, puzzleId は必須です。'
        });
    }

    if (!isValidMode(mode)) {
        return res.status(400).json({
            message: '無効なモードです。'
        });
    }

    const clearField = getClearField(mode);
    const idListField = getClearedColumn(mode);
    const numericPuzzleId = Number(puzzleId);

    if (!Number.isInteger(numericPuzzleId)) {
        return res.status(400).json({
            message: 'puzzleId が不正です。'
        });
    }

    const client = await db.pool.connect();

    try {
        await client.query('BEGIN');

        const checkQuery = `
            SELECT ${idListField}, ${clearField}
            FROM players
            WHERE id = $1
            FOR UPDATE;
        `;

        const checkResult = await client.query(checkQuery, [playerId]);

        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                message: 'プレイヤーが見つかりません。'
            });
        }

        const player = checkResult.rows[0];
        const clearedIds = player[idListField] || [];

        if (clearedIds.includes(numericPuzzleId)) {
            await client.query('COMMIT');

            return res.status(200).json({
                message: 'この問題は既にクリア済みです。',
                newScore: player[clearField]
            });
        }

        clearedIds.push(numericPuzzleId);

        const updateQuery = `
            UPDATE players
            SET
                ${idListField} = $2::jsonb,
                ${clearField} = jsonb_array_length($2::jsonb)
            WHERE id = $1
            RETURNING ${clearField} AS "newScore";
        `;

        const updateResult = await client.query(updateQuery, [
            playerId,
            JSON.stringify(clearedIds)
        ]);

        await client.query('COMMIT');

        return res.status(200).json({
            message: 'スコアとクリア済み問題IDを更新しました。',
            newScore: updateResult.rows[0].newScore
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Score update error:', error);

        return res.status(500).json({
            message: 'スコア更新中にエラーが発生しました。'
        });

    } finally {
        client.release();
    }
};

module.exports = { updateScore };