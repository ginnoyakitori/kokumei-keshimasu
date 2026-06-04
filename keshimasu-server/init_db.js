// keshimasu-server/init_db.js
// PostgreSQLのテーブルを初期化するためのスクリプト
// 既存データを消さず、足りないカラムだけ追加する安全版

const db = require('./db');

const COUNTRY_PUZZLES = require('./data/country_puzzles.json');
const CAPITAL_PUZZLES = require('./data/capital_puzzles.json');

async function columnExists(tableName, columnName) {
    const result = await db.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = $1
          AND column_name = $2;
        `,
        [tableName, columnName]
    );

    return result.rows.length > 0;
}

async function initializeDatabase() {
    try {
        // ------------------------------
        // players テーブル作成
        // ------------------------------
        await db.query(`
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                nickname VARCHAR(20) UNIQUE NOT NULL,
                passcode_hash TEXT NOT NULL,
                country_clears INTEGER DEFAULT 0,
                capital_clears INTEGER DEFAULT 0,
                cleared_country_ids JSONB DEFAULT '[]'::jsonb,
                cleared_capital_ids JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('✅ Table "players" created or already exists.');

        // 既存 players テーブルに足りないカラムだけ追加
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
            ADD COLUMN IF NOT EXISTS cleared_country_ids JSONB DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS cleared_capital_ids JSONB DEFAULT '[]'::jsonb;
        `);

        await db.query(`
            ALTER TABLE players
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
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
            SET cleared_country_ids = '[]'::jsonb
            WHERE cleared_country_ids IS NULL;
        `);

        await db.query(`
            UPDATE players
            SET cleared_capital_ids = '[]'::jsonb
            WHERE cleared_capital_ids IS NULL;
        `);

        console.log('✅ Table "players" columns checked.');

        // ------------------------------
        // puzzles テーブル作成
        // 既に存在する場合は中身を消さない
        // ------------------------------
        await db.query(`
            CREATE TABLE IF NOT EXISTS puzzles (
                id SERIAL PRIMARY KEY
            );
        `);

        console.log('✅ Table "puzzles" created or already exists.');

        // 既存 puzzles テーブルに足りないカラムだけ追加
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

        console.log('✅ Table "puzzles" columns added if missing.');

        // ------------------------------
        // 既存データ保護・移行
        // data カラムが今回新しく追加された場合、
        // 既存の board_data / puzzle_data / board などからコピーを試みる
        // ------------------------------
        const hasBoardData = await columnExists('puzzles', 'board_data');
        const hasPuzzleData = await columnExists('puzzles', 'puzzle_data');
        const hasBoard = await columnExists('puzzles', 'board');

        if (hasBoardData) {
            await db.query(`
                UPDATE puzzles
                SET data = board_data
                WHERE (data IS NULL OR data = '[]'::jsonb)
                  AND board_data IS NOT NULL;
            `);

            console.log('✅ Existing board_data copied to data.');
        }

        if (hasPuzzleData) {
            await db.query(`
                UPDATE puzzles
                SET data = puzzle_data
                WHERE (data IS NULL OR data = '[]'::jsonb)
                  AND puzzle_data IS NOT NULL;
            `);

            console.log('✅ Existing puzzle_data copied to data.');
        }

        if (hasBoard) {
            await db.query(`
                UPDATE puzzles
                SET data = board
                WHERE (data IS NULL OR data = '[]'::jsonb)
                  AND board IS NOT NULL;
            `);

            console.log('✅ Existing board copied to data.');
        }

        // source_id が空なら既存の id を入れる
        await db.query(`
            UPDATE puzzles
            SET source_id = id
            WHERE source_id IS NULL;
        `);

        // creator が空なら既定値
        await db.query(`
            UPDATE puzzles
            SET creator = '銀の焼き鳥'
            WHERE creator IS NULL OR creator = '';
        `);

        // data が NULL の場合だけ空配列にする
        // 既存の data は消さない
        await db.query(`
            UPDATE puzzles
            SET data = '[]'::jsonb
            WHERE data IS NULL;
        `);

        // created_at が NULL の場合だけ現在時刻
        await db.query(`
            UPDATE puzzles
            SET created_at = CURRENT_TIMESTAMP
            WHERE created_at IS NULL;
        `);

        console.log('✅ Existing puzzle data preserved and normalized.');

        // ------------------------------
        // mode が空の既存データについて
        // ここでは無理に全件 country にしない
        // ただし source_id と mode のユニーク制約を作るため、
        // mode が NULL の行には temporary を入れる
        // ------------------------------
        await db.query(`
            UPDATE puzzles
            SET mode = 'unknown'
            WHERE mode IS NULL OR mode = '';
        `);

        console.log('✅ Existing puzzle mode checked.');

        // ------------------------------
        // mode + source_id の重複防止
        // 同じ初期IDでも country / capital で共存できる
        // ------------------------------
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS puzzles_mode_source_id_unique
            ON puzzles (mode, source_id);
        `);

        console.log('✅ Unique index for puzzles checked.');

        // ------------------------------
        // 初期パズル投入
        // 既存データを消さず、同じ mode + source_id があれば更新
        // ------------------------------
        const insertPuzzleQuery = `
            INSERT INTO puzzles (
                mode,
                source_id,
                data,
                creator
            )
            VALUES ($1, $2, $3::jsonb, $4)
            ON CONFLICT (mode, source_id)
            DO UPDATE SET
                data = EXCLUDED.data,
                creator = EXCLUDED.creator;
        `;

        for (const puzzle of COUNTRY_PUZZLES) {
            await db.query(insertPuzzleQuery, [
                'country',
                puzzle.id,
                JSON.stringify(puzzle.data),
                puzzle.creator || '銀の焼き鳥'
            ]);
        }

        console.log(`✅ Country puzzles initialized: ${COUNTRY_PUZZLES.length}`);

        for (const puzzle of CAPITAL_PUZZLES) {
            await db.query(insertPuzzleQuery, [
                'capital',
                puzzle.id,
                JSON.stringify(puzzle.data),
                puzzle.creator || '銀の焼き鳥'
            ]);
        }

        console.log(`✅ Capital puzzles initialized: ${CAPITAL_PUZZLES.length}`);

        // ------------------------------
        // SERIAL の採番位置調整
        // ------------------------------
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