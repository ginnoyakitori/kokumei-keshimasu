// scripts/migrate_pokemon_players_to_unified.js
// ポケモンDBの players を、統一先DBの players に統合するスクリプト
// 同じ nickname のプレイヤーは pokemon のクリア情報だけをマージします。
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

async function ensureUnifiedPlayersSchema(client) {
    console.log('🔧 統一先DBの players テーブルを確認中...');

    await client.query(`
        CREATE TABLE IF NOT EXISTS players (
            id SERIAL PRIMARY KEY,
            nickname VARCHAR(20) UNIQUE NOT NULL,
            passcode_hash TEXT NOT NULL,
            country_clears INTEGER DEFAULT 0,
            capital_clears INTEGER DEFAULT 0,
            pokemon_clears INTEGER DEFAULT 0,
            cleared_country_ids JSONB DEFAULT '[]'::jsonb,
            cleared_capital_ids JSONB DEFAULT '[]'::jsonb,
            cleared_pokemon_ids JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS country_clears INTEGER DEFAULT 0;
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS capital_clears INTEGER DEFAULT 0;
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS pokemon_clears INTEGER DEFAULT 0;
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS cleared_country_ids JSONB DEFAULT '[]'::jsonb;
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS cleared_capital_ids JSONB DEFAULT '[]'::jsonb;
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS cleared_pokemon_ids JSONB DEFAULT '[]'::jsonb;
    `);

    await client.query(`
        ALTER TABLE players
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    await client.query(`
        UPDATE players
        SET pokemon_clears = 0
        WHERE pokemon_clears IS NULL;
    `);

    await client.query(`
        UPDATE players
        SET cleared_pokemon_ids = '[]'::jsonb
        WHERE cleared_pokemon_ids IS NULL;
    `);

    console.log('✅ 統一先DBの players テーブル確認完了');
}

async function fetchPokemonPlayers(client) {
    console.log('📦 ポケモンDBからプレイヤーデータを取得中...');

    const hasPokemonClears = await columnExists(client, 'players', 'pokemon_clears');
    const hasClearedPokemonIds = await columnExists(client, 'players', 'cleared_pokemon_ids');
    const hasCreatedAt = await columnExists(client, 'players', 'created_at');

    if (!hasPokemonClears) {
        console.warn('⚠️ ポケモンDBに pokemon_clears がありません。0として扱います。');
    }

    if (!hasClearedPokemonIds) {
        console.warn('⚠️ ポケモンDBに cleared_pokemon_ids がありません。[]として扱います。');
    }

    const pokemonClearsExpression = hasPokemonClears ? 'pokemon_clears' : '0';
    const clearedPokemonIdsExpression = hasClearedPokemonIds ? 'cleared_pokemon_ids' : `'[]'::jsonb`;
    const createdAtExpression = hasCreatedAt ? 'created_at' : 'CURRENT_TIMESTAMP';

    const result = await client.query(
        `
        SELECT
            nickname,
            passcode_hash,
            ${pokemonClearsExpression} AS pokemon_clears,
            ${clearedPokemonIdsExpression} AS cleared_pokemon_ids,
            ${createdAtExpression} AS created_at
        FROM players
        WHERE nickname IS NOT NULL
          AND nickname <> ''
        ORDER BY id ASC;
        `
    );

    console.log(`✅ ポケモンDBから ${result.rows.length} 人取得しました。`);

    return result.rows;
}

function normalizeIdArray(value) {
    if (!value) return [];

    let arr = value;

    if (typeof value === 'string') {
        try {
            arr = JSON.parse(value);
        } catch {
            return [];
        }
    }

    if (!Array.isArray(arr)) return [];

    return arr
        .map(id => Number(id))
        .filter(id => Number.isInteger(id));
}

function mergeUniqueIds(a, b) {
    return [...new Set([...normalizeIdArray(a), ...normalizeIdArray(b)])]
        .sort((x, y) => x - y);
}

async function mergePlayer(client, pokemonPlayer) {
    const nickname = String(pokemonPlayer.nickname).trim().slice(0, 20);

    if (!nickname) {
        return {
            action: 'skipped',
            nickname: pokemonPlayer.nickname
        };
    }

    const pokemonClearedIds = normalizeIdArray(pokemonPlayer.cleared_pokemon_ids);
    const pokemonClears = pokemonClearedIds.length || Number(pokemonPlayer.pokemon_clears || 0);

    const existingResult = await client.query(
        `
        SELECT
            id,
            nickname,
            pokemon_clears,
            cleared_pokemon_ids
        FROM players
        WHERE nickname = $1
        LIMIT 1;
        `,
        [nickname]
    );

    if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];

        const mergedIds = mergeUniqueIds(
            existing.cleared_pokemon_ids,
            pokemonClearedIds
        );

        await client.query(
            `
            UPDATE players
            SET
                cleared_pokemon_ids = $2::jsonb,
                pokemon_clears = $3
            WHERE id = $1;
            `,
            [
                existing.id,
                JSON.stringify(mergedIds),
                mergedIds.length
            ]
        );

        return {
            action: 'merged',
            nickname,
            before: normalizeIdArray(existing.cleared_pokemon_ids).length,
            addedFromPokemonDb: pokemonClearedIds.length,
            after: mergedIds.length
        };
    }

    // 統一先に同名がいない場合は新規作成
    // passcode_hash はポケモンDB側のものをそのまま使います。
    await client.query(
        `
        INSERT INTO players (
            nickname,
            passcode_hash,
            country_clears,
            capital_clears,
            pokemon_clears,
            cleared_country_ids,
            cleared_capital_ids,
            cleared_pokemon_ids,
            created_at
        )
        VALUES (
            $1,
            $2,
            0,
            0,
            $3,
            '[]'::jsonb,
            '[]'::jsonb,
            $4::jsonb,
            COALESCE($5, CURRENT_TIMESTAMP)
        );
        `,
        [
            nickname,
            pokemonPlayer.passcode_hash,
            pokemonClears,
            JSON.stringify(pokemonClearedIds),
            pokemonPlayer.created_at
        ]
    );

    return {
        action: 'inserted',
        nickname,
        after: pokemonClearedIds.length
    };
}

async function migrate() {
    const pokemonClient = await pokemonPool.connect();
    const unifiedClient = await unifiedPool.connect();

    let mergedCount = 0;
    let insertedCount = 0;
    let skippedCount = 0;

    try {
        console.log('🚀 ポケモンDB players → 統一先DB players への統合を開始します。');

        await ensureUnifiedPlayersSchema(unifiedClient);

        const pokemonPlayers = await fetchPokemonPlayers(pokemonClient);

        await unifiedClient.query('BEGIN');

        for (const player of pokemonPlayers) {
            const result = await mergePlayer(unifiedClient, player);

            if (result.action === 'merged') {
                mergedCount++;
                console.log(
                    `🔁 統合: ${result.nickname} ` +
                    `(既存${result.before}件 + ポケモンDB${result.addedFromPokemonDb}件 → ${result.after}件)`
                );
            } else if (result.action === 'inserted') {
                insertedCount++;
                console.log(`➕ 新規追加: ${result.nickname} (${result.after}件)`);
            } else {
                skippedCount++;
                console.log(`⚠️ スキップ: ${result.nickname}`);
            }
        }

        await unifiedClient.query('COMMIT');

        console.log('✅ プレイヤー統合完了');
        console.log(`📊 統合: ${mergedCount} 人`);
        console.log(`📊 新規追加: ${insertedCount} 人`);
        console.log(`📊 スキップ: ${skippedCount} 人`);

    } catch (error) {
        await unifiedClient.query('ROLLBACK');
        console.error('❌ プレイヤー統合に失敗しました:', error.message);
        process.exitCode = 1;

    } finally {
        pokemonClient.release();
        unifiedClient.release();

        await pokemonPool.end();
        await unifiedPool.end();
    }
}

migrate();