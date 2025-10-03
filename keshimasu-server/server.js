// ----------------------------------------------------
// Node.js (Express) サーバーコード - server.js
// ----------------------------------------------------
const express = require('express');
const cors = require('cors');
const app = express();

// ★ポート番号を環境変数 'PORT' から取得する（Renderなどのデプロイ環境で必須）
const PORT = process.env.PORT || 3000; 

// ミドルウェアの設定
// どこからのアクセスも許可する (開発/簡易デプロイ用)
app.use(cors()); 
// JSON形式のリクエストボディを解析できるようにする
app.use(express.json()); 

// --- ★仮のデータベース (メモリ内) ---
let players = []; 
let nextPlayerId = 1;

// ----------------------------------------------------
// 1. 認証/登録API: POST /api/player/register
// ----------------------------------------------------
// ニックネームを受け取り、プレイヤーを登録または識別する
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

    // プレイヤーIDと現在のスコアをフロントエンドに返し、同期させる
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
// 2. スコア更新API: POST /api/score/update
// ----------------------------------------------------
// プレイヤーIDとクリアしたモードを受け取り、スコアを1点加算する
app.post('/api/score/update', (req, res) => {
    const { playerId, mode } = req.body;
    
    if (!playerId || !['country', 'capital'].includes(mode)) {
        return res.status(400).json({ message: "無効なリクエストです。" });
    }

    // IDでプレイヤーを検索
    // Note: playerIdはフロントエンドで文字列として扱われる可能性があるため == を使用
    let player = players.find(p => p.id == playerId); 

    if (!player) {
        return res.status(404).json({ message: "プレイヤーが見つかりません。" });
    }

    // スコア加算と最終更新日の設定
    const scoreKey = mode + '_clears';
    player[scoreKey] += 1;
    player.last_updated = new Date();
    
    console.log(`スコア更新: ID${player.id} ${player.nickname} (${mode}: ${player[scoreKey]})`);

    // 更新後の新しいスコアを返す
    res.json({ message: "スコア更新成功", newScore: player[scoreKey] });
});


// ----------------------------------------------------
// 3. ランキング取得API: GET /api/rankings/:type
// ----------------------------------------------------
// 指定されたタイプ (total, country, capital) のランキングを返す
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

    // 上位10名に絞り、ランキング形式で整形して返す
    const ranking = sortedPlayers.slice(0, 10).map((p, index) => ({
        rank: index + 1,
        nickname: p.nickname,
        score: type === 'total' ? p.country_clears + p.capital_clears : p[type + '_clears']
    }));

    res.json(ranking);
});

// サーバー起動
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`★ Node.js Server running on port ${PORT}`);
    console.log(`★ API Base URL: http://localhost:${PORT}/api`);
    console.log(`==================================================`);
});