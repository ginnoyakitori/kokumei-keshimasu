// ----------------------------------------------------
// フロントエンド JavaScript コード - script.js (問題登録機能追加版)
// ----------------------------------------------------

// ★★★ 🚨 要修正 ★★★
// あなたのRender Web ServiceのURLに必ず置き換えてください。
// 例: const API_BASE_URL = 'https://your-keshimasu-server.onrender.com/api'; 
const API_BASE_URL = 'https://kokumei-keshimasu.onrender.com/api'; 

// --- 1. 定数と初期データ ---

// ★★★ 修正箇所 1: 初期問題をサーバーからの動的ロードに切り替え ★★★
// ハードコードされた問題リストを削除し、動的リストを定義
let allPuzzles = { country: [], capital: [] }; 

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
 * LocalStorageからクリアした問題のIDリストを取得する (インデックスからID管理に変更)
 */
function getClearedPuzzles(mode) {
    const key = `cleared_puzzles_${mode}_id`;
    const cleared = localStorage.getItem(key);
    return cleared ? JSON.parse(cleared) : [];
}

/**
 * LocalStorageにクリアした問題のIDを記録する
 */
function markPuzzleAsCleared(mode, puzzleId) {
    const key = `cleared_puzzles_${mode}_id`;
    let cleared = getClearedPuzzles(mode);
    if (!cleared.includes(puzzleId)) {
        cleared.push(puzzleId);
        localStorage.setItem(key, JSON.stringify(cleared));
    }
}

// --- サーバー連携・プレイヤー認証 ---

/**
 * ★★★ 修正箇所 2: サーバーから問題リストを動的にロードする関数 ★★★
 */
async function loadPuzzles() {
    try {
        const countryRes = await fetch(`${API_BASE_URL}/puzzles/country`);
        const capitalRes = await fetch(`${API_BASE_URL}/puzzles/capital`);
        
        if (!countryRes.ok || !capitalRes.ok) throw new Error("問題リストの取得に失敗");
        
        allPuzzles.country = await countryRes.json();
        allPuzzles.capital = await capitalRes.json();
        
        updateHomeProblemCount();
        
    } catch (error) {
        console.error("問題のロードに失敗しました。サーバーが起動しているか確認してください。", error);
        alert("サーバーから問題データをロードできませんでした。");
    }
}

async function setupPlayer() {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname') || "ゲスト";

    const defaultNickname = '銀の焼き鳥';
    const defaultPasscode = '0425';

    if (currentPlayerNickname === defaultNickname && currentPlayerId) {
        await registerPlayer(defaultNickname, defaultPasscode);
    } else if (currentPlayerNickname === "ゲスト" && !localStorage.getItem('default_user_checked')) {
        localStorage.setItem('default_user_checked', 'true');
        await registerPlayer(defaultNickname, defaultPasscode);
    }
    
    if (currentPlayerNickname === "ゲスト" || !currentPlayerId) {
        await promptForNickname(true);
    }
    
    // 問題をサーバーからロード
    await loadPuzzles(); 
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
function updateHomeProblemCount() {
    // ★★★ 修正箇所 3: allPuzzlesのデータを使用 ★★★
    const countryCount = allPuzzles.country.length;
    const capitalCount = allPuzzles.capital.length;
    
    document.getElementById('country-problem-count').textContent = `問題数: ${countryCount}問`;
    document.getElementById('capital-problem-count').textContent = `問題数: ${capitalCount}問`;
}

/**
 * ゲームの開始。未クリアの問題の中からインデックスが最も小さいものを選択する。
 */
function startGame(isCountry, isCreation) {
    const mode = isCountry ? 'country' : 'capital';
    // ★★★ 修正箇所 4: allPuzzlesのデータを使用 ★★★
    const problemList = allPuzzles[mode]; 
    
    // 制作モードではない場合のみ、問題選択ロジックを実行
    if (!isCreation) {
        const clearedIds = getClearedPuzzles(mode);
        // 未クリアの問題をIDでフィルタリング
        const availablePuzzles = problemList
            .filter(puzzle => !clearedIds.includes(puzzle.id));

        if (availablePuzzles.length === 0) {
            alert(`🎉 ${isCountry ? '国名' : '首都名'}ケシマスのすべての問題をクリアしました！`);
            showScreen('home');
            return;
        }

        // サーバーから取得した問題はtimestamp順にソートされているため、先頭が最も古い未クリア問題
        const selectedPuzzle = availablePuzzles[0];
        
        // 問題リスト内でのインデックスを再計算
        currentPuzzleIndex = problemList.findIndex(p => p.id === selectedPuzzle.id);
        
        // 選択された問題データを取得
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
    } else {
        currentPuzzleIndex = -1; 
    }

    isCountryMode = isCountry;
    isCreationPlay = isCreation; 
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT;
    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;
    
    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';
    
    document.getElementById('current-game-title').textContent = modeName; 
    
    const currentClearCount = playerStats[mode + '_clears'] || 0;
    const nextProblemNumber = currentClearCount + 1;
    
    document.getElementById('problem-number-display').textContent = 
        isCreation 
        ? '問題制作モード' 
        : `第 ${nextProblemNumber} 問`; 
        
    let creatorName = '銀の焼き鳥'; 
    if (isCreation) {
        creatorName = currentPlayerNickname;
    } else if (currentPuzzleIndex !== -1) {
        creatorName = problemList[currentPuzzleIndex].creator;
    }
    document.getElementById('creator-display').textContent = `制作者: ${creatorName}`;
        
    updateStatusDisplay();
    renderBoard(5); 
    showScreen('mainGame');
}

function renderBoard(visibleRows) { 
    boardElement.innerHTML = '';
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

/**
 * ★★★ 修正箇所 5: 問題制作モードでクリアした問題をサーバーに登録する関数 ★★★
 */
async function submitNewPuzzle(mode, boardData, creator) {
    try {
        const response = await fetch(`${API_BASE_URL}/puzzles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mode: mode,
                boardData: boardData,
                creator: creator
            })
        });
        
        if (!response.ok) throw new Error('問題登録サーバーエラー');

        const data = await response.json();
        
        alert(`🎉 問題の登録に成功しました！\n制作者：${data.puzzle.creator}\nこの問題は今後、標準問題として出題されます。`);
        
        // 問題リストを再ロードしてホーム画面の問題数を更新
        await loadPuzzles();
        
    } catch (error) {
        console.error("問題登録に失敗しました。", error);
        alert("問題の登録に失敗しました。サーバーが起動しているか、API_BASE_URLが正しいか確認してください。");
    }
}

async function checkGameStatus() { 
    const totalChars = boardData.flat().filter(char => char !== '').length;
    
    if (totalChars === 0) {
        const mode = isCountryMode ? 'country' : 'capital';
        const modeName = isCountryMode ? '国名' : '首都名';
        
        if (!isCreationPlay) {
            // 標準問題のクリア処理
            const problemList = allPuzzles[mode];
            const currentPuzzle = problemList[currentPuzzleIndex];
            
            if (currentPuzzle && currentPuzzle.id) {
                markPuzzleAsCleared(mode, currentPuzzle.id); // LocalStorageにIDでクリアを記録
            }

            await updatePlayerScore(mode); 
            const nextClearCount = playerStats[mode + '_clears'];
            alert(`🎉 全ての文字を消去しました！クリアです！\nあなたの${modeName}クリア数は${nextClearCount}問になりました。`);
        } else {
            // ★★★ 修正箇所 6: 制作モードのクリア処理で問題登録を呼び出す ★★★
            const registrationConfirmed = confirm("🎉 作成した問題をクリアしました！\nこの問題を標準問題として登録しますか？");
            
            if (registrationConfirmed) {
                const finalBoard = JSON.parse(JSON.stringify(initialPlayData));
                await submitNewPuzzle(mode, finalBoard, currentPlayerNickname);
            } else {
                alert("問題の登録をスキップしました。");
            }
        }
        showScreen('home');
    }
}


// --- 3. ゲームロジックの中核 (省略: 修正なし) ---

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
    renderBoard(5); 
}

/** 消去ボタンイベントリスナー (修正なし) */
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
    
    renderBoard(5); 
    updateStatusDisplay();
    await checkGameStatus();
});

resetBtn.addEventListener('click', () => { 
    if (isCreationPlay) {
        showScreen('create');
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';
        
    } else if (currentPuzzleIndex !== -1) {
        // ★★★ 修正箇所 7: problemListをallPuzzlesから取得 ★★★
        const problemList = isCountryMode ? allPuzzles.country : allPuzzles.capital;
        const selectedPuzzle = problemList[currentPuzzleIndex];
        
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        selectedCells = [];
        usedWords = [];
        eraseButton.disabled = true;
        
        renderBoard(5); 
        updateStatusDisplay();
    }
});


// --- 4. 問題制作モードのロジック (省略: 修正なし) ---

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

    initialPlayData = JSON.parse(JSON.stringify(newBoard));
    boardData = JSON.parse(JSON.stringify(newBoard));
    startGame(isCountry, true); 
});


// --- 5. ランキングロジック (修正なし) ---

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
            html += `<tr style="${isCurrentPlayer ? 'background-color: #554400; font-weight: bold; color:#FFD700;' : ''}"><td>${item.rank}</td><td>${item.nickname}</td><td>${item.score}</td></tr>`;
        });
        
        html += '</table>';
        container.innerHTML = html;

    } catch (error) {
        console.error("ランキング取得に失敗しました。", error);
        container.innerHTML = `<p style="color:red;">ランキング取得エラー: サーバーが起動しているか確認してください。</p>`;
    }
}


// --- 6. イベントリスナーの設定 (修正なし) ---

document.getElementById('btn-country-mode').addEventListener('click', () => {
    startGame(true, false); 
});
document.getElementById('btn-capital-mode').addEventListener('click', () => {
    startGame(false, false); 
});
document.getElementById('btn-create-mode').addEventListener('click', () => {
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