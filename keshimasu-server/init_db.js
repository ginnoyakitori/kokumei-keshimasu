// keshimasu-server/init_db.js
// PostgreSQLのテーブルを初期化するためのスクリプト

const db = require('./db');

//// 各JSONは { id: 1, data: [...], creator: "..." } の形式を想定// 初期パズルデータ
const COUNTRY_PUZZLES = require('./data/country_puzzles.json');
const CAPITAL_PUZZLES = require('./data/capital_puzzles.json');

async function initializeDatabase() {
    try {
        // ------------------------------
        // players テーブル作成
        // ------------------------------
        const createPlayersTable = `
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
        `;

        await db.query(createPlayersTable);
        console.log('✅ Table "players" created or already exists.');

        // 既存DBに後からカラム追加する場合にも対応
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

        console.log('✅ Table "players" columns checked.');

        // ------------------------------
        // puzzles テーブル作成
        // ------------------------------
        const createPuzzlesTable = `
            CREATE TABLE IF NOT EXISTS puzzles (
                id SERIAL PRIMARY KEY,
                mode VARCHAR(20) NOT NULL,
                data JSONB NOT NULL,
                creator VARCHAR(20) DEFAULT '銀の焼き鳥',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;

        await db.query(createPuzzlesTable);
        console.log('✅ Table "puzzles" created or already exists.');

        // ------------------------------
        // 初期パズル投入
        // 既に同じ id が存在する場合は更新する
        // ------------------------------
        const insertPuzzleQuery = `
            INSERT INTO puzzles (
                id,
                mode,
                data,
                creator
            )
            VALUES ($1, $2, $3::jsonb, $4)
            ON CONFLICT (id)
            DO UPDATE SET
                mode = EXCLUDED.mode,
                data = EXCLUDED.data,
                creator = EXCLUDED.creator;
        `;

        for (const puzzle of COUNTRY_PUZZLES) {
            await db.query(insertPuzzleQuery, [
                puzzle.id,
                'country',
                JSON.stringify(puzzle.data),
                puzzle.creator || '銀の焼き鳥'
            ]);
        }

        console.log(`✅ Country puzzles initialized: ${COUNTRY_PUZZLES.length}`);

        for (const puzzle of CAPITAL_PUZZLES) {
            await db.query(insertPuzzleQuery, [
                puzzle.id,
                'capital',
                JSON.stringify(puzzle.data),
                puzzle.creator || '銀の焼き鳥'
            ]);
        }

        console.log(`✅ Capital puzzles initialized: ${CAPITAL_PUZZLES.length}`);

        // ------------------------------
        // SERIAL の採番位置を現在の最大IDに合わせる
        // 手動で id を指定してINSERTした後のズレ対策
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
