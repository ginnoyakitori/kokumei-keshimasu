// keshimasu-client/script.js
// ----------------------------------------------------
// フロントエンド JavaScript コード (PostgreSQL対応、ログイン/新規登録分離済み)
// ----------------------------------------------------

// ★★★ 🚨 要修正 ★★★
// あなたのNode.jsサーバーの公開URLに置き換えてください。
// 例: const API_BASE_URL = 'https://keshimasu-server.onrender.com/api';
const API_BASE_URL = 'https://kokumei-keshimasu.onrender.com/api'; 

// --- 1. 定数と初期データ ---

// サーバーから動的にロードされる問題リスト
let allPuzzles = { country: [], capital: [] }; 

// ゲームで使用する辞書 (サーバーから取得するように変更)
let COUNTRY_DICT = [];
let CAPITAL_DICT = []; 

// ゲームの状態変数
let boardData = []; 
let initialPlayData = []; 
let selectedCells = []; 
let usedWords = [];     
let isCountryMode = true; 
let isCreationPlay = false; 
let currentDictionary = [];
let currentPuzzleIndex = -1; 

// ランキング/プレイヤー関連
let currentPlayerNickname = null; // 認証前はnull
let currentPlayerId = null; 
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
    wordList: document.getElementById('word-list-screen')
};
const appTitleElement = document.getElementById('app-title'); 
const boardElement = document.getElementById('board');
const eraseButton = document.getElementById('erase-button');
const createBoardElement = document.getElementById('create-board');
const btnInputComplete = document.getElementById('btn-input-complete');
const resetBtn = document.getElementById('reset-button');

// 認証フォーム要素 (★修正: HTMLのIDに合わせて変更)
const inputNickname = document.getElementById('nickname-input');
const inputPasscode = document.getElementById('passcode-input');

// 修正: ログインと新規登録、ゲストプレイボタンを個別に取得
const btnLoginSubmit = document.getElementById('login-btn'); 
const btnRegisterSubmit = document.getElementById('signup-btn');
const btnGuestPlay = document.getElementById('guest-play-btn'); // ★追加
const welcomeMessage = document.getElementById('welcome-message');

// ワードリスト要素
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
 */
function getClearedPuzzles(mode) {
    // プレイヤーごとにIDリストを管理するため、IDを含めたキーを使用
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
    try {
        // 問題リストのロード
        const countryRes = await fetch(`${API_BASE_URL}/puzzles/country`);
        const capitalRes = await fetch(`${API_BASE_URL}/puzzles/capital`);
        
        if (!countryRes.ok || !capitalRes.ok) throw new Error("問題リストの取得に失敗");
        
        allPuzzles.country = await countryRes.json();
        allPuzzles.capital = await capitalRes.json();

        // 辞書リストのロード
        const countryWordsRes = await fetch(`${API_BASE_URL}/words/country`);
        const capitalWordsRes = await fetch(`${API_BASE_URL}/words/capital`);

        if (!countryWordsRes.ok || !capitalWordsRes.ok) throw new Error("辞書リストの取得に失敗");

        COUNTRY_DICT = await countryWordsRes.json();
        CAPITAL_DICT = await capitalWordsRes.json();
        
        updateHomeProblemCount();
        
    } catch (error) {
        console.error("問題または辞書のロードに失敗しました。サーバーが起動しているか確認してください。", error);
        if (currentPlayerNickname === 'ゲスト' || !currentPlayerNickname) {
            alert("サーバーから問題データをロードできませんでした。API_BASE_URLが正しいか確認してください。");
        }
    }
}

/**
 * プレイヤーIDから最新のステータスを取得する
 */
async function getPlayerStatus(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/player/${id}`);
        
        // サーバーが404を返した場合（プレイヤー情報が見つからない）、ログイン情報無効として扱う
        if (response.status === 404) {
             console.warn("サーバー応答: プレイヤー情報が見つかりません (404)。ローカルストレージをクリアします。");
             return false;
        }
        if (!response.ok) {
             throw new Error("プレイヤー情報取得サーバーエラー");
        }
        
        const data = await response.json();
        playerStats.country_clears = data.player.country_clears;
        playerStats.capital_clears = data.player.capital_clears;
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
    playerStats.country_clears = playerData.country_clears;
    playerStats.capital_clears = playerData.capital_clears;
    
    localStorage.setItem('keshimasu_nickname', currentPlayerNickname);
    localStorage.setItem('player_id', currentPlayerId);
}

/**
 * ログイン処理 (既存ユーザーの認証)
 */
async function attemptLogin(nickname, passcode) {
    if (!nickname || nickname.trim() === "" || !passcode || passcode.trim() === "") {
        alert("ニックネームとパスコードの両方を入力してください。");
        return false;
    }

    const finalName = nickname.trim().slice(0, 10);

    try {
        // サーバーは/registerエンドポイントで新規登録/ログインを判定
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
             // サーバーが新規登録として処理した場合、ログインとしては失敗とみなしメッセージを変更
             alert("ログイン失敗: そのニックネームは登録されていません。新規登録ボタンをご利用ください。");
             return false;
        }
        
        // ログイン成功
        setPlayerSession(data.player);
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
 * 新規登録処理 (新規ユーザーの登録)
 */
async function attemptRegister(nickname, passcode) {
    if (!nickname || nickname.trim() === "" || !passcode || passcode.trim() === "") {
        alert("ニックネームとパスコードの両方を入力してください。");
        return false;
    }

    const finalName = nickname.trim().slice(0, 10);

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
             // サーバーが既存ユーザーとして処理した場合、新規登録としては失敗とみなしメッセージを変更
             alert("新規登録失敗: そのニックネームは既に登録されています。ログインボタンをご利用ください。");
             return false;
        }
        
        // 新規登録成功
        setPlayerSession(data.player);
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
 * ページロード時に認証状態をチェックし、認証画面を表示する
 */
async function setupPlayer() {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname');

    // 認証済みの場合、サーバーから最新のステータスを取得
    if (currentPlayerId && currentPlayerNickname) {
        const success = await getPlayerStatus(currentPlayerId);
        
        if (success) {
            await loadPuzzlesAndWords();
            showScreen('home');
            return;
        }
        
        // ステータス取得失敗（ID無効、サーバー404/500、ネットワークエラーなど）の場合
        currentPlayerId = null;
        currentPlayerNickname = null;
        localStorage.removeItem('player_id');
        localStorage.removeItem('keshimasu_nickname');
    }
    
    // 未認証の場合は認証画面を表示
    await loadPuzzlesAndWords(); // 辞書だけはロードしておく
    showScreen('auth');
}


// --- 2. 画面表示と初期化 ---

/**
 * 画面を表示し、メインタイトルの表示を制御する
 */
function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        screens[key].style.display = (key === screenName) ? 'block' : 'none';
    });
    
    // ホーム画面でのみメインタイトルを表示
    if (screenName === 'home') {
        appTitleElement.style.display = 'block';
        updateHomeProblemCount();
        welcomeMessage.textContent = `${currentPlayerNickname}さん、ようこそ！`;
    } else {
        appTitleElement.style.display = 'none';
    }
}

/**
 * ホーム画面に問題数を表示する
 */
function updateHomeProblemCount() {
    const countryCount = allPuzzles.country.length;
    const capitalCount = allPuzzles.capital.length;
    
    // 解決済みの問題数を計算
    const clearedCountryCount = getClearedPuzzles('country').length;
    const clearedCapitalCount = getClearedPuzzles('capital').length;

    document.getElementById('country-problem-count').textContent = `問題数: ${countryCount}問 `;
    document.getElementById('capital-problem-count').textContent = `問題数: ${capitalCount}問 `;
}

/**
 * ゲームの開始。未クリアの問題の中からインデックスが最も小さいものを選択する。
 */
function startGame(isCountry, isCreation) {
    const mode = isCountry ? 'country' : 'capital';
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

        const selectedPuzzle = availablePuzzles[0];
        
        currentPuzzleIndex = problemList.findIndex(p => p.id === selectedPuzzle.id);
        
        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        
        // ★問題番号の修正: 表示される問題番号をローカルのクリア数に同期★
        const nextProblemNumber = clearedIds.length + 1;
        document.getElementById('problem-number-display').textContent = `第 ${nextProblemNumber} 問`;
        
    } else {
        currentPuzzleIndex = -1; 
        document.getElementById('problem-number-display').textContent = '問題制作モード'; 
    }

    isCountryMode = isCountry;
    isCreationPlay = isCreation; 
    currentDictionary = isCountry ? COUNTRY_DICT : CAPITAL_DICT; // 辞書を更新
    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;
    
    const modeName = isCountry ? '国名ケシマス' : '首都名ケシマス';
    
    document.getElementById('current-game-title').textContent = modeName; 
    
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
    // ゲストプレイまたは制作モードではランキングスコアは更新しない
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
        
        // 問題リストを再ロードしてホーム画面の問題数を更新
        await loadPuzzlesAndWords();
        
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
                // ローカルのクリア記録を確実に行う
                markPuzzleAsCleared(mode, currentPuzzle.id); 
            }

            // スコアを更新し、最新の統計情報を取得
            await updatePlayerScore(mode); 
            
            const localClearedCount = getClearedPuzzles(mode).length;
            
            alert(`🎉 全ての文字を消去しました！クリアです！\nあなたの${modeName}クリア数は${localClearedCount}問になりました。`);
        } else {
            // 制作モードのクリア処理で問題登録を呼び出す
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
        // 制作モードの解答中にリセットボタンを押すと、入力完了前の画面に戻る
        showScreen('create');
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';
        
    } else if (currentPuzzleIndex !== -1) {
        // 標準問題のリセット
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

    // プレイヤーの最新統計情報を使う
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

/**
 * 利用可能な国名または首都名のリストを画面に描画する
 */
function displayWordList(type) {
    // 辞書を選択
    const dictionary = (type === 'country') ? COUNTRY_DICT : CAPITAL_DICT;
    
    if (dictionary.length === 0) {
        wordListContent.innerHTML = `<p>辞書データがサーバーからロードされていません。</p>`;
        return;
    }

    // タブのCSSを更新
    wordListTabs.querySelectorAll('button').forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // リストの描画
    wordListContent.innerHTML = '';
    dictionary.sort((a, b) => {
        // 文字列の長さでソートし、同じ長さなら辞書順
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

// 認証画面リスナー
// ★修正: nullチェックを追加
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
            // Enterキーでログインを試行
            attemptLogin(inputNickname.value, inputPasscode.value);
        }
    });
}
if (btnGuestPlay) { // ★修正: 新しい変数名を使用
    btnGuestPlay.addEventListener('click', async () => {
        currentPlayerNickname = "ゲスト";
        currentPlayerId = null;
        // ゲストの場合、ローカルストレージの認証情報をクリア
        localStorage.removeItem('player_id');
        localStorage.removeItem('keshimasu_nickname');
        alert("ゲストとしてゲームを開始します。スコアは保存されません。");
        
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
    startGame(true, false); 
});
document.getElementById('btn-capital-mode').addEventListener('click', () => {
    startGame(false, false); 
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

// 初期化
setupPlayer();