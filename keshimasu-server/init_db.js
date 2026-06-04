// keshimasu-server/init_db.js
// PostgreSQLのテーブルを初期化するためのスクリプト
// 国名ケシマス + 首都名ケシマス + ポケモンケシマス 統一版
// 既存データを削除せず、足りないカラム・制約だけを追加/更新します。

const fs = require('fs');
const path = require('path');
const db = require('./db');

// ------------------------------
// JSON読み込み補助
// ファイルが無い場合でもサーバー起動を止めず、空配列として扱います。
// ------------------------------
function loadJsonArray(relativePath) {
    const fullPath = path.join(__dirname, relativePath);

    try {
        if (!fs.existsSync(fullPath)) {
            console.warn(`⚠️ ${relativePath} が見つかりません。空配列として扱います。`);
            return [];
        }

        const data = require(fullPath);

        if (!Array.isArray(data)) {
            console.warn(`⚠️ ${relativePath} は配列ではありません。空配列として扱います。`);
            return [];
        }

        return data;

    } catch (error) {
        console.warn(`⚠️ ${relativePath} の読み込みに失敗しました:`, error.message);
        return [];
    }
}

const COUNTRY_PUZZLES = loadJsonArray('./data/country_puzzles.json');
const CAPITAL_PUZZLES = loadJsonArray('./data/capital_puzzles.json');
const POKEMON_PUZZLES = loadJsonArray('./data/pokemon_puzzles.json');

// ------------------------------
// DBメタ情報確認
// ------------------------------
async function columnExists(tableName, columnName) {
    const result = await db.query(
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

async function getColumnType(tableName, columnName) {
    const result = await db.query(
        `
        SELECT data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2;
        `,
        [tableName, columnName]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
}

// ------------------------------
// 古い盤面カラムから data へコピー
// board_data / puzzle_data / board がある場合に対応
// ------------------------------
async function copyLegacyBoardColumnToData(columnName) {
    const exists = await columnExists('puzzles', columnName);

    if (!exists) {
        return;
    }

    const columnType = await getColumnType('puzzles', columnName);

    try {
        // board_data が NOT NULL の古いDBだと新規INSERT時に失敗するため、
        // NOT NULL制約だけ外します。データは削除しません。
        if (columnName === 'board_data') {
            await db.query(`
                ALTER TABLE puzzles
                ALTER COLUMN board_data DROP NOT NULL;
            `);

            console.log('✅ board_data NOT NULL constraint removed safely.');
        }

        // JSON / JSONB / TEXT のどれでも data(JSONB) に入れられる可能性があるため、
        // ::jsonb にキャストしてコピーします。
        await db.query(`
            UPDATE puzzles
            SET data = ${columnName}::jsonb
            WHERE (data IS NULL OR data = '[]'::jsonb)
              AND ${columnName} IS NOT NULL;
        `);

        console.log(`✅ Existing ${columnName} copied to data.`);

    } catch (error) {
        console.warn(
            `⚠️ ${columnName} から data へのコピーをスキップしました。` +
            ` カラム型: ${columnType ? columnType.data_type : 'unknown'} / ` +
            `理由: ${error.message}`
        );
    }
}

// ------------------------------
// 初期問題投入
// 既存データを消さず、同じ mode + source_id があれば1件だけ更新します。
// UNIQUE制約が無くても動くように、ON CONFLICT は使いません。
// ------------------------------
async function upsertInitialPuzzle(mode, puzzle) {
    if (!puzzle) return;

    const sourceId = Number(puzzle.id);

    if (!Number.isInteger(sourceId)) {
        console.warn(`⚠️ ${mode} の問題に不正な id があるためスキップしました:`, puzzle.id);
        return;
    }

    const puzzleData = puzzle.data || puzzle.boardData || puzzle.board_data;

    if (!Array.isArray(puzzleData)) {
        console.warn(`⚠️ ${mode} source_id=${sourceId} の data が配列ではないためスキップしました。`);
        return;
    }

    const creator = puzzle.creator || '銀の焼き鳥';

    const existingResult = await db.query(
        `
        SELECT id
        FROM puzzles
        WHERE mode = $1
          AND source_id = $2
        ORDER BY id ASC
        LIMIT 1;
        `,
        [mode, sourceId]
    );

    if (existingResult.rows.length > 0) {
        const existingId = existingResult.rows[0].id;

        await db.query(
            `
            UPDATE puzzles
            SET
                data = $2::jsonb,
                creator = $3
            WHERE id = $1;
            `,
            [
                existingId,
                JSON.stringify(puzzleData),
                creator
            ]
        );

    } else {
        await db.query(
            `
            INSERT INTO puzzles (
                mode,
                source_id,
                data,
                creator
            )
            VALUES ($1, $2, $3::jsonb, $4);
            `,
            [
                mode,
                sourceId,
                JSON.stringify(puzzleData),
                creator
            ]
        );
    }
}

async function initializeDatabase() {
    try {
        // =========================================================
        // players テーブル
        // =========================================================
        await db.query(`
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

        console.log('✅ Table "players" created or already exists.');

        // 既存DBに足りないカラムを追加
        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS country_clears INTEGER DEFAULT 0;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS capital_clears INTEGER DEFAULT 0;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS pokemon_clears INTEGER DEFAULT 0;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS cleared_country_ids JSONB DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS cleared_capital_ids JSONB DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS cleared_pokemon_ids JSONB DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        `);

        // ニックネーム長を20文字に統一
        await db.query(`
            ALTER TABLE players
            ALTER COLUMN nickname TYPE VARCHAR(20);
        `);

        // NULL対策
        await db.query(`
            UPDATE players
            SET country_clears = 0
            WHERE country_clears IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET capital_clears = 0
            WHERE capital_clears IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET pokemon_clears = 0
            WHERE pokemon_clears IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET cleared_country_ids = '[]'::jsonb
            WHERE cleared_country_ids IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET cleared_capital_ids = '[]'::jsonb
            WHERE cleared_capital_ids IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET cleared_pokemon_ids = '[]'::jsonb
            WHERE cleared_pokemon_ids IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET created_at = CURRENT_TIMESTAMP
            WHERE created_at IS NULL;
        `);

        console.log('✅ Table "players" columns checked.');

        // =========================================================
        // puzzles テーブル
        // =========================================================
        await db.query(`
            CREATE TABLE IF NOT EXISTS puzzles (
                id SERIAL PRIMARY KEY
            );
        `);

        console.log('✅ Table "puzzles" created or already exists.');

        await db.query(`
            ALTER TABLE puzzles
            ADD COLUMN IF NOT EXISTS mode VARCHAR(20);
        `);

        await db.query(`
            ALTER TABLE puzzles
            ADD COLUMN IF NOT EXISTS source_id INTEGER;
        `);

        await db.query(`
            ALTER TABLE puzzles
            ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE puzzles
            ADD COLUMN IF NOT EXISTS creator VARCHAR(20) DEFAULT '銀の焼き鳥';
        `);

        await db.query(`
            ALTER TABLE puzzles
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        `);

        await db.query(`
            ALTER TABLE puzzles
            ALTER COLUMN data SET DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE puzzles
            ALTER COLUMN creator SET DEFAULT '銀の焼き鳥';
        `);

        await db.query(`
            ALTER TABLE puzzles
            ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;
        `);

        console.log('✅ Table "puzzles" columns added if missing.');

        // 古いDBの盤面カラムから data へ移行
        await copyLegacyBoardColumnToData('board_data');
        await copyLegacyBoardColumnToData('puzzle_data');
        await copyLegacyBoardColumnToData('board');

        // 既存データの補正
        await db.query(`
            UPDATE puzzles
            SET source_id = id
            WHERE source_id IS NULL;
        `);

        await db.query(`
            UPDATE puzzles
            SET creator = '銀の焼き鳥'
            WHERE creator IS NULL OR creator = '';
        `);

        await db.query(`
            UPDATE puzzles
            SET data = '[]'::jsonb
            WHERE data IS NULL;
        `);

        await db.query(`
            UPDATE puzzles
            SET created_at = CURRENT_TIMESTAMP
            WHERE created_at IS NULL;
        `);

        // 既存の不明なmodeは unknown に寄せる
        // データは消さず、CHECK制約に通る値へ補正します。
        await db.query(`
            UPDATE puzzles
            SET mode = 'unknown'
            WHERE mode IS NULL
               OR mode = ''
               OR mode NOT IN ('country', 'capital', 'pokemon', 'unknown');
        `);

        console.log('✅ Existing puzzle data preserved and normalized.');

        // =========================================================
        // puzzles.mode の CHECK制約を3モード対応に更新
        // 古いDBに country/capital のみ許可する制約がある場合の対策
        // =========================================================
        await db.query(`
            ALTER TABLE puzzles
            DROP CONSTRAINT IF EXISTS puzzles_mode_check;
        `);

        await db.query(`
            ALTER TABLE puzzles
            ADD CONSTRAINT puzzles_mode_check
            CHECK (mode IN ('country', 'capital', 'pokemon', 'unknown'));
        `);

        console.log('✅ puzzles.mode check constraint updated.');

        // =========================================================
        // インデックス
        // UNIQUEにすると既存重複データで失敗する可能性があるため、
        // 既存データ保護を優先して通常インデックスにしています。
        // =========================================================
        await db.query(`
            CREATE INDEX IF NOT EXISTS puzzles_mode_source_id_idx
            ON puzzles (mode, source_id);
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS puzzles_mode_idx
            ON puzzles (mode);
        `);

        console.log('✅ Indexes for puzzles checked.');

        // =========================================================
        // 初期パズル投入
        // すべて同じ puzzles テーブルへ mode 付きで保存します。
        // =========================================================
        for (const puzzle of COUNTRY_PUZZLES) {
            await upsertInitialPuzzle('country', puzzle);
        }

        console.log(`✅ Country puzzles initialized: ${COUNTRY_PUZZLES.length}`);

        for (const puzzle of CAPITAL_PUZZLES) {
            await upsertInitialPuzzle('capital', puzzle);
        }

        console.log(`✅ Capital puzzles initialized: ${CAPITAL_PUZZLES.length}`);

        for (const puzzle of POKEMON_PUZZLES) {
            await upsertInitialPuzzle('pokemon', puzzle);
        }

        console.log(`✅ Pokemon puzzles initialized: ${POKEMON_PUZZLES.length}`);

        // SERIAL の採番位置を現在の最大IDに合わせる
        await db.query(`
            SELECT setval(
                pg_get_serial_sequence('puzzles', 'id'),
                COALESCE((SELECT MAX(id) FROM puzzles), 1),
                true
            );
        `);

        console.log('✅ Puzzle sequence adjusted.');
        console.log('✅ Database initialization completed.');

    } catch (error) {
        console.error('❌ Failed to initialize database tables:', error.message);
        throw error;
    }
}

module.exports = initializeDatabase;