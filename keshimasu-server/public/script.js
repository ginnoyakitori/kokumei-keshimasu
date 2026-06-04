// keshimasu-client/script.js (最終統合版)
// ----------------------------------------------------

// ★★★ 🚨 要修正 ★★★
// あなたのNode.jsサーバーの公開URLに置き換えてください。
// ローカルでテストする場合は 'http://localhost:3000/api' などに変更
const API_BASE_URL = 'https://kokumei-keshimasu.onrender.com/api'; 

// --- 1. 定数と初期データ ---
// allPuzzlesにはサーバーレスポンス全体（{puzzles: [], cleared_ids: [], ...}）を格納する
let allPuzzles = { country: {}, capital: {} }; 
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

// IME入力中かどうかを判定するフラグ（作問モード用）
let isComposing = false;

let currentPlayerNickname = null; // 認証前はnull
let currentPlayerId = null; 
let currentListMode = 'country';
// playerStatsを定義。ホーム画面のクリア数表示はこれを参照する
let playerStats = { 
    country_clears: 0,
    capital_clears: 0
};


// DOM要素の取得
const screens = {
    auth: document.getElementById('auth-screen'), 
    home: document.getElementById('home-screen'),
    mainGame: document.getElementById('main-game-screen'),
    create: document.getElementById('create-puzzle-screen'),
    ranking: document.getElementById('ranking-screen'),
    wordList: document.getElementById('word-list-screen'),
    puzzleList: document.getElementById('puzzle-list-screen')
};

const appTitleElement = document.getElementById('app-title'); 
const boardElement = document.getElementById('board');
const eraseButton = document.getElementById('erase-button');
const createBoardElement = document.getElementById('create-board');
const btnInputComplete = document.getElementById('btn-input-complete');
const resetBtn = document.getElementById('reset-button');
const inputNickname = document.getElementById('nickname-input');
const inputPasscode = document.getElementById('passcode-input');
const btnLoginSubmit = document.getElementById('login-btn'); 
const btnRegisterSubmit = document.getElementById('signup-btn');
const btnGuestPlay = document.getElementById('guest-play-btn'); 
const welcomeMessage = document.getElementById('welcome-message');
const wordListContent = document.getElementById('word-list-content');
const wordListTabs = document.getElementById('word-list-tabs');


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
 * LocalStorageからクリアした問題のIDリストを取得する
 * (サーバーから取得できなかった場合のフォールバックとして使用)
 */
function getClearedPuzzles(mode) {
    const key = `cleared_puzzles_${mode}_id_${currentPlayerId || 'guest'}`;
    const cleared = localStorage.getItem(key);
    return cleared ? JSON.parse(cleared) : [];
}

/**
 * LocalStorageにクリアした問題のIDを記録する
 */
function markPuzzleAsCleared(mode, puzzleId) {
    const key = `cleared_puzzles_${mode}_id_${currentPlayerId || 'guest'}`;
    let cleared = getClearedPuzzles(mode);
    if (!cleared.includes(puzzleId)) {
        cleared.push(puzzleId);
        localStorage.setItem(key, JSON.stringify(cleared));
    }
}

// --- サーバー連携・プレイヤー認証 ---

/**
 * サーバーから問題リストを動的にロードする関数
 */
async function loadPuzzlesAndWords() {
    const modeList = ['country', 'capital'];
    const playerId = currentPlayerId;
    
    try {
        // 1. 問題リストとクリア済みIDの取得
        for (const mode of modeList) {
            const url = `${API_BASE_URL}/puzzles/${mode}` + (playerId ? `?playerId=${playerId}` : '');
            const res = await fetch(url);
            
            if (!res.ok) throw new Error(`${mode}問題リストの取得に失敗`);
            
            const data = await res.json();
            
            // レスポンスオブジェクト全体を格納（puzzles, cleared_ids, player_identifiedを含む）
            allPuzzles[mode] = data; 
            
            // ログイン済みの場合、サーバーの最新クリア済みIDをLocalStorageに上書き同期
            if (data.player_identified) {
                const key = `cleared_puzzles_${mode}_id_${currentPlayerId}`;
                localStorage.setItem(key, JSON.stringify(data.cleared_ids));
            }
        }
        
        // 2. 辞書データの取得
        const countryWordsRes = await fetch(`${API_BASE_URL}/words/country`);
        const capitalWordsRes = await fetch(`${API_BASE_URL}/words/capital`);

        if (!countryWordsRes.ok || !capitalWordsRes.ok) throw new Error("辞書リストの取得に失敗");

        COUNTRY_DICT = await countryWordsRes.json();
        CAPITAL_DICT = await capitalWordsRes.json();
        
        updateHomeProblemCount();
        
    } catch (error) {
        console.error("問題または辞書のロードに失敗しました。", error);
        if (currentPlayerNickname === 'ゲスト' || !currentPlayerNickname) {
            alert("サーバーから問題データをロードできませんでした。API_BASE_URLが正しいか確認してください。");
        }
    }
}

/**
 * プレイヤーIDから最新のステータスを取得する
 */
async function getPlayerStatus(id) {
    if (!id) return false;
    
    try {
        const response = await fetch(`${API_BASE_URL}/player/${id}`);
        
        if (response.status === 404) {
             console.warn("サーバー応答: プレイヤー情報が見つかりません (404)。ローカルストレージをクリアします。");
             return false;
        }
        if (!response.ok) {
             throw new Error("プレイヤー情報取得サーバーエラー");
        }
        
        const data = await response.json();
        const player = data.player;

        // playerStatsを最新のクリア数で更新
        playerStats.country_clears = player.country_clears;
        playerStats.capital_clears = player.capital_clears;
        
        // LocalStorageをサーバーデータで上書き
        if (player.cleared_country_ids) {
            const countryKey = `cleared_puzzles_country_id_${id}`;
            localStorage.setItem(countryKey, JSON.stringify(player.cleared_country_ids));
        }
        if (player.cleared_capital_ids) {
            const capitalKey = `cleared_puzzles_capital_id_${id}`;
            localStorage.setItem(capitalKey, JSON.stringify(player.cleared_capital_ids));
        }
        
        return true;
    } catch (error) {
        console.error("プレイヤー情報の取得に失敗。", error);
        return false;
    }
}

/** 認証成功時のセッション設定ヘルパー関数 */
function setPlayerSession(playerData) {
    currentPlayerNickname = playerData.nickname;
    currentPlayerId = playerData.id; 
    // playerStatsを最新のクリア数で更新
    playerStats.country_clears = playerData.country_clears;
    playerStats.capital_clears = playerData.capital_clears;
    
    localStorage.setItem('keshimasu_nickname', currentPlayerNickname);
    localStorage.setItem('player_id', currentPlayerId);
}

/**
 * ログイン処理
 */
async function attemptLogin(nickname, passcode) {
    if (!nickname || nickname.trim() === "" || !passcode || passcode.trim() === "") {
        alert("ニックネームとパスコードの両方を入力してください。");
        return false;
    }

    const finalName = nickname.trim().slice(0, 20); // 20文字制限

    try {
        const response = await fetch(`${API_BASE_URL}/player/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: finalName, passcode })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            alert(`ログイン失敗: ${data.message || 'サーバーエラー'}`);
            return false;
        }

        if (data.isNewUser) {
             alert("ログイン失敗: そのニックネームは登録されていません。新規登録ボタンをご利用ください。");
             return false;
        }
        
        setPlayerSession(data.player);
        await getPlayerStatus(currentPlayerId); 
        
        alert(`${finalName}さん、ログイン成功です！`);
        await loadPuzzlesAndWords();
        showScreen('home');
        return true;

    } catch (error) {
        console.error("プレイヤー認証に失敗しました。", error);
        alert("ネットワークエラーによりログインに失敗しました。");
        return false;
    }
}


/**
 * 新規登録処理
 */
async function attemptRegister(nickname, passcode) {
    if (!nickname || nickname.trim() === "" || !passcode || passcode.trim() === "") {
        alert("ニックネームとパスコードの両方を入力してください。");
        return false;
    }

    const finalName = nickname.trim().slice(0, 20); // 20文字制限

    try {
        const response = await fetch(`${API_BASE_URL}/player/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: finalName, passcode })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            alert(`新規登録失敗: ${data.message || 'サーバーエラー'}`);
            return false;
        }

        if (!data.isNewUser) {
             alert("新規登録失敗: そのニックネームは既に登録されています。ログインボタンをご利用ください。");
             return false;
        }
        
        setPlayerSession(data.player);
        await getPlayerStatus(currentPlayerId); 
        alert(`${finalName}さん、新規登録成功です！`);
        await loadPuzzlesAndWords();
        showScreen('home');
        return true;

    } catch (error) {
        console.error("プレイヤー新規登録に失敗しました。", error);
        alert("ネットワークエラーにより登録に失敗しました。");
        return false;
    }
}

/**
 * アプリ初期化：認証状態のチェック
 */
async function setupPlayer() {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname');
    
    // ゲストの場合の初期値設定
    if (currentPlayerNickname === 'ゲスト' || !currentPlayerNickname) {
        playerStats.country_clears = getClearedPuzzles('country').length;
        playerStats.capital_clears = getClearedPuzzles('capital').length;
    }

    if (currentPlayerId && currentPlayerNickname && currentPlayerNickname !== 'ゲスト') {
        const success = await getPlayerStatus(currentPlayerId);
        
        if (success) {
            await loadPuzzlesAndWords();
            showScreen('home');
            return;
        }
        
        currentPlayerId = null;
        currentPlayerNickname = null;
        localStorage.removeItem('player_id');
        localStorage.removeItem('keshimasu_nickname');
    }
    
    await loadPuzzlesAndWords(); 
    showScreen('auth');
}


// --- 2. 画面表示と初期化 ---

function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        screens[key].style.display = (key === screenName) ? 'block' : 'none';
    });
    
    if (screenName === 'home') {
        appTitleElement.style.display = 'block';
        updateHomeProblemCount(); // playerStatsの更新後に呼ばれることを保証
        welcomeMessage.textContent = `${currentPlayerNickname}さん、ようこそ！`;
    } else {
        appTitleElement.style.display = 'none';
    }
}

function updateHomeProblemCount() {
    // allPuzzles.mode.puzzles が存在しない場合に備えてフォールバックを設ける
    const countryCount = allPuzzles.country.puzzles ? allPuzzles.country.puzzles.length : 0;
    const capitalCount = allPuzzles.capital.puzzles ? allPuzzles.capital.puzzles.length : 0;
    
    // LocalStorageではなくplayerStats（サーバーの値）を参照する
    const clearedCountryCount = playerStats.country_clears;
    const clearedCapitalCount = playerStats.capital_clears;

    document.getElementById('country-problem-count').textContent = `問題数: ${countryCount}問 (クリア済: ${clearedCountryCount})`;
    document.getElementById('capital-problem-count').textContent = `問題数: ${capitalCount}問 (クリア済: ${clearedCapitalCount})`;
}

function showPuzzleList(isCountry) {
    const mode = isCountry ? 'country' : 'capital';
    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';

    currentListMode = mode;

    const puzzles = allPuzzles[mode].puzzles || [];
    const serverClearedIds = allPuzzles[mode].cleared_ids || [];
    const localClearedIds = getClearedPuzzles(mode);
    const clearedIds = new Set([...serverClearedIds, ...localClearedIds]);

    document.getElementById('puzzle-list-title').textContent = `${modeName} 問題一覧`;

    const container = document.getElementById('puzzle-list-container');

    if (puzzles.length === 0) {
        container.innerHTML = '<p>問題がまだ登録されていません。</p>';
        showScreen('puzzleList');
        return;
    }

    const sortedPuzzles = [...puzzles].sort((a, b) => a.id - b.id);

    let html = `
        <table class="ranking-table">
            <tr>
                <th>問題番号</th>
                <th>製作者</th>
                <th>クリア者数</th>
                <th>状態</th>
                <th>挑戦</th>
            </tr>
    `;

    sortedPuzzles.forEach((puzzle, index) => {
        const isCleared = clearedIds.has(puzzle.id);

        // サーバー側で clear_count / clearCount / cleared_count のどれかを返す想定。
        // まだ無い場合は 0 表示。
        const clearCount =
            puzzle.clear_count ??
            puzzle.clearCount ??
            puzzle.cleared_count ??
            0;

        const creator = puzzle.creator || '不明';

        html += `
            <tr>
                <td>第 ${index + 1} 問</td>
                <td>${creator}</td>
                <td>${clearCount}人</td>
                <td>${isCleared ? 'クリア済' : '未クリア'}</td>
                <td>
                    <button onclick="startPuzzleById('${mode}', ${puzzle.id})">
                        ${isCleared ? '再挑戦' : '挑戦する'}
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</table>';

    container.innerHTML = html;
    showScreen('puzzleList');
}
function startPuzzleById(mode, puzzleId) {
    const isCountry = mode === 'country';
    const allProblemData = allPuzzles[mode].puzzles || [];

    allProblemData.sort((a, b) => a.id - b.id);

    const selectedPuzzle = allProblemData.find(puzzle => puzzle.id === puzzleId);

    if (!selectedPuzzle) {
        alert('選択された問題が見つかりませんでした。');
        showScreen('home');
        return;
    }

    currentPuzzleIndex = allProblemData.findIndex(p => p.id === selectedPuzzle.id);

    initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
    boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));

    isCountryMode = isCountry;
    isCreationPlay = false;
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT;

    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;

    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';
    document.getElementById('current-game-title').textContent = modeName;

    const displayNumber = currentPuzzleIndex + 1;
    document.getElementById('problem-number-display').textContent = `第 ${displayNumber} 問`;

    const creatorName = selectedPuzzle.creator || '不明';
    document.getElementById('creator-display').textContent = `制作者: ${creatorName}`;

    updateStatusDisplay();
    renderBoard(5);
    showScreen('mainGame');
}
/**
 * ゲームの開始
 */
function startGame(isCountry, isCreation) {
    const mode = isCountry ? 'country' : 'capital';
    const allProblemData = allPuzzles[mode].puzzles || []; 
    
    allProblemData.sort((a, b) => a.id - b.id);
    
    if (!isCreation) {
        // ★★★ 修正箇所開始 ★★★
        // サーバーからのクリア済みIDを取得
        const serverClearedIds = allPuzzles[mode].cleared_ids || [];
        
        // ローカルストレージ（ゲスト用）のクリア済みIDを取得
        const localClearedIds = getClearedPuzzles(mode);
        
        // 両方を結合してSetを作成（重複排除）
        // これにより、ゲストでもローカルのクリア履歴が反映され、次の問題に進めます
        const clearedIds = new Set([...serverClearedIds, ...localClearedIds]); 
        // ★★★ 修正箇所終了 ★★★
        
        const availablePuzzles = allProblemData
            .filter(puzzle => !clearedIds.has(puzzle.id));

        if (availablePuzzles.length === 0) {
            alert(`🎉 ${isCountry ? '国名' : '首都名'}ケシマスのすべての問題をクリアしました！`);
            showScreen('home');
            return;
        }

        const selectedPuzzle = availablePuzzles[0];
        
        // 現在の問題のインデックスを取得
        currentPuzzleIndex = allProblemData.findIndex(p => p.id === selectedPuzzle.id);
        
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        
        // 問題番号の表示（現在表示されているクリア数 + 1）
        const nextProblemNumber = playerStats[mode + '_clears'] + 1; 
        document.getElementById('problem-number-display').textContent = `第 ${nextProblemNumber} 問`;
        
    } else {
        currentPuzzleIndex = -1; 
        document.getElementById('problem-number-display').textContent = '問題制作モード'; 
    }

    isCountryMode = isCountry;
    isCreationPlay = isCreation; 
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT; 
    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;
    
    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';
    
    document.getElementById('current-game-title').textContent = modeName; 
    
    let creatorName = '銀の焼き鳥'; 
    if (isCreation) {
        creatorName = currentPlayerNickname;
    } else if (currentPuzzleIndex !== -1) {
        creatorName = allProblemData[currentPuzzleIndex].creator; 
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

/**
 * プレイヤーのスコアとクリア済みIDをサーバーに更新する
 */
async function updatePlayerScore(mode, puzzleId) { 
    if (!currentPlayerId || isCreationPlay) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/score/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                playerId: currentPlayerId,
                mode: mode, 
                puzzleId: puzzleId // クリアした問題のIDをサーバーに送信
            })
        });
        
        if (!response.ok) throw new Error('スコア更新サーバーエラー');

        const data = await response.json();
        
        // サーバーから返された最新スコアでplayerStatsを直ちに更新
        playerStats[mode + '_clears'] = data.newScore;
        
    } catch (error) {
        console.error("スコア更新に失敗しました。", error);
    }
}

/**
 * 問題制作モードでクリアした問題をサーバーに登録する関数
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
        
        await loadPuzzlesAndWords(); // 問題を再ロードして最新の問題リストを取得
        
    } catch (error) {
        console.error("問題登録に失敗しました。", error);
        alert("問題の登録に失敗しました。サーバーが起動しているか、API_BASE_URLが正しいか確認してください。");
    }
}

/**
 * ゲームクリア時にスコア更新、通知、画面更新を行う
 */
async function checkGameStatus() { 
    const totalChars = boardData.flat().filter(char => char !== '').length;
    
    if (totalChars === 0) {
        const mode = isCountryMode ? 'country' : 'capital';
        const modeName = isCountryMode ? '国名' : '首都名';
        
        if (!isCreationPlay) {
            const problemDataList = allPuzzles[mode].puzzles || [];
            // initialPlayData (解答前の盤面)からパズルIDを特定する
            const currentPuzzle = problemDataList.find(p => JSON.stringify(p.data) === JSON.stringify(initialPlayData)); 

            if (currentPuzzle && currentPuzzle.id) {
                markPuzzleAsCleared(mode, currentPuzzle.id); 
                
                // 1. スコア更新を待ち、playerStatsを最新値にする
                if (currentPlayerId) {
                    await updatePlayerScore(mode, currentPuzzle.id); 
                } else {
                    // ゲストモードの場合、ローカルでスコアをインクリメント
                    playerStats[mode + '_clears']++; 
                }
            }

            // 2. 通知に最新のスコア (playerStats[mode + '_clears']) を反映
            const latestClearedCount = playerStats[mode + '_clears']; 
            alert(`🎉 全ての文字を消去しました！クリアです！\nあなたの${modeName}クリア数は${latestClearedCount}問になりました。`);
            
            // 3. 問題リストとホーム画面表示を更新するため、サーバーからデータを再ロード
            await loadPuzzlesAndWords(); 
            showScreen('home'); // 標準モードはホームに戻る
        
        } else {
            const registrationConfirmed = confirm("🎉 作成した問題をクリアしました！\nこの問題を標準問題として登録しますか？");
            if (registrationConfirmed) {
                const finalBoard = JSON.parse(JSON.stringify(initialPlayData));
                await submitNewPuzzle(mode, finalBoard, currentPlayerNickname);
                showScreen('home'); // 登録した場合はホームに戻る
            } else {
                alert("問題の登録をスキップしました。作成画面に戻ります。");
                
                // 登録スキップ時は、作成画面に戻して再編集可能にする
                showScreen('create'); 
                renderCreateBoard(); 
                fillCreateBoard(initialPlayData); // 元の入力データを復元
                btnInputComplete.disabled = false;
                document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';
                document.getElementById('creation-mode-select').value = mode; 
            }
        }
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
    renderBoard(5); 
}

/** 消去ボタンイベントリスナー */
eraseButton.addEventListener('click', async () => { 
    if (selectedCells.length < 2) return;

    // 選択されたセルを正しい順番（左から右、上から下）にソートする
    let sortedSelectedCells = [...selectedCells];
    const [firstR, firstC] = selectedCells[0];
    // selectedCellsがすべて同じ行 (r) であれば水平方向
    const isHorizontal = selectedCells.every(coord => coord[0] === firstR); 
    
    if (isHorizontal) {
        // 水平方向の場合: 列 (c) で昇順にソート (左から右)
        sortedSelectedCells.sort((a, b) => a[1] - b[1]);
    } else {
        // 垂直方向の場合: 行 (r) で昇順にソート (上から下)
        sortedSelectedCells.sort((a, b) => a[0] - b[0]);
    }

    let selectedWordChars = sortedSelectedCells.map(([r, c]) => boardData[r][c]); 
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
                if (!isValidGameChar(inputChar) && inputChar !== 'F') {
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
        renderCreateBoard(); // 制作画面のボードをリセット
        // 制作モードで元の入力データを盤面に復元
        fillCreateBoard(initialPlayData); 
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';
        
    } else if (currentPuzzleIndex !== -1) {
        // allPuzzles[mode].puzzles を参照する
        const problemDataList = isCountryMode ? allPuzzles.country.puzzles : allPuzzles.capital.puzzles;
        const selectedPuzzle = problemDataList[currentPuzzleIndex];
        
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        selectedCells = [];
        usedWords = [];
        eraseButton.disabled = true;
        
        renderBoard(5); 
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
          
           // --- フリック入力・濁音対応（IME制御） ---
           input.addEventListener('compositionstart', () => {
               isComposing = true;
           });

           input.addEventListener('compositionend', (e) => {
               isComposing = false;
               // 確定後、即座にチェックを実行
               checkCreationInput(e); 
           });
           
           input.addEventListener('input', (e) => {
               // IME入力中でなければ、すぐにチェック
               if (!isComposing) {
                   checkCreationInput(e);
               }
           });
           
           // フォーカスが外れたとき（濁音などが確定する）
           input.addEventListener('blur', (e) => {
               isComposing = false; 
               checkCreationInput(e);
           });
            
            cell.appendChild(input);
            createBoardElement.appendChild(cell);
        }
    }
    // 初期値は国名モードにする
    document.getElementById('creation-mode-select').value = 'country';
}

// ヘルパー関数: 2次元配列のデータを制作ボードのinputに設定する
function fillCreateBoard(data) {
    if (!data || data.length === 0) return;
    const inputs = document.querySelectorAll('.create-input');
    inputs.forEach(input => {
        const r = parseInt(input.dataset.r);
        const c = parseInt(input.dataset.c);
        if (r < data.length && c < data[r].length) {
            input.value = data[r][c] || '';
        }
    });
    checkCreationInput(); // 埋めた後にステータスを更新
}

function checkCreationInput(event) {
    if (event && event.target) {
        let input = event.target;
        let value = input.value;
        
        // IME確定後、またはblur時（isComposingがfalseの時）のみ、文字のチェックと変換を行う
        if (event.type === 'compositionend' || event.type === 'blur' || !isComposing) {
            value = value.toUpperCase();
            value = toKatakana(value);

            // Fの入力を許容
            if (value.length > 0 && !isValidGameChar(value) && value !== 'F') { 
                value = ''; 
            }
            input.value = value.slice(0, 1);
        }
    }

    const inputs = document.querySelectorAll('.create-input');
    let filledCount = 0;
    
    inputs.forEach(input => {
        if (input.value.length === 1 && (isValidGameChar(input.value) || input.value === 'F')) {
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
        html += `<table class="ranking-table"><tr><th>順位</th><th>ニックネーム</th><th>クリア数</th></tr>`;
        
        rankings.forEach(item => {
            const isCurrentPlayer = item.nickname === currentPlayerNickname;
            html += `<tr style="${isCurrentPlayer ? 'background-color: #554400; font-weight: bold; color:#FFD700;' : ''}"><td>${item.rank}</td><td>${item.nickname}</td><td>${item.score}</td></tr>`;
        });
        
        html += '</table>';
        container.innerHTML = html;

    } catch (error) {
        console.error("ランキング取得に失敗しました。", error);
        container.innerHTML = `<p style="color:red;">ランキング取得エラー: サーバーが起動しているか、ネットワーク接続を確認してください。</p>`;
    }
}


// --- 5.5. ワードリスト表示ロジック ---

function displayWordList(type) {
    const dictionary = (type === 'country') ? COUNTRY_DICT : CAPITAL_DICT;
    
    if (dictionary.length === 0) {
        wordListContent.innerHTML = `<p>辞書データがサーバーからロードされていません。</p>`;
        return;
    }

    wordListTabs.querySelectorAll('button').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    wordListContent.innerHTML = '';
    dictionary.sort((a, b) => {
        if (a.length !== b.length) {
            return a.length - b.length;
        }
        return a.localeCompare(b);
    });
    
    dictionary.forEach(word => {
        const item = document.createElement('div');
        item.classList.add('word-item');
        item.textContent = word;
        wordListContent.appendChild(item);
    });
}

// --- 6. イベントリスナーの設定 ---

// 日本語入力時でもリアルタイムでmaxlengthを強制する関数
function enforceMaxLength(elementId, maxLength) {
    const inputElement = document.getElementById(elementId);
    if (inputElement) {
        inputElement.addEventListener('input', function() {
            if (this.value.length > maxLength) {
                this.value = this.value.substring(0, maxLength);
            }
        });
    }
}

if (btnLoginSubmit) {
    btnLoginSubmit.addEventListener('click', () => {
        attemptLogin(inputNickname.value, inputPasscode.value);
    });
}
if (btnRegisterSubmit) {
    btnRegisterSubmit.addEventListener('click', () => {
        attemptRegister(inputNickname.value, inputPasscode.value);
    });
}
if (inputPasscode) {
    inputPasscode.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            attemptLogin(inputNickname.value, inputPasscode.value);
        }
    });
}
if (btnGuestPlay) { 
    btnGuestPlay.addEventListener('click', async () => {
        currentPlayerNickname = "ゲスト";
        currentPlayerId = null;
        localStorage.removeItem('player_id');
        localStorage.removeItem('keshimasu_nickname');
        
        // ゲストモード開始時にローカルのクリア数をplayerStatsに反映
        playerStats.country_clears = getClearedPuzzles('country').length; 
        playerStats.capital_clears = getClearedPuzzles('capital').length; 
        
        alert("ゲストとしてゲームを開始します。スコアはランキングに保存されません。");
        await loadPuzzlesAndWords(); 
        showScreen('home');
    });
}
document.getElementById('btn-logout').addEventListener('click', () => {
    currentPlayerNickname = null;
    currentPlayerId = null;
    localStorage.removeItem('player_id');
    localStorage.removeItem('keshimasu_nickname');
    inputNickname.value = '';
    inputPasscode.value = '';
    showScreen('auth');
});


// ホーム画面リスナー
document.getElementById('btn-country-mode').addEventListener('click', () => {
    showPuzzleList(true);
});

document.getElementById('btn-capital-mode').addEventListener('click', () => {
    showPuzzleList(false);
});
document.getElementById('btn-puzzle-list-back').addEventListener('click', () => {
    showScreen('home');
});
document.getElementById('btn-create-mode').addEventListener('click', () => {
    if (!currentPlayerNickname || currentPlayerNickname === 'ゲスト') {
        alert("問題制作モードを利用するには、ログインしてください。");
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

// ランキングタブのリスナー
rankingTabs.addEventListener('click', (event) => {
    if (event.target.tagName === 'BUTTON') {
        fetchAndDisplayRanking(event.target.dataset.type);
    }
});

// ワードリストボタンのリスナー
document.getElementById('btn-word-list').addEventListener('click', () => {
    showScreen('wordList');
    displayWordList('country'); 
});
wordListTabs.addEventListener('click', (event) => {
    if (event.target.tagName === 'BUTTON') {
        displayWordList(event.target.dataset.type);
    }
});

// 画面遷移ボタン
document.getElementById('btn-back-to-home').addEventListener('click', () => {
    showScreen('home');
});
document.getElementById('btn-create-back').addEventListener('click', () => {
    showScreen('home');
});
document.getElementById('btn-ranking-back').addEventListener('click', () => {
    showScreen('home');
});
document.getElementById('btn-word-list-back').addEventListener('click', () => {
    showScreen('home');
});


// --- 7. 初期化 ---
// ニックネーム入力の制限を適用
document.addEventListener('DOMContentLoaded', () => {
    enforceMaxLength('nickname-input', 20); 
});

setupPlayer();