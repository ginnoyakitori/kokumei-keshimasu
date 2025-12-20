// あなたのRenderのURL
const API_BASE_URL = 'https://kokumei-keshimasu.onrender.com/api'; 

// --- 1. 変数定義 ---
let allPuzzles = { country: { puzzles: [], cleared_ids: [] }, capital: { puzzles: [], cleared_ids: [] } }; 
let COUNTRY_DICT = [];
let CAPITAL_DICT = []; 
let boardData = []; 
let initialPlayData = []; 
let selectedCells = []; 
let usedWords = [];     
let isCountryMode = true; 
let isCreationPlay = false; 
let currentDictionary = [];
let currentPuzzleIndex = -1; 

let currentPlayerNickname = null; 
let currentPlayerId = null; 
let playerStats = { country_clears: 0, capital_clears: 0 };
let isComposing = false; // IME入力中フラグ

// DOM要素
const screens = {
    auth: document.getElementById('auth-screen'), 
    home: document.getElementById('home-screen'),
    mainGame: document.getElementById('main-game-screen'),
    create: document.getElementById('create-puzzle-screen'),
    ranking: document.getElementById('ranking-screen'),
    wordList: document.getElementById('word-list-screen')
};
const appTitleElement = document.getElementById('app-title');
const boardElement = document.getElementById('board');
const eraseButton = document.getElementById('erase-button');
const btnInputComplete = document.getElementById('btn-input-complete');
const resetBtn = document.getElementById('reset-button');
const inputNickname = document.getElementById('nickname-input');
const inputPasscode = document.getElementById('passcode-input');

// --- ユーティリティ ---
function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, m => String.fromCharCode(m.charCodeAt(0) + 0x60));
}
function isValidGameChar(char) {
    if (char === 'F') return true;
    return /^[\u30a0-\u30ff]$/.test(char); 
}

// --- ゲスト用 LocalStorage 管理 ---
function getClearedPuzzlesFromLocal(mode) {
    const key = `cleared_puzzles_${mode}_id_${currentPlayerId || 'guest'}`;
    const cleared = localStorage.getItem(key);
    return cleared ? JSON.parse(cleared) : [];
}

function markPuzzleAsClearedLocal(mode, puzzleId) {
    const key = `cleared_puzzles_${mode}_id_${currentPlayerId || 'guest'}`;
    let cleared = getClearedPuzzlesFromLocal(mode);
    if (!cleared.includes(puzzleId)) {
        cleared.push(puzzleId);
        localStorage.setItem(key, JSON.stringify(cleared));
    }
}

// --- サーバー連携 ---
async function loadPuzzlesAndWords() {
    const modeList = ['country', 'capital'];
    try {
        for (const mode of modeList) {
            const url = `${API_BASE_URL}/puzzles/${mode}${currentPlayerId ? `?playerId=${currentPlayerId}` : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${mode}問題取得エラー`);
            
            const data = await res.json();
            allPuzzles[mode] = data; 
        }
        
        const cRes = await fetch(`${API_BASE_URL}/words/country`);
        const aRes = await fetch(`${API_BASE_URL}/words/capital`);
        if (!cRes.ok || !aRes.ok) throw new Error("辞書取得エラー");
        
        COUNTRY_DICT = await cRes.json();
        CAPITAL_DICT = await aRes.json();

        // ゲストの場合、LocalStorageからクリア数を反映
        if (!currentPlayerId) {
            playerStats.country_clears = getClearedPuzzlesFromLocal('country').length;
            playerStats.capital_clears = getClearedPuzzlesFromLocal('capital').length;
        }
        updateHomeProblemCount();
        
    } catch (error) {
        console.error("ロード失敗", error);
        if (currentPlayerNickname === 'ゲスト') alert("サーバー接続エラー。再読み込みしてください。");
    }
}

async function getPlayerStatus(id) {
    if (!id) return false;
    try {
        const res = await fetch(`${API_BASE_URL}/player/${id}`);
        if (res.status === 404) return false;
        if (!res.ok) throw new Error("プレイヤー取得エラー");
        
        const data = await res.json();
        playerStats.country_clears = data.player.country_clears;
        playerStats.capital_clears = data.player.capital_clears;
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

function setPlayerSession(playerData) {
    currentPlayerNickname = playerData.nickname;
    currentPlayerId = playerData.id;
    playerStats.country_clears = playerData.country_clears;
    playerStats.capital_clears = playerData.capital_clears;
    localStorage.setItem('keshimasu_nickname', currentPlayerNickname);
    localStorage.setItem('player_id', currentPlayerId);
}

// --- 認証 ---
async function attemptLogin(nickname, passcode) {
    if (!nickname || !passcode) { alert("両方入力してください"); return; }
    try {
        const res = await fetch(`${API_BASE_URL}/player/register`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ nickname: nickname.trim().slice(0, 20), passcode })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.message); return; }
        if (data.isNewUser) { alert("未登録です。新規登録してください。"); return; }
        
        setPlayerSession(data.player);
        await getPlayerStatus(currentPlayerId);
        alert("ログイン成功！");
        await loadPuzzlesAndWords();
        showScreen('home');
    } catch (e) { alert("ログイン失敗: 通信エラー"); }
}

async function attemptRegister(nickname, passcode) {
    if (!nickname || !passcode) { alert("両方入力してください"); return; }
    try {
        const res = await fetch(`${API_BASE_URL}/player/register`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ nickname: nickname.trim().slice(0, 20), passcode })
        });
        const data = await res.json();
        if (!res.ok) { alert(data.message); return; }
        if (!data.isNewUser) { alert("既に登録済みです。ログインしてください。"); return; }
        
        setPlayerSession(data.player);
        alert("登録成功！");
        await loadPuzzlesAndWords();
        showScreen('home');
    } catch (e) { alert("登録失敗: 通信エラー"); }
}

// --- 画面遷移 ---
function showScreen(name) {
    Object.keys(screens).forEach(key => screens[key].style.display = (key === name ? 'block' : 'none'));
    if (name === 'home') {
        appTitleElement.style.display = 'block';
        updateHomeProblemCount();
        document.getElementById('welcome-message').textContent = `${currentPlayerNickname}さん、ようこそ！`;
    } else {
        appTitleElement.style.display = 'none';
    }
}

function updateHomeProblemCount() {
    const cTotal = allPuzzles.country.puzzles ? allPuzzles.country.puzzles.length : 0;
    const aTotal = allPuzzles.capital.puzzles ? allPuzzles.capital.puzzles.length : 0;
    document.getElementById('country-problem-count').textContent = `問題数: ${cTotal}問 (クリア済: ${playerStats.country_clears})`;
    document.getElementById('capital-problem-count').textContent = `問題数: ${aTotal}問 (クリア済: ${playerStats.capital_clears})`;
}

// --- ゲーム進行ロジック ---
function startGame(isCountry, isCreation) {
    const mode = isCountry ? 'country' : 'capital';
    const allProblemData = allPuzzles[mode].puzzles || [];
    allProblemData.sort((a, b) => a.id - b.id);

    if (!isCreation) {
        // ★ ログイン時はサーバーのクリア済みID、ゲスト時はローカルストレージのクリア済みIDを使用 ★
        let clearedIds;
        if (currentPlayerId) {
            clearedIds = new Set(allPuzzles[mode].cleared_ids || []);
        } else {
            clearedIds = new Set(getClearedPuzzlesFromLocal(mode));
        }

        const availablePuzzles = allProblemData.filter(p => !clearedIds.has(p.id));

        if (availablePuzzles.length === 0) {
            alert(`🎉 ${isCountry ? '国名' : '首都名'}ケシマスの全問題をクリアしました！`);
            showScreen('home');
            return;
        }

        const selectedPuzzle = availablePuzzles[0];
        currentPuzzleIndex = allProblemData.findIndex(p => p.id === selectedPuzzle.id);
        
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        
        const nextProblemNumber = (currentPlayerId ? playerStats[mode + '_clears'] : getClearedPuzzlesFromLocal(mode).length) + 1;
        document.getElementById('problem-number-display').textContent = `第 ${nextProblemNumber} 問`;
        document.getElementById('creator-display').textContent = `制作者: ${selectedPuzzle.creator}`;
    } else {
        currentPuzzleIndex = -1;
        document.getElementById('problem-number-display').textContent = '問題制作モード';
        document.getElementById('creator-display').textContent = `制作者: ${currentPlayerNickname}`;
    }

    isCountryMode = isCountry;
    isCreationPlay = isCreation;
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT;
    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;
    document.getElementById('current-game-title').textContent = isCountry ? '国名ケシマス' : '首都名ケシマス';
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
            cell.className = 'cell';
            if (char === '') cell.classList.add('empty');
            else cell.onclick = handleCellClick;
            
            cell.dataset.r = r; cell.dataset.c = c;
            cell.textContent = char;
            
            if (selectedCells.some(coord => coord[0] === r && coord[1] === c)) {
                cell.classList.add('selected');
            }
            boardElement.appendChild(cell);
        }
    }
}

function updateStatusDisplay() {
    document.getElementById('used-words-display').textContent = usedWords.join(', ') || 'なし';
}

async function updatePlayerScore(mode, puzzleId) {
    if (!currentPlayerId) return;
    try {
        const res = await fetch(`${API_BASE_URL}/score/update`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ playerId: currentPlayerId, mode, puzzleId })
        });
        const data = await res.json();
        playerStats[mode + '_clears'] = data.newScore;
    } catch (e) { console.error(e); }
}

async function submitNewPuzzle(mode, boardData, creator) {
    try {
        const res = await fetch(`${API_BASE_URL}/puzzles`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ mode, boardData, creator })
        });
        if (!res.ok) throw new Error("登録エラー");
        alert("問題登録成功！");
        await loadPuzzlesAndWords();
    } catch (e) { alert("問題登録失敗"); }
}

async function checkGameStatus() {
    const totalChars = boardData.flat().filter(c => c !== '').length;
    if (totalChars === 0) {
        const mode = isCountryMode ? 'country' : 'capital';
        
        if (!isCreationPlay) {
            const currentPuzzle = allPuzzles[mode].puzzles[currentPuzzleIndex];
            
            // ★ クリア処理 ★
            if (currentPlayerId) {
                // ログインユーザー: サーバーと同期
                await updatePlayerScore(mode, currentPuzzle.id);
            } else {
                // ゲストユーザー: ローカルストレージに保存
                markPuzzleAsClearedLocal(mode, currentPuzzle.id);
                // 表示用の数値を更新
                playerStats[mode + '_clears'] = getClearedPuzzlesFromLocal(mode).length;
            }

            alert(`🎉 クリア！\nクリア数は ${playerStats[mode + '_clears']} 問になりました。`);
            await loadPuzzlesAndWords();
            showScreen('home');
        } else {
            if (confirm("クリア！この問題を登録しますか？")) {
                await submitNewPuzzle(mode, initialPlayData, currentPlayerNickname);
                showScreen('home');
            } else {
                showScreen('create');
                renderCreateBoard();
                fillCreateBoard(initialPlayData);
                btnInputComplete.disabled = false;
                document.getElementById('create-status').textContent = '入力完了！';
            }
        }
    }
}

// --- パズルロジック (重力・選択・消去) ---
function applyGravity() {
    for (let c = 0; c < 5; c++) {
        let chars = [];
        for (let r = boardData.length - 1; r >= 0; r--) {
            if (boardData[r][c] !== '') chars.unshift(boardData[r][c]);
        }
        let newCol = Array(8 - chars.length).fill('').concat(chars);
        for (let r = 0; r < 8; r++) boardData[r][c] = newCol[r];
    }
}

function handleCellClick(e) {
    const r = parseInt(e.target.dataset.r);
    const c = parseInt(e.target.dataset.c);

    // 簡易的な選択ロジック（隣接判定などは省略せず実装済みのものを利用）
    if (selectedCells.length === 0) {
        selectedCells.push([r, c]);
    } else {
        // 直線判定ロジック
        const [lastR, lastC] = selectedCells[selectedCells.length - 1];
        const isAdj = (r === lastR && Math.abs(c - lastC) === 1) || (c === lastC && Math.abs(r - lastR) === 1);
        
        // 既存の選択解除
        const idx = selectedCells.findIndex(co => co[0] === r && co[1] === c);
        if (idx > -1) {
            selectedCells.splice(idx + 1);
        } else if (isAdj) {
            // 直線性の維持
            if (selectedCells.length >= 2) {
                const [firstR, firstC] = selectedCells[0];
                const isHoriz = selectedCells.every(co => co[0] === firstR);
                const isVert = selectedCells.every(co => co[1] === firstC);
                
                if ((isHoriz && r === firstR) || (isVert && c === firstC)) selectedCells.push([r, c]);
            } else {
                selectedCells.push([r, c]);
            }
        } else {
            selectedCells = [[r, c]];
        }
    }
    
    eraseButton.disabled = selectedCells.length < 2;
    renderBoard(5);
}

eraseButton.addEventListener('click', async () => {
    if (selectedCells.length < 2) return;
    
    // ソート
    let sorted = [...selectedCells];
    const isHoriz = sorted.every(c => c[0] === sorted[0][0]);
    if (isHoriz) sorted.sort((a, b) => a[1] - b[1]);
    else sorted.sort((a, b) => a[0] - b[0]);

    let chars = sorted.map(([r, c]) => boardData[r][c]);
    let word = chars.join('');
    
    // F処理
    if (word.includes('F')) {
        let fIndices = chars.map((c, i) => c === 'F' ? i : -1).filter(i => i !== -1);
        for (let i of fIndices) {
            let input = prompt(`「${word}」の${i+1}文字目(F)は何？`);
            if (!input) return;
            let kana = toKatakana(input).toUpperCase().slice(0, 1);
            if (!isValidGameChar(kana) && kana !== 'F') { alert("無効な文字"); return; }
            chars[i] = kana;
        }
        word = chars.join('');
    }

    if (!currentDictionary.includes(word)) { alert("辞書にありません"); return; }
    if (usedWords.includes(word)) { alert("既に使用済み"); return; }

    selectedCells.forEach(([r, c]) => boardData[r][c] = '');
    usedWords.push(word);
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
        renderCreateBoard();
        fillCreateBoard(initialPlayData);
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！';
    } else if (currentPuzzleIndex !== -1) {
        const mode = isCountryMode ? 'country' : 'capital';
        const p = allPuzzles[mode].puzzles[currentPuzzleIndex];
        boardData = JSON.parse(JSON.stringify(p.data));
        selectedCells = []; usedWords = []; eraseButton.disabled = true;
        renderBoard(5); updateStatusDisplay();
    }
});

// --- 問題制作モード（フリック入力・濁音対応） ---
function renderCreateBoard() {
    const cb = document.getElementById('create-board');
    cb.innerHTML = '';
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 5; c++) {
            const cell = document.createElement('div');
            cell.className = 'create-cell';
            const inp = document.createElement('input');
            inp.className = 'create-input';
            inp.type = 'text'; inp.maxLength = 1;
            inp.dataset.r = r; inp.dataset.c = c;
            
            // ★ フリック入力対応イベント ★
            inp.addEventListener('compositionstart', () => { isComposing = true; });
            inp.addEventListener('compositionend', (e) => { isComposing = false; checkCreationInput(e); });
            inp.addEventListener('input', (e) => { if (!isComposing) checkCreationInput(e); });
            inp.addEventListener('blur', (e) => { isComposing = false; checkCreationInput(e); });
            
            cell.appendChild(inp);
            cb.appendChild(cell);
        }
    }
    document.getElementById('creation-mode-select').value = 'country';
}

function checkCreationInput(e) {
    if (e && e.target) {
        if (!isComposing) {
            let val = toKatakana(e.target.value.toUpperCase());
            if (val.length > 0 && !isValidGameChar(val) && val !== 'F') val = '';
            e.target.value = val.slice(0, 1);
        }
    }
    const inputs = document.querySelectorAll('.create-input');
    let count = 0;
    inputs.forEach(i => { if (i.value.length === 1 && (isValidGameChar(i.value) || i.value === 'F')) count++; });
    
    if (count === 40) {
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！';
    } else {
        btnInputComplete.disabled = true;
        document.getElementById('create-status').textContent = `残り${40 - count}マス`;
    }
}

function fillCreateBoard(data) {
    if (!data) return;
    document.querySelectorAll('.create-input').forEach(inp => {
        const r = parseInt(inp.dataset.r), c = parseInt(inp.dataset.c);
        if (data[r] && data[r][c]) inp.value = data[r][c];
    });
    checkCreationInput();
}

btnInputComplete.addEventListener('click', () => {
    let newBoard = Array(8).fill(0).map(() => Array(5).fill(''));
    document.querySelectorAll('.create-input').forEach(inp => {
        newBoard[inp.dataset.r][inp.dataset.c] = inp.value;
    });
    initialPlayData = JSON.parse(JSON.stringify(newBoard));
    boardData = JSON.parse(JSON.stringify(newBoard));
    startGame(document.getElementById('creation-mode-select').value === 'country', true);
});

// --- ランキング表示 ---
document.getElementById('btn-ranking').addEventListener('click', () => {
    showScreen('ranking');
    fetchAndDisplayRanking('total');
});
document.getElementById('ranking-tabs').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') fetchAndDisplayRanking(e.target.dataset.type);
});

async function fetchAndDisplayRanking(type) {
    const container = document.getElementById('ranking-list-container');
    container.innerHTML = '読み込み中...';
    document.getElementById('ranking-nickname-display').textContent = `あなたの記録: ${currentPlayerNickname} (${playerStats.country_clears + playerStats.capital_clears}問)`;
    
    try {
        const res = await fetch(`${API_BASE_URL}/rankings/${type}`);
        const data = await res.json();
        let html = `<table><tr><th>順位</th><th>名前</th><th>数</th></tr>`;
        data.forEach(d => {
            const style = d.nickname === currentPlayerNickname ? 'background:#554400;color:#FFD700' : '';
            html += `<tr style="${style}"><td>${d.rank}</td><td>${d.nickname}</td><td>${d.score}</td></tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch (e) { container.innerHTML = '取得失敗'; }
}

// --- ワードリスト ---
document.getElementById('btn-word-list').addEventListener('click', () => {
    showScreen('wordList'); displayWordList('country');
});
document.getElementById('word-list-tabs').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') displayWordList(e.target.dataset.type);
});

function displayWordList(type) {
    const list = type === 'country' ? COUNTRY_DICT : CAPITAL_DICT;
    const div = document.getElementById('word-list-content');
    div.innerHTML = '';
    list.sort((a,b) => a.length - b.length || a.localeCompare(b));
    list.forEach(w => {
        const d = document.createElement('div'); d.className = 'word-item'; d.textContent = w;
        div.appendChild(d);
    });
    document.querySelectorAll('#word-list-tabs button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}

// --- イベント登録 ---
document.getElementById('login-btn').addEventListener('click', () => attemptLogin(inputNickname.value, inputPasscode.value));
document.getElementById('signup-btn').addEventListener('click', () => attemptRegister(inputNickname.value, inputPasscode.value));
document.getElementById('guest-play-btn').addEventListener('click', () => {
    currentPlayerNickname = 'ゲスト'; currentPlayerId = null;
    localStorage.removeItem('player_id'); localStorage.removeItem('keshimasu_nickname');
    loadPuzzlesAndWords().then(() => showScreen('home'));
});
document.getElementById('btn-country-mode').addEventListener('click', () => startGame(true, false));
document.getElementById('btn-capital-mode').addEventListener('click', () => startGame(false, false));
document.getElementById('btn-create-mode').addEventListener('click', () => { showScreen('create'); renderCreateBoard(); });
document.getElementById('btn-create-back').addEventListener('click', () => showScreen('home'));
document.getElementById('btn-back-to-home').addEventListener('click', () => showScreen('home'));
document.getElementById('btn-ranking-back').addEventListener('click', () => showScreen('home'));
document.getElementById('btn-word-list-back').addEventListener('click', () => showScreen('home'));
document.getElementById('btn-logout').addEventListener('click', () => { localStorage.clear(); location.reload(); });

// 初期起動
window.onload = async () => {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname');
    if (currentPlayerId) {
        const ok = await getPlayerStatus(currentPlayerId);
        if (!ok) {
            currentPlayerId = null; currentPlayerNickname = null;
            localStorage.clear();
        }
    }
    await loadPuzzlesAndWords();
    showScreen(currentPlayerId ? 'home' : 'auth');
};