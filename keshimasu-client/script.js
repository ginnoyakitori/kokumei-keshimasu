// ----------------------------------------------------
// フロントエンド JavaScript コード - script.js
// ----------------------------------------------------

// ★APIのURLを定義 (Renderデプロイ時に、ここにWeb ServiceのURLを設定してください)
// 例: const API_BASE_URL = 'https://keshimasu-server-xyz.onrender.com/api'; 
const API_BASE_URL = 'http://localhost:3000/api'; 

// --- 1. 定数と初期データ ---

const initialBoardData_Standard = [
    ['セ', 'カ', 'イ', 'イ', 'エ'], ['ノ', 'キ', 'ュ', 'ウ', 'ビ'], 
    ['タ', 'イ', 'ワ', 'ン', 'ワ'], ['ニ', 'ホ', 'ン', 'F', 'ラ'],
    ['ア', 'メ', 'リ', 'カ', 'ス'], ['イ', 'ギ', 'リ', 'ス', 'マ'],
    ['ド', 'イ', 'ツ', 'フ', 'ス'], ['オ', 'ー', 'ス', 'ト', 'ラ']
];

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

// ★ランキング/プレイヤー関連
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

// --- サーバー連携・プレイヤー認証 ---

async function setupPlayer() {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname') || "ゲスト";

    if (!currentPlayerNickname || currentPlayerNickname === "ゲスト" || !currentPlayerId) {
        await promptForNickname(true);
    } else {
        await registerPlayer(currentPlayerNickname);
    }
}

async function promptForNickname(isInitial = false) {
    const defaultName = localStorage.getItem('keshimasu_nickname') || "";
    let nickname = prompt("ニックネームを入力してください (10文字以内):", defaultName);
    
    if (nickname && nickname.trim() !== "") {
        const finalName = nickname.trim().slice(0, 10);
        await registerPlayer(finalName);
    } else if (isInitial) {
        alert("ニックネームがないとスコアは「ゲスト」として扱われ、ランキングには反映されません。");
    }
}

async function registerPlayer(nickname) {
    try {
        const response = await fetch(`${API_BASE_URL}/player/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname })
        });
        
        if (!response.ok) throw new Error('サーバーエラー');
        
        const data = await response.json();
        
        if (data.player) {
            currentPlayerNickname = data.player.nickname;
            currentPlayerId = data.player.id; 
            playerStats.country_clears = data.player.country_clears;
            playerStats.capital_clears = data.player.capital_clears;
            
            localStorage.setItem('keshimasu_nickname', currentPlayerNickname);
            localStorage.setItem('player_id', currentPlayerId);
        }
    } catch (error) {
        console.error("サーバー登録に失敗しました。", error);
        currentPlayerNickname = "ゲスト";
        currentPlayerId = null;
    }
}


// --- 2. 画面表示と初期化 ---

function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        screens[key].style.display = (key === screenName) ? 'block' : 'none';
    });
}

function startGame(initialData, isCountry, isCreation, creatorName = '標準問題') {
    initialPlayData = JSON.parse(JSON.stringify(initialData));
    boardData = JSON.parse(JSON.stringify(initialData));
    isCountryMode = isCountry;
    isCreationPlay = isCreation; 
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT;
    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;
    
    const mode = isCountry ? 'country' : 'capital';
    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';
    
    document.getElementById('current-game-title').textContent = modeName;
    
    const currentClearCount = playerStats[mode + '_clears'] || 0;
    const nextProblemNumber = currentClearCount + 1;
    
    document.getElementById('problem-number-display').textContent = 
        isCreation ? '問題制作モード' : `第 ${nextProblemNumber} 問`;
        
    // ★ 制作者名を表示するロジック ★
    if (isCreation) {
        document.getElementById('creator-display').textContent = `制作者: ${creatorName}`;
    } else {
        document.getElementById('creator-display').textContent = `制作者: 標準問題`;
    }
        
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

async function checkGameStatus() { 
    const totalChars = boardData.flat().filter(char => char !== '').length;
    
    if (totalChars === 0) {
        const mode = isCountryMode ? 'country' : 'capital';
        const modeName = isCountryMode ? '国名' : '首都名';
        
        if (!isCreationPlay) {
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

/** セルクリックハンドラ (一直線選択リセットの修正済み) */
function handleCellClick(event) { 
    const r = parseInt(event.target.dataset.r);
    const c = parseInt(event.target.dataset.c);

    // 選択済みのセルがない場合は、最初のセルとして追加
    if (selectedCells.length === 0) {
        selectedCells.push([r, c]);
        eraseButton.disabled = false;
    } else {
        const [prevR, prevC] = selectedCells[selectedCells.length - 1];
        
        // 新しいセルが隣接しているか判定
        const isHorizontal = r === prevR && Math.abs(c - prevC) === 1;
        const isVertical = c === prevC && Math.abs(r - prevR) === 1;

        // 既に選択済みのセルをクリックした場合、そこまで選択を戻す
        const index = selectedCells.findIndex(coord => coord[0] === r && coord[1] === c);
        if (index > -1) {
            // 選択済みのセルを再度クリックしたら、そのセル以降を解除
            selectedCells.splice(index + 1);
        }
        // 隣接しているセルが選択された場合
        else if (isHorizontal || isVertical) {
            
            let shouldAdd = false;
            
            if (selectedCells.length === 1) {
                // 2番目のセル選択時: パターンを決定する
                shouldAdd = true;
            } else {
                // 3番目以降のセル選択時: パターンを維持しているかチェック
                const [firstR, firstC] = selectedCells[0];
                
                // 既に選択されているすべてのセルが横一列に並んでいるか
                const isCurrentPatternHorizontal = selectedCells.every(coord => coord[0] === firstR);
                // 既に選択されているすべてのセルが縦一列に並んでいるか
                const isCurrentPatternVertical = selectedCells.every(coord => coord[1] === firstC);
                
                // 横一列の選択中
                if (isCurrentPatternHorizontal) {
                    // 新しいセルが同じ行 (r === firstR) かつ横隣 (isHorizontal) であるか
                    if (r === firstR && isHorizontal) {
                        shouldAdd = true;
                    }
                } 
                // 縦一列の選択中
                else if (isCurrentPatternVertical) {
                    // 新しいセルが同じ列 (c === firstC) かつ縦隣 (isVertical) であるか
                    if (c === firstC && isVertical) {
                        shouldAdd = true;
                    }
                }
            }

            if (shouldAdd) {
                selectedCells.push([r, c]);
            } else {
                // パターンが維持されていない場合はリセット
                selectedCells = [[r, c]];
            }
        } 
        // 隣接していない場合は選択をリセット
        else {
            selectedCells = [[r, c]];
        }
    }
    
    // 消去ボタンは2セル以上選択されたときのみ有効
    eraseButton.disabled = selectedCells.length < 2;
    renderBoard(5);
}

/** 消去ボタンイベントリスナー (Fの文字置き換えロジック修正済み) */
eraseButton.addEventListener('click', async () => { 
    if (selectedCells.length < 2) return;

    let selectedWordChars = selectedCells.map(([r, c]) => boardData[r][c]); 
    let selectedWord = selectedWordChars.join(''); 
    let finalWord = ''; 

    const mode = isCountryMode ? '国名' : '首都名';
    
    // Fが含まれる場合の処理を修正
    if (selectedWord.includes('F')) {
        let tempWordChars = [...selectedWordChars]; 
        let fIndices = []; 

        selectedWordChars.forEach((char, index) => {
            if (char === 'F') {
                fIndices.push(index);
            }
        });

        // 'F' の箇所だけをユーザーに入力させる
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
        finalWord = tempWordChars.join(''); // Fを置き換えた後の最終的な単語
    } else {
        // 'F' が含まれない場合は、そのままの単語を使用
        finalWord = selectedWord;
    }

    // --- 辞書チェック ---
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
    // リセット時、制作モードでプレイしていた場合はその制作者名を再度渡す必要があるが、
    // initialPlayDataには制作者情報は含まれないため、ここでは標準問題としてリセット
    // ※問題制作モードのローカルリセットなのでこれでOK
    startGame(initialPlayData, isCountryMode, isCreationPlay); 
});


// --- 4. 問題制作モードのロジック (制作者名受け渡しを修正) ---

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

    // ★ 修正済み: 制作者名としてcurrentPlayerNicknameを渡す ★
    startGame(newBoard, isCountry, true, currentPlayerNickname); 
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
    startGame(initialBoardData_Standard, true, false); 
});
document.getElementById('btn-capital-mode').addEventListener('click', () => {
    startGame(initialBoardData_Standard, false, false);
});
document.getElementById('btn-create-mode').addEventListener('click', () => {
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