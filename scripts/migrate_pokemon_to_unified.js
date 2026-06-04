// scripts/migrate_pokemon_to_unified.js
// ポケモンDBの puzzles を、統一先DBの puzzles に mode='pokemon' として移行するスクリプト
// 既存データは削除しません。

require('dotenv').config();

const { Pool } = require('pg');

const POKEMON_DATABASE_URL = process.env.POKEMON_DATABASE_URL;
const UNIFIED_DATABASE_URL = process.env.UNIFIED_DATABASE_URL;

if (!POKEMON_DATABASE_URL) {
    console.error('❌ POKEMON_DATABASE_URL が設定されていません。');
    process.exit(1);
}

if (!UNIFIED_DATABASE_URL) {
    console.error('❌ UNIFIED_DATABASE_URL が設定されていません。');
    process.exit(1);
}

const pokemonPool = new Pool({
    connectionString: POKEMON_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const unifiedPool = new Pool({
    connectionString: UNIFIED_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function columnExists(client, tableName, columnName) {
    const result = await client.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2;
        `,
        [tableName, columnName]
    );

    return result.rows.length > 0;
}

async function ensureUnifiedSchema(client) {
    console.log('🔧 統一先DBの puzzles テーブルを確認中...');

    await client.query(`
        CREATE TABLE IF NOT EXISTS puzzles (
            id SERIAL PRIMARY KEY
        );
    `);

    await client.query(`
        ALTER TABLE puzzles
        ADD COLUMN IF NOT EXISTS mode VARCHAR(20);
    `);

    await client.query(`
        ALTER TABLE puzzles
        ADD COLUMN IF NOT EXISTS source_id INTEGER;
    `);

    await client.query(`
        ALTER TABLE puzzles
        ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '[]'::jsonb;
    `);

    await client.query(`
        ALTER TABLE puzzles
        ADD COLUMN IF NOT EXISTS creator VARCHAR(20) DEFAULT '銀の焼き鳥';
    `);

    await client.query(`
        ALTER TABLE puzzles
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    await client.query(`
        ALTER TABLE puzzles
        DROP CONSTRAINT IF EXISTS puzzles_mode_check;
    `);

    await client.query(`
        ALTER TABLE puzzles
        ADD CONSTRAINT puzzles_mode_check
        CHECK (mode IN ('country', 'capital', 'pokemon', 'unknown'));
    `);

    await client.query(`
        CREATE INDEX IF NOT EXISTS puzzles_mode_source_id_idx
        ON puzzles (mode, source_id);
    `);

    console.log('✅ 統一先DBの puzzles テーブル確認完了');
}

async function fetchPokemonPuzzles(client) {
    console.log('📦 ポケモンDBから問題データを取得中...');

    const hasData = await columnExists(client, 'puzzles', 'data');
    const hasBoardData = await columnExists(client, 'puzzles', 'board_data');
    const hasPuzzleData = await columnExists(client, 'puzzles', 'puzzle_data');
    const hasBoard = await columnExists(client, 'puzzles', 'board');
    const hasMode = await columnExists(client, 'puzzles', 'mode');
    const hasSourceId = await columnExists(client, 'puzzles', 'source_id');
    const hasCreator = await columnExists(client, 'puzzles', 'creator');
    const hasCreatedAt = await columnExists(client, 'puzzles', 'created_at');

    let boardExpression = null;

    if (hasData) {
        boardExpression = 'data';
    } else if (hasBoardData) {
        boardExpression = 'board_data';
    } else if (hasPuzzleData) {
        boardExpression = 'puzzle_data';
    } else if (hasBoard) {
        boardExpression = 'board';
    }

    if (!boardExpression) {
        throw new Error('ポケモンDBの puzzles に data / board_data / puzzle_data / board のいずれも見つかりません。');
    }

    const sourceIdExpression = hasSourceId ? 'source_id' : 'id';
    const creatorExpression = hasCreator ? 'creator' : `'銀の焼き鳥'`;
    const createdAtExpression = hasCreatedAt ? 'created_at' : 'CURRENT_TIMESTAMP';

    let whereClause = '';

    // ポケモン専用DBなら全件コピー。
    // もし mode カラムがある場合は pokemon または NULL/空も対象にします。
    if (hasMode) {
        whereClause = `
            WHERE mode = 'pokemon'
               OR mode IS NULL
               OR mode = ''
               OR mode = 'unknown'
        `;
    }

    const query = `
        SELECT
            id,
            ${sourceIdExpression} AS source_id,
            ${boardExpression}::jsonb AS data,
            ${creatorExpression} AS creator,
            ${createdAtExpression} AS created_at
        FROM puzzles
        ${whereClause}
        ORDER BY id ASC;
    `;

    const result = await client.query(query);

    console.log(`✅ ポケモンDBから ${result.rows.length} 件取得しました。`);

    return result.rows;
}

async function upsertPokemonPuzzle(client, puzzle) {
    const sourceId = Number(puzzle.source_id || puzzle.id);

    if (!Number.isInteger(sourceId)) {
        console.warn('⚠️ source_id が不正なためスキップ:', puzzle);
        return;
    }

    const data = puzzle.data || [];
    const creator = puzzle.creator || '銀の焼き鳥';
    const createdAt = puzzle.created_at || new Date();

    const existing = await client.query(
        `
        SELECT id
        FROM puzzles
        WHERE mode = 'pokemon'
          AND source_id = $1
        ORDER BY id ASC
        LIMIT 1;
        `,
        [sourceId]
    );

    if (existing.rows.length > 0) {
        await client.query(
            `
            UPDATE puzzles
            SET
                data = $2::jsonb,
                creator = $3,
                created_at = COALESCE($4, created_at)
            WHERE id = $1;
            `,
            [
                existing.rows[0].id,
                JSON.stringify(data),
                creator,
                createdAt
            ]
        );
    } else {
        await client.query(
            `
            INSERT INTO puzzles (
                mode,
                source_id,
                data,
                creator,
                created_at
            )
            VALUES ('pokemon', $1, $2::jsonb, $3, $4);
            `,
            [
                sourceId,
                JSON.stringify(data),
                creator,
                createdAt
            ]
        );
    }
}

async function migrate() {
    const pokemonClient = await pokemonPool.connect();
    const unifiedClient = await unifiedPool.connect();

    try {
        console.log('🚀 ポケモンDB → 統一先DB への移行を開始します。');

        await ensureUnifiedSchema(unifiedClient);

        const puzzles = await fetchPokemonPuzzles(pokemonClient);

        console.log('📝 統一先DBへ書き込み中...');

        await unifiedClient.query('BEGIN');

        for (const puzzle of puzzles) {
            await upsertPokemonPuzzle(unifiedClient, puzzle);
        }

        await unifiedClient.query('COMMIT');

        console.log(`✅ 移行完了: ${puzzles.length} 件のポケモン問題を統一先DBへ反映しました。`);

        const countResult = await unifiedClient.query(`
            SELECT COUNT(*)::integer AS count
            FROM puzzles
            WHERE mode = 'pokemon';
        `);

        console.log(`📊 統一先DBの pokemon 問題数: ${countResult.rows[0].count} 件`);

    } catch (error) {
        await unifiedClient.query('ROLLBACK');
        console.error('❌ 移行に失敗しました:', error.message);
        process.exitCode = 1;

    } finally {
        pokemonClient.release();
        unifiedClient.release();

        await pokemonPool.end();
        await unifiedPool.end();
    }
}

migrate();