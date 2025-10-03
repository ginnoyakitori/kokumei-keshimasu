// ----------------------------------------------------
// Node.js (Express) サーバーコード - server.js
// ----------------------------------------------------
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3000;

// ミドルウェアの設定
// ★重要: フロントエンドとバックエンドが異なるポートで動くためCORSを許可
app.use(cors()); 
app.use(express.json()); // JSON形式のリクエストボディを解析

// --- ★仮のデータベース (メモリ内) ---
// サーバーを再起動するとデータはリセットされます
let players = []; 
let nextPlayerId = 1;

// ----------------------------------------------------
// 1. 認証/登録API (簡略版: ニックネームのみで登録/識別)
// ----------------------------------------------------
app.post('/api/player/register', (req, res) => {
    const { nickname } = req.body;
    if (!nickname) {
        return res.status(400).json({ message: "ニックネームが必要です。" });
    }

    // 既に存在するプレイヤーかチェック
    let player = players.find(p => p.nickname === nickname);
    if (!player) {
        // 新規登録
        player = {
            id: nextPlayerId++,
            nickname,
            country_clears: 0,
            capital_clears: 0,
            last_updated: new Date()
        };
        players.push(player);
        console.log(`新規プレイヤー登録: ID${player.id}, ${nickname}`);
    } else {
        console.log(`既存プレイヤー識別: ID${player.id}, ${nickname}`);
    }

    // プレイヤーIDと現在のスコアをフロントエンドに返す
    res.json({ 
        message: "プレイヤー情報取得成功",
        player: {
            id: player.id,
            nickname: player.nickname,
            country_clears: player.country_clears,
            capital_clears: player.capital_clears
        }
    });
});


// ----------------------------------------------------
// 2. スコア更新API
// ----------------------------------------------------
app.post('/api/score/update', (req, res) => {
    // プレイヤーIDではなく、ニックネームをキーとして受け取るように変更（簡易化のため）
    const { playerId, mode } = req.body;
    
    if (!playerId || !['country', 'capital'].includes(mode)) {
        return res.status(400).json({ message: "無効なリクエストです。" });
    }

    // IDでプレイヤーを検索
    let player = players.find(p => p.id === playerId);

    if (!player) {
        return res.status(404).json({ message: "プレイヤーが見つかりません。" });
    }

    // スコア加算
    const scoreKey = mode + '_clears';
    player[scoreKey] += 1;
    player.last_updated = new Date();
    
    console.log(`スコア更新: ID${player.id} ${player.nickname} (${mode}: ${player[scoreKey]})`);

    res.json({ message: "スコア更新成功", newScore: player[scoreKey] });
});


// ----------------------------------------------------
// 3. ランキング取得API
// ----------------------------------------------------
app.get('/api/rankings/:type', (req, res) => {
    const type = req.params.type;
    let sortedPlayers;

    // ゲストプレイヤーを除外したリスト
    const actualPlayers = players.filter(p => p.nickname !== 'ゲスト');

    if (type === 'total') {
        // 合計クリア数でソート
        sortedPlayers = actualPlayers.sort((a, b) => 
            (b.country_clears + b.capital_clears) - (a.country_clears + a.capital_clears)
        );
    } else if (type === 'country' || type === 'capital') {
        // 国名/首都名クリア数でソート
        const key = type + '_clears';
        sortedPlayers = actualPlayers.sort((a, b) => b[key] - a[key]);
    } else {
        return res.status(400).json({ message: "無効なランキングタイプです。" });
    }

    // 上位10名に絞り、ランキング形式で整形
    const ranking = sortedPlayers.slice(0, 10).map((p, index) => ({
        rank: index + 1,
        nickname: p.nickname,
        score: type === 'total' ? p.country_clears + p.capital_clears : p[type + '_clears']
    }));

    res.json(ranking);
});

// サーバー起動ログ
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`★ Node.js Server running on http://localhost:${PORT}`);
    console.log(`==================================================`);
});