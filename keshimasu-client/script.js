// ----------------------------------------------------
// フロントエンド JavaScript コード - script.js (最終修正版)
// ----------------------------------------------------

// ★★★ 🚨 要修正 ★★★
// あなたのRender Web ServiceのURLに必ず置き換えてください。
const API_BASE_URL = 'https://kokumei-keshimasu.onrender.com/api'; 

// --- 1. 定数と初期データ ---

// ★★★ 修正箇所 1: ダミー問題を削除し、1問のみにする ★★★
// 国名ケシマス用初期盤面リスト
const initialBoardData_Country_List = [
    // 問題 0 (最も古い問題として優先出題)
    { 
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
        creator: '銀の焼き鳥' 
    },
];

// 首都名ケシマス用初期盤面リスト
const initialBoardData_Capital_List = [
    // 問題 0 (最も古い問題として優先出題)
    { 
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
        creator: '銀の焼き鳥' 
    },
];
// ★★★ 修正箇所 1: ここまで ★★★


const COUNTRY_DICT = ['アメリカ', 'イギリス', 'ドイツ', 'フランス', 'ニホン', 'タイワン'];
const CAPITAL_DICT = ['トウキョウ', 'パリ', 'ロンドン', 'ベルリン', 'ローマ']; 

// ゲームの状態変数
let boardData = []; 
let initialPlayData = []; 
let selectedCells = []; 
let usedWords = [];     
let isCountryMode = true; 
let isCreationPlay = false; 
let currentDictionary = COUNTRY_DICT;
let currentPuzzleIndex = -1; 

// ランキング/プレイヤー関連
let currentPlayerNickname = "ゲスト";
let currentPlayerId = null; 
let playerStats = { 
    country_clears: 0,
    capital_clears: 0
};


// DOM要素の取得
const screens = {
    home: document.getElementById('home-screen'),
    mainGame: document.getElementById('main-game-screen'),
    create: document.getElementById('create-puzzle-screen'),
    ranking: document.getElementById('ranking-screen') 
};
const boardElement = document.getElementById('board');
const eraseButton = document.getElementById('erase-button');
const createBoardElement = document.getElementById('create-board');
const btnInputComplete = document.getElementById('btn-input-complete');
const resetBtn = document.getElementById('reset-button');


// --- ユーティリティ関数 ---

/** ひらがなをカタカナに変換する関数 */
function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, function(match) {
        var chr = match.charCodeAt(0) + 0x60;
        return String.fromCharCode(chr);
    });
}

/** 文字がFまたはカタカナであるかをチェックする */
function isValidGameChar(char) {
    if (char === 'F') return true;
    return /^[\u30a0-\u30ff]$/.test(char); 
}

// --- LocalStorageによるクリア状態管理 ---

/**
 * LocalStorageからクリアした問題のインデックスリストを取得する
 */
function getClearedPuzzles(mode) {
    const key = `cleared_puzzles_${mode}`;
    const cleared = localStorage.getItem(key);
    return cleared ? JSON.parse(cleared) : [];
}

/**
 * LocalStorageにクリアした問題のインデックスを記録する
 */
function markPuzzleAsCleared(mode, index) {
    const key = `cleared_puzzles_${mode}`;
    let cleared = getClearedPuzzles(mode);
    if (!cleared.includes(index)) {
        cleared.push(index);
        localStorage.setItem(key, JSON.stringify(cleared));
    }
}

// --- サーバー連携・プレイヤー認証 ---

async function setupPlayer() {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname') || "ゲスト";

    const defaultNickname = '銀の焼き鳥';
    const defaultPasscode = '0425';

    // 「銀の焼き鳥」の自動初回登録/ログイン
    if (currentPlayerNickname === defaultNickname && currentPlayerId) {
        await registerPlayer(defaultNickname, defaultPasscode);
    } else if (currentPlayerNickname === "ゲスト" && !localStorage.getItem('default_user_checked')) {
        localStorage.setItem('default_user_checked', 'true');
        await registerPlayer(defaultNickname, defaultPasscode);
    }
    
    // 現在のユーザーがゲストの場合は、手動でログイン/登録を促す
    if (currentPlayerNickname === "ゲスト" || !currentPlayerId) {
        alert("ニックネームとパスコードを設定して、ランキングに挑戦しましょう！");
        await promptForNickname(true);
    }
    
    // ★★★ 修正箇所 3: 初期化時に問題数を表示 ★★★
    updateHomeProblemCount();
}

async function promptForNickname(isInitialRegistration) {
    while (true) {
        let nickname = prompt(`ニックネームを入力してください (10文字以内):`);
        if (!nickname || nickname.trim() === "") {
            if (isInitialRegistration) {
                alert("ニックネームの入力は必須です。");
                continue;
            }
            currentPlayerNickname = "ゲスト";
            currentPlayerId = null;
            return;
        }

        const finalName = nickname.trim().slice(0, 10);
        
        let passcode = prompt(`${finalName}さんのパスコードを入力してください (新規登録/ログイン):`);
        if (!passcode || passcode.trim() === "") {
            alert("パスコードの入力は必須です。");
            continue;
        }

        const success = await registerPlayer(finalName, passcode);
        if (success) {
            alert(`${finalName}さん、${isInitialRegistration ? '新規登録' : 'ログイン'}成功です！`);
            break; 
        } else {
            const retry = confirm("認証に失敗しました。再試行しますか？");
            if (!retry) {
                currentPlayerNickname = "ゲスト";
                currentPlayerId = null;
                alert("ゲストとしてゲームを開始します。スコアは保存されません。");
                break;
            }
        }
    }
}

async function registerPlayer(nickname, passcode) {
    try {
        const response = await fetch(`${API_BASE_URL}/player/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname, passcode })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error(`認証失敗: ${data.message || 'サーバーエラー'}`);
            if (nickname !== '銀の焼き鳥') {
                alert(`認証失敗: ${data.message || 'サーバーエラー'}`);
            }
            throw new Error(data.message);
        }
        
        if (data.player) {
            currentPlayerNickname = data.player.nickname;
            currentPlayerId = data.player.id; 
            playerStats.country_clears = data.player.country_clears;
            playerStats.capital_clears = data.player.capital_clears;
            
            localStorage.setItem('keshimasu_nickname', currentPlayerNickname);
            localStorage.setItem('player_id', currentPlayerId);
            return true;
        }
    } catch (error) {
        console.error("プレイヤー認証/登録に失敗しました。", error);
        return false;
    }
}


// --- 2. 画面表示と初期化 ---

function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        screens[key].style.display = (key === screenName) ? 'block' : 'none';
    });
    if (screenName === 'home') {
        updateHomeProblemCount();
    }
}

/**
 * ホーム画面に問題数を表示する
 */
// ★★★ 修正箇所 2: ホーム画面の問題数表示関数を追加 ★★★
function updateHomeProblemCount() {
    const countryCount = initialBoardData_Country_List.length;
    const capitalCount = initialBoardData_Capital_List.length;
    
    document.getElementById('country-problem-count').textContent = `問題数: ${countryCount}問`;
    document.getElementById('capital-problem-count').textContent = `問題数: ${capitalCount}問`;
}
// ★★★ 修正箇所 2: ここまで ★★★

/**
 * ゲームの開始。未クリアの問題の中からインデックスが最も小さいものを選択する。
 */
function startGame(isCountry, isCreation) {
    const mode = isCountry ? 'country' : 'capital';
    const problemList = isCountry ? initialBoardData_Country_List : initialBoardData_Capital_List;
    
    // 制作モードではない場合のみ、問題選択ロジックを実行
    if (!isCreation) {
        const clearedIndices = getClearedPuzzles(mode);
        const availableIndices = problemList
            .map((_, index) => index)
            .filter(index => !clearedIndices.includes(index));

        if (availableIndices.length === 0) {
            alert(`🎉 ${isCountry ? '国名' : '首都名'}ケシマスのすべての問題をクリアしました！`);
            showScreen('home');
            return;
        }

        // 未クリアの問題の中から、インデックスが最も小さいもの（最も古い問題）を選択
        const selectedIndex = Math.min(...availableIndices);
        
        currentPuzzleIndex = selectedIndex;
        
        // 選択された問題データを取得
        const selectedPuzzle = problemList[selectedIndex];
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
    } else {
        // 制作モードの場合、盤面データはボタンクリック時に設定される
        currentPuzzleIndex = -1; // 制作モードはインデックス管理不要
    }

    isCountryMode = isCountry;
    isCreationPlay = isCreation; 
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT;
    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;
    
    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';
    
    // 一番上のタイトルを変更
    document.getElementById('current-game-title').textContent = modeName; 
    
    // 問題番号の表示を「クリア数 + 1」に戻す
    const currentClearCount = playerStats[mode + '_clears'] || 0;
    const nextProblemNumber = currentClearCount + 1;
    
    // 問題に関する情報 (制作モードか、次の問題番号か)
    document.getElementById('problem-number-display').textContent = 
        isCreation 
        ? '問題制作モード' 
        : `第 ${nextProblemNumber} 問`; // 例: 第 1 問
        
    // 制作者名を表示するロジック
    let creatorName = '銀の焼き鳥'; // 標準問題のデフォルト制作者名
    if (isCreation) {
        creatorName = currentPlayerNickname;
    } else if (currentPuzzleIndex !== -1) {
        creatorName = problemList[currentPuzzleIndex].creator;
    }
    document.getElementById('creator-display').textContent = `制作者: ${creatorName}`;
        
    updateStatusDisplay();
    // 盤面表示を5行に戻す
    renderBoard(5); 
    showScreen('mainGame');
}

function renderBoard(visibleRows) { 
    boardElement.innerHTML = '';
    // 盤面表示を visibleRows (通常5行) に基づいて行う
    const startRow = boardData.length - visibleRows; 
    
    for (let r = startRow; r < boardData.length; r++) {
        for (let c = 0; c < boardData[r].length; c++) {
            const cell = document.createElement('div');
            const char = boardData[r][c];

            cell.classList.add('cell');
            cell.dataset.r = r; 
            cell.dataset.c = c;
            cell.textContent = char;
            
            if (char === '') {
                cell.classList.add('empty');
            } else {
                cell.addEventListener('click', handleCellClick);
            }

            const isSelected = selectedCells.some(coord => coord[0] === r && coord[1] === c);
            if (isSelected) {
                cell.classList.add('selected');
            }
            
            boardElement.appendChild(cell);
        }
    }
}

function updateStatusDisplay() { 
    document.getElementById('used-words-display').textContent = usedWords.join(', ') || 'なし';
}

async function updatePlayerScore(mode) {
    if (!currentPlayerId || isCreationPlay) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/score/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                playerId: currentPlayerId,
                mode: mode 
            })
        });
        
        if (!response.ok) throw new Error('スコア更新サーバーエラー');

        const data = await response.json();
        
        playerStats[mode + '_clears'] = data.newScore;
        
    } catch (error) {
        console.error("スコア更新に失敗しました。", error);
    }
}

async function checkGameStatus() { 
    const totalChars = boardData.flat().filter(char => char !== '').length;
    
    if (totalChars === 0) {
        const mode = isCountryMode ? 'country' : 'capital';
        const modeName = isCountryMode ? '国名' : '首都名';
        
        if (!isCreationPlay) {
            // 標準問題のクリア処理
            if (currentPuzzleIndex !== -1) {
                markPuzzleAsCleared(mode, currentPuzzleIndex); // LocalStorageにクリアを記録
            }

            await updatePlayerScore(mode); 
            const nextClearCount = playerStats[mode + '_clears'];
            alert(`🎉 全ての文字を消去しました！クリアです！\nあなたの${modeName}クリア数は${nextClearCount}問になりました。`);
        } else {
            alert("🎉 作成した問題をクリアしました！\nこの問題を登録できます。(ランキング反映なし)");
        }
        showScreen('home');
    }
}


// --- 3. ゲームロジックの中核 ---

function applyGravity() { 
    for (let c = 0; c < 5; c++) {
        let columnChars = [];
        for (let r = boardData.length - 1; r >= 0; r--) {
            if (boardData[r][c] !== '') {
                columnChars.unshift(boardData[r][c]); 
            }
        }
        let newColumn = Array(8 - columnChars.length).fill('');
        newColumn = newColumn.concat(columnChars);

        for (let r = 0; r < 8; r++) {
            boardData[r][c] = newColumn[r];
        }
    }
}

/** セルクリックハンドラ */
function handleCellClick(event) { 
    const r = parseInt(event.target.dataset.r);
    const c = parseInt(event.target.dataset.c);

    if (selectedCells.length === 0) {
        selectedCells.push([r, c]);
        eraseButton.disabled = false;
    } else {
        const [prevR, prevC] = selectedCells[selectedCells.length - 1];
        
        const isHorizontal = r === prevR && Math.abs(c - prevC) === 1;
        const isVertical = c === prevC && Math.abs(r - prevR) === 1;

        const index = selectedCells.findIndex(coord => coord[0] === r && coord[1] === c);
        if (index > -1) {
            selectedCells.splice(index + 1);
        }
        else if (isHorizontal || isVertical) {
            
            let shouldAdd = false;
            
            if (selectedCells.length === 1) {
                shouldAdd = true;
            } else {
                const [firstR, firstC] = selectedCells[0];
                
                const isCurrentPatternHorizontal = selectedCells.every(coord => coord[0] === firstR);
                const isCurrentPatternVertical = selectedCells.every(coord => coord[1] === firstC);
                
                if (isCurrentPatternHorizontal) {
                    if (r === firstR && isHorizontal) {
                        shouldAdd = true;
                    }
                } 
                else if (isCurrentPatternVertical) {
                    if (c === firstC && isVertical) {
                        shouldAdd = true;
                    }
                }
            }

            if (shouldAdd) {
                selectedCells.push([r, c]);
            } else {
                selectedCells = [[r, c]];
            }
        } 
        else {
            selectedCells = [[r, c]];
        }
    }
    
    eraseButton.disabled = selectedCells.length < 2;
    renderBoard(5); // 5行表示
}

/** 消去ボタンイベントリスナー (Fの文字置き換えロジック修正済み) */
eraseButton.addEventListener('click', async () => { 
    if (selectedCells.length < 2) return;

    let selectedWordChars = selectedCells.map(([r, c]) => boardData[r][c]); 
    let selectedWord = selectedWordChars.join(''); 
    let finalWord = ''; 

    const mode = isCountryMode ? '国名' : '首都名';
    
    if (selectedWord.includes('F')) {
        let tempWordChars = [...selectedWordChars]; 
        let fIndices = []; 

        selectedWordChars.forEach((char, index) => {
            if (char === 'F') {
                fIndices.push(index);
            }
        });

        for (const index of fIndices) {
            let inputChar = '';
            
            const promptText = `「${selectedWord}」のうち、${index + 1}文字目（F）を何にしますか？`;
            let input = prompt(promptText);

            if (input && input.trim() !== '') {
                inputChar = toKatakana(input).toUpperCase().slice(0, 1);
                if (!isValidGameChar(inputChar)) {
                    alert('入力された文字は有効ではありません。');
                    return; 
                }
                tempWordChars[index] = inputChar; 
            } else {
                alert('文字が入力されませんでした。');
                return; 
            }
        }
        finalWord = tempWordChars.join('');
    } else {
        finalWord = selectedWord;
    }

    if (!currentDictionary.includes(finalWord)) {
        alert(`「${finalWord}」は有効な${mode}ではありません。`);
        return;
    }

    if (usedWords.includes(finalWord)) {
        alert(`「${finalWord}」は既に使用済みです。`);
        return;
    }

    selectedCells.forEach(([r, c]) => {
        boardData[r][c] = '';
    });
    
    usedWords.push(finalWord);
    
    applyGravity();
    
    selectedCells = [];
    eraseButton.disabled = true;
    
    renderBoard(5); // 5行表示
    updateStatusDisplay();
    await checkGameStatus();
});

resetBtn.addEventListener('click', () => { 
    // リセットボタンを押したときの処理
    if (isCreationPlay) {
        // 制作モードの場合、制作画面に戻る
        showScreen('create');
        
        // 元々入力完了後に押せるようになっていたボタンを有効に戻す
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';
        
    } else if (currentPuzzleIndex !== -1) {
        // 標準問題のリセット
        const problemList = isCountryMode ? initialBoardData_Country_List : initialBoardData_Capital_List;
        const selectedPuzzle = problemList[currentPuzzleIndex];
        
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        selectedCells = [];
        usedWords = [];
        eraseButton.disabled = true;
        
        renderBoard(5); // 5行表示
        updateStatusDisplay();
    }
});


// --- 4. 問題制作モードのロジック ---

function renderCreateBoard() { 
    createBoardElement.innerHTML = '';
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.createElement('div');
            cell.classList.add('create-cell');
            
            const input = document.createElement('input');
            input.classList.add('create-input');
            input.type = 'text';
            input.maxLength = 1;
            input.dataset.r = r;
            input.dataset.c = c;
            
            input.addEventListener('input', checkCreationInput);
            input.addEventListener('blur', checkCreationInput);
            cell.appendChild(input);
            createBoardElement.appendChild(cell);
        }
    }
    document.getElementById('creation-mode-select').value = 'country';
}

function checkCreationInput(event) {
    if (event && event.target) {
        let input = event.target;
        let value = input.value;
        
        value = value.toUpperCase();
        value = toKatakana(value);

        if (value.length > 0 && !isValidGameChar(value)) {
            value = '';
        }

        input.value = value.slice(0, 1);
    }

    const inputs = document.querySelectorAll('.create-input');
    let filledCount = 0;
    
    inputs.forEach(input => {
        if (input.value.length === 1 && isValidGameChar(input.value)) {
            filledCount++;
        }
    });

    if (filledCount === 40) {
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';
    } else {
        btnInputComplete.disabled = true;
        document.getElementById('create-status').textContent = `残り${40 - filledCount}マスに入力が必要です。`;
    }
}

btnInputComplete.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.create-input');
    let newBoard = Array(8).fill(0).map(() => Array(5).fill(''));
    
    inputs.forEach(input => {
        const r = parseInt(input.dataset.r);
        const c = parseInt(input.dataset.c);
        newBoard[r][c] = input.value;
    });

    const modeSelect = document.getElementById('creation-mode-select');
    const isCountry = modeSelect.value === 'country';

    // 制作モードでは、問題選択ロジックをスキップし、盤面データとisCreationフラグを渡す
    initialPlayData = JSON.parse(JSON.stringify(newBoard));
    boardData = JSON.parse(JSON.stringify(newBoard));
    startGame(isCountry, true); 
});


// --- 5. ランキングロジック ---

const rankingScreen = document.getElementById('ranking-screen');
const rankingTabs = document.getElementById('ranking-tabs');

async function fetchAndDisplayRanking(type) {
    const container = document.getElementById('ranking-list-container');
    container.innerHTML = `<div>${type}ランキングをサーバーから取得中...</div>`;

    const totalScore = playerStats.country_clears + playerStats.capital_clears;
    document.getElementById('ranking-nickname-display').innerHTML = `あなたの記録: <strong>${currentPlayerNickname}</strong> (国名: ${playerStats.country_clears}, 首都名: ${playerStats.capital_clears}, 合計: ${totalScore})`;

    try {
        const response = await fetch(`${API_BASE_URL}/rankings/${type}`);
        
        if (!response.ok) throw new Error('ランキング取得サーバーエラー');

        const rankings = await response.json();
        
        let html = `<h3>${type === 'total' ? '総合' : type === 'country' ? '国名' : '首都名'}ランキング</h3>`;
        html += `<table><tr><th>順位</th><th>ニックネーム</th><th>クリア数</th></tr>`;
        
        rankings.forEach(item => {
            const isCurrentPlayer = item.nickname === currentPlayerNickname;
            html += `<tr style="${isCurrentPlayer ? 'background-color: #ffe0b2; font-weight: bold;' : ''}"><td>${item.rank}</td><td>${item.nickname}</td><td>${item.score}</td></tr>`;
        });
        
        html += '</table>';
        container.innerHTML = html;

    } catch (error) {
        console.error("ランキング取得に失敗しました。", error);
        container.innerHTML = `<p style="color:red;">ランキング取得エラー: サーバー（Node.js）が起動しているか確認してください。また、フロントエンドのAPI_BASE_URLが正しいか確認してください。</p>`;
    }
}


// --- 6. イベントリスナーの設定 ---

document.getElementById('btn-country-mode').addEventListener('click', () => {
    startGame(true, false); // isCountry=true, isCreation=false
});
document.getElementById('btn-capital-mode').addEventListener('click', () => {
    startGame(false, false); // isCountry=false, isCreation=false
});
document.getElementById('btn-create-mode').addEventListener('click', () => {
    // ゲストユーザーは制作モードを利用できない
    if (currentPlayerNickname === 'ゲスト') {
        alert("問題制作モードを利用するには、ニックネームとパスコードを設定してログインしてください。");
        promptForNickname(true);
        return;
    }
    showScreen('create');
    renderCreateBoard();
    checkCreationInput();
});

document.getElementById('btn-ranking').addEventListener('click', () => {
    showScreen('ranking');
    fetchAndDisplayRanking('total');
});

document.getElementById('btn-back-to-home').addEventListener('click', () => {
    showScreen('home');
});
document.getElementById('btn-create-back').addEventListener('click', () => {
    showScreen('home');
});
document.getElementById('btn-ranking-back').addEventListener('click', () => {
    showScreen('home');
});

rankingTabs.addEventListener('click', (event) => {
    if (event.target.tagName === 'BUTTON') {
        fetchAndDisplayRanking(event.target.dataset.type);
    }
});

// 初期化
setupPlayer();
showScreen('home');