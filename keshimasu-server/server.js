const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
// uuidパッケージが必要です: npm install uuid
const { v4: uuidv4 } = require('uuid'); 

const app = express();
const PORT = process.env.PORT || 3000;

// CORS設定: すべてのオリジンからのアクセスを許可
app.use(cors());
app.use(bodyParser.json());

// --- サーバー側のインメモリ・データベース (問題はここに移管) ---

let players = {
    // デフォルトユーザーの初期データ
    'default-user-id': {
        id: 'default-user-id', 
        nickname: '銀の焼き鳥', 
        passcode: '0425',
        country_clears: 0, 
        capital_clears: 0
    }
};

// 問題データ (クライアントの初期問題をこちらに移管)
let puzzles = {
    country: [
        { 
            id: uuidv4(),
            data: [
                ['マ', 'ベ', 'ナ', 'ン', 'マ'], 
                ['ル', 'サ', 'モ', 'ア', 'リ'], 
                ['タ', 'イ', 'エ', 'メ', 'ン'], 
                ['ニ', 'ホ', 'ン', 'F', 'グ'],
                ['ア', 'メ', 'リ', 'カ', 'F'],
                ['イ', 'ギ', 'リ', 'ス', 'F'],
                ['ド', 'イ', 'ツ', 'リ', 'マ'],
                ['ラ', 'ト', 'ビ', 'ア', 'ラ']
            ], 
            creator: '銀の焼き鳥',
            timestamp: 1 
        },
    ],
    capital: [
        { 
            id: uuidv4(),
            data: [
                ['パ', 'ラ', 'ソ', 'ウ', 'ル'], 
                ['ザ', 'タ', 'マ', 'リ', 'ボ'], 
                ['F', 'リ', 'ぺ', 'キ', 'ン'], 
                ['レ', 'ン', 'リ', 'ガ', 'ベ'],
                ['F', 'ボ', 'F', 'タ', 'F'],
                ['ダ', 'ブ', 'リ', 'ン', 'ル'],
                ['パ', 'リ', 'ジ', 'ャ', 'ー'],
                ['ア', 'ブ', 'リ', 'マ', 'ト']
            ], 
            creator: '銀の焼き鳥',
            timestamp: 1 
        },
    ]
};

// ----------------------------------------------------
// APIエンドポイント
// ----------------------------------------------------

// 1. 問題取得エンドポイント (GET /api/puzzles/country または /capital)
app.get('/api/puzzles/:mode', (req, res) => {
    const { mode } = req.params;
    if (mode === 'country' || mode === 'capital') {
        // 古い問題から順番に出題するため、timestampでソートして返す
        const sortedPuzzles = puzzles[mode].sort((a, b) => a.timestamp - b.timestamp);
        res.json(sortedPuzzles);
    } else {
        res.status(400).send({ message: '無効なモードです。' });
    }
});

// 2. 問題登録エンドポイント (POST /api/puzzles) (新規追加)
app.post('/api/puzzles', (req, res) => {
    const { mode, boardData, creator } = req.body;
    
    if (!mode || !boardData || !creator) {
        return res.status(400).send({ message: '問題データが不完全です。' });
    }

    const newPuzzle = {
        id: uuidv4(),
        data: boardData,
        creator: creator,
        timestamp: Date.now() // 登録時刻を記録
    };

    puzzles[mode].push(newPuzzle);
    
    res.status(201).send({ message: '新しい問題が標準リストに登録されました！', puzzle: newPuzzle });
});


// 3. プレイヤー認証、スコア更新、ランキングAPI (既存ロジックは省略)

app.post('/api/player/register', (req, res) => {
    const { nickname, passcode } = req.body;
    let player = Object.values(players).find(p => p.nickname === nickname);

    if (player) {
        if (player.passcode === passcode) {
            res.json({ message: 'ログイン成功', player: player });
        } else {
            res.status(401).send({ message: 'パスコードが違います。' });
        }
    } else {
        const newId = uuidv4();
        player = { id: newId, nickname, passcode, country_clears: 0, capital_clears: 0 };
        players[newId] = player;
        res.json({ message: '新規登録成功', player: player });
    }
});

app.post('/api/score/update', (req, res) => {
    const { playerId, mode } = req.body;
    const player = players[playerId];

    if (!player) {
        return res.status(404).send({ message: 'プレイヤーが見つかりません。' });
    }

    const scoreKey = `${mode}_clears`;
    if (player.hasOwnProperty(scoreKey)) {
        player[scoreKey] += 1;
        res.json({ message: 'スコア更新成功', newScore: player[scoreKey] });
    } else {
        res.status(400).send({ message: '無効なモードです。' });
    }
});

app.get('/api/rankings/:type', (req, res) => {
    const { type } = req.params;
    let rankingData = Object.values(players);

    if (type === 'total') {
        rankingData.forEach(p => p.score = p.country_clears + p.capital_clears);
    } else if (type === 'country' || type === 'capital') {
        rankingData.forEach(p => p.score = p[`${type}_clears`]);
    } else {
        return res.status(400).send({ message: '無効なランキングタイプです。' });
    }

    rankingData.sort((a, b) => b.score - a.score);

    const rankings = rankingData.map((p, index) => ({
        rank: index + 1,
        nickname: p.nickname,
        score: p.score
    }));

    res.json(rankings);
});


app.listen(PORT, () => {
    console.log(`サーバーはポート ${PORT} で起動中です`);
});