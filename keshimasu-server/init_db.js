// keshimasu-server/init_db.js
// PostgreSQLのテーブルを初期化するためのスクリプト

const db = require('./db');
// 初期パズルのデータ構造が { data: [...], creator: "..." } であることを前提とする
const COUNTRY_PUZZLES = require('./data/country_puzzles.json');
const CAPITAL_PUZZLES = require('./data/capital_puzzles.json');

/**
 * データベースを初期化し、必要なテーブルを作成する。
 */
async function initializeDatabase() {
    try {
        // --- 1. players テーブルの定義 (created_at と DEFAULT 0 を含む) ---
        const createPlayersTable = `
            CREATE TABLE IF NOT EXISTS players (
                id SERIAL PRIMARY KEY,
                nickname VARCHAR(10) UNIQUE NOT NULL,
                passcode_hash TEXT NOT NULL,
                country_clears INTEGER DEFAULT 0,
                capital_clears INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await db.query(createPlayersTable);
        console.log('✅ Table "players" created or already exists.');

        // --- 2. puzzles テーブルの定義 (created_at を含む) ---
        const createPuzzlesTable = `
            CREATE TABLE IF NOT EXISTS puzzles (
                id SERIAL PRIMARY KEY,
                mode VARCHAR(10) NOT NULL CHECK (mode IN ('country', 'capital')),
                board_data JSONB NOT NULL,
                creator VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await db.query(createPuzzlesTable);
        console.log('✅ Table "puzzles" created or already exists.');
        
        // --- 3. 初期パズルの投入（データが存在しない場合のみ） ---
        const countResult = await db.query('SELECT COUNT(*) FROM puzzles');
        const puzzleCount = parseInt(countResult.rows[0].count, 10);

        if (puzzleCount === 0) {
            console.log('ℹ️ Initializing puzzles...');

            // ★エラー解消の核となる修正: DBの列名 'board_data' にパズルデータの 'data' を正しくマッピングする
            const countryPuzzles = COUNTRY_PUZZLES.map(p => ({ 
                mode: 'country', 
                board_data: p.data, // JSONファイルの "data" を DBの "board_data" にマッピング
                creator: p.creator 
            }));
            const capitalPuzzles = CAPITAL_PUZZLES.map(p => ({ 
                mode: 'capital', 
                board_data: p.data, 
                creator: p.creator 
            }));

            const allInitialPuzzles = [...countryPuzzles, ...capitalPuzzles];
            
            for (const puzzle of allInitialPuzzles) {
                // board_data は JSONB 型に格納するため、オブジェクトのまま渡す
                await db.query(
                    'INSERT INTO puzzles (mode, board_data, creator) VALUES ($1, $2, $3)',
                    [puzzle.mode, puzzle.board_data, puzzle.creator]
                );
            }
            console.log(`✅ ${allInitialPuzzles.length} initial puzzles inserted.`);
        } else {
            console.log(`ℹ️ Puzzles already exist (${puzzleCount} total). Skipping initial insertion.`);
        }

        return true;

    } catch (error) {
        console.error('❌ Failed to initialize database tables:', error.message);
        throw error;
    }
}

module.exports = initializeDatabase;