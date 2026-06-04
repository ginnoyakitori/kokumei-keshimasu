// keshimasu-client/script.js
// 国名ケシマス----// 国名ケシマス + 首都名ケシマス + ポケモンケシマス 統合版
// API URL
// ----------------------------------------------------
const API_BASE_URL = 'https://kokumei-keshimasu.onrender.com/api';

// ----------------------------------------------------
// 1. 定数と初期データ
// ----------------------------------------------------
let allPuzzles = {
    country: {},
    capital: {},
    pokemon: {}
};

let COUNTRY_DICT = [];
let CAPITAL_DICT = [];
let POKEMON_DICT = [];

let boardData = [];
let initialPlayData = [];
let selectedCells = [];
let usedWords = [];

let isCountryMode = true; // 既存互換用
let currentMode = 'country';

let isCreationPlay = false;
let currentDictionary = [];
let currentPuzzleIndex = -1;
let currentListMode = 'country';

// IME入力中かどうかを判定するフラグ（作問モード用）
let isComposing = false;

let currentPlayerNickname = null;
let currentPlayerId = null;

let playerStats = {
    country_clears: 0,
    capital_clears: 0,
    pokemon_clears: 0
};

// ----------------------------------------------------
// DOM要素の取得
// ----------------------------------------------------
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

// ----------------------------------------------------
// ユーティリティ関数
// ----------------------------------------------------
function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, function (match) {
        const chr = match.charCodeAt(0) + 0x60;
        return String.fromCharCode(chr);
    });
}

function isValidGameChar(char) {
    if (char === 'F') return true;

    // ポケモンケシマス用の特殊文字
    // ニドラン♂、ニドラン♀、ポリゴンZ、ミュウツー等に対応
    const pokemonSpecialChars = ['♂', '♀', 'Z', '2'];

    if (pokemonSpecialChars.includes(char)) return true;

    // カタカナ1文字
    return /^[\u30a0-\u30ff]$/.test(char);
}


function getModeName(mode) {
    if (mode === 'country') return '国名ケシマス';
    if (mode === 'capital') return '首都名ケシマス';
    if (mode === 'pokemon') return 'ポケモンケシマス';
    return 'ケシマス';
}

function getShortModeName(mode) {
    if (mode === 'country') return '国名';
    if (mode === 'capital') return '首都名';
    if (mode === 'pokemon') return 'ポケモン';
    return '問題';
}

function getDictionaryByMode(mode) {
    if (mode === 'country') return COUNTRY_DICT;
    if (mode === 'capital') return CAPITAL_DICT;
    if (mode === 'pokemon') return POKEMON_DICT;
    return [];
}

function isValidMode(mode) {
    return ['country', 'capital', 'pokemon'].includes(mode);
}

// ----------------------------------------------------
// LocalStorageによるクリア状態管理
// ----------------------------------------------------
function getClearedPuzzles(mode) {
    const key = `cleared_puzzles_${mode}_id_${currentPlayerId || 'guest'}`;
    const cleared = localStorage.getItem(key);

    try {
        return cleared ? JSON.parse(cleared) : [];
    } catch (error) {
        console.warn('クリア済みIDの読み込みに失敗しました:', error);
        return [];
    }
}

function markPuzzleAsCleared(mode, puzzleId) {
    const key = `cleared_puzzles_${mode}_id_${currentPlayerId || 'guest'}`;
    const numericPuzzleId = Number(puzzleId);

    let cleared = getClearedPuzzles(mode).map(id => Number(id));

    if (!cleared.includes(numericPuzzleId)) {
        cleared.push(numericPuzzleId);
        localStorage.setItem(key, JSON.stringify(cleared));
    }
}

// ----------------------------------------------------
// サーバー連携・プレイヤー認証
// ----------------------------------------------------
async function loadPuzzlesAndWords() {
    const modeList = ['country', 'capital', 'pokemon'];
    const playerId = currentPlayerId;

    try {
        // 1. 問題リストとクリア済みIDの取得
        for (const mode of modeList) {
            const url = `${API_BASE_URL}/puzzles/${mode}` + (playerId ? `?playerId=${playerId}` : '');
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error(`${mode}問題リストの取得に失敗`);
            }

            const data = await res.json();
            allPuzzles[mode] = data;

            if (data.player_identified) {
                const key = `cleared_puzzles_${mode}_id_${currentPlayerId}`;
                localStorage.setItem(key, JSON.stringify(data.cleared_ids || []));
            }
        }

        // 2. 辞書データの取得
        const countryWordsRes = await fetch(`${API_BASE_URL}/words/country`);
        const capitalWordsRes = await fetch(`${API_BASE_URL}/words/capital`);
        const pokemonWordsRes = await fetch(`${API_BASE_URL}/words/pokemon`);

        if (!countryWordsRes.ok || !capitalWordsRes.ok || !pokemonWordsRes.ok) {
            throw new Error('辞書リストの取得に失敗');
        }

        COUNTRY_DICT = await countryWordsRes.json();
        CAPITAL_DICT = await capitalWordsRes.json();
        POKEMON_DICT = await pokemonWordsRes.json();

        updateHomeProblemCount();

    } catch (error) {
        console.error('問題または辞書のロードに失敗しました。', error);

        if (currentPlayerNickname === 'ゲスト' || !currentPlayerNickname) {
            alert('サーバーから問題データをロードできませんでした。API_BASE_URLやサーバー設定を確認してください。');
        }
    }
}

async function getPlayerStatus(id) {
    if (!id) return false;

    try {
        const response = await fetch(`${API_BASE_URL}/player/${id}`);

        if (response.status === 404) {
            console.warn('サーバー応答: プレイヤー情報が見つかりません (404)。');
            return false;
        }

        if (!response.ok) {
            throw new Error('プレイヤー情報取得サーバーエラー');
        }

        const data = await response.json();
        const player = data.player;

        playerStats.country_clears = player.country_clears || 0;
        playerStats.capital_clears = player.capital_clears || 0;
        playerStats.pokemon_clears = player.pokemon_clears || 0;

        if (player.cleared_country_ids) {
            localStorage.setItem(
                `cleared_puzzles_country_id_${id}`,
                JSON.stringify(player.cleared_country_ids)
            );
        }

        if (player.cleared_capital_ids) {
            localStorage.setItem(
                `cleared_puzzles_capital_id_${id}`,
                JSON.stringify(player.cleared_capital_ids)
            );
        }

        if (player.cleared_pokemon_ids) {
            localStorage.setItem(
                `cleared_puzzles_pokemon_id_${id}`,
                JSON.stringify(player.cleared_pokemon_ids)
            );
        }

        return true;

    } catch (error) {
        console.error('プレイヤー情報の取得に失敗。', error);
        return false;
    }
}

function setPlayerSession(playerData) {
    currentPlayerNickname = playerData.nickname;
    currentPlayerId = playerData.id;

    playerStats.country_clears = playerData.country_clears || 0;
    playerStats.capital_clears = playerData.capital_clears || 0;
    playerStats.pokemon_clears = playerData.pokemon_clears || 0;

    localStorage.setItem('keshimasu_nickname', currentPlayerNickname);
    localStorage.setItem('player_id', currentPlayerId);
}

async function attemptLogin(nickname, passcode) {
    if (!nickname || nickname.trim() === '' || !passcode || passcode.trim() === '') {
        alert('ニックネームとパスコードの両方を入力してください。');
        return false;
    }

    const finalName = nickname.trim().slice(0, 20);

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
            alert('ログイン失敗: そのニックネームは登録されていません。新規登録ボタンをご利用ください。');
            return false;
        }

        setPlayerSession(data.player);
        await getPlayerStatus(currentPlayerId);

        alert(`${finalName}さん、ログイン成功です！`);

        await loadPuzzlesAndWords();
        showScreen('home');

        return true;

    } catch (error) {
        console.error('プレイヤー認証に失敗しました。', error);
        alert('ネットワークエラーによりログインに失敗しました。');
        return false;
    }
}

async function attemptRegister(nickname, passcode) {
    if (!nickname || nickname.trim() === '' || !passcode || passcode.trim() === '') {
        alert('ニックネームとパスコードの両方を入力してください。');
        return false;
    }

    const finalName = nickname.trim().slice(0, 20);

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
            alert('新規登録失敗: そのニックネームは既に登録されています。ログインボタンをご利用ください。');
            return false;
        }

        setPlayerSession(data.player);
        await getPlayerStatus(currentPlayerId);

        alert(`${finalName}さん、新規登録成功です！`);

        await loadPuzzlesAndWords();
        showScreen('home');

        return true;

    } catch (error) {
        console.error('プレイヤー新規登録に失敗しました。', error);
        alert('ネットワークエラーにより登録に失敗しました。');
        return false;
    }
}

async function setupPlayer() {
    currentPlayerId = localStorage.getItem('player_id');
    currentPlayerNickname = localStorage.getItem('keshimasu_nickname');

    if (currentPlayerNickname === 'ゲスト' || !currentPlayerNickname) {
        playerStats.country_clears = getClearedPuzzles('country').length;
        playerStats.capital_clears = getClearedPuzzles('capital').length;
        playerStats.pokemon_clears = getClearedPuzzles('pokemon').length;
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

// ----------------------------------------------------
// 2. 画面表示と初期化
// ----------------------------------------------------
function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        if (screens[key]) {
            screens[key].style.display = (key === screenName) ? 'block' : 'none';
        }
    });

    if (screenName === 'home') {
        appTitleElement.style.display = 'block';
        updateHomeProblemCount();

        if (currentPlayerNickname) {
            welcomeMessage.textContent = `${currentPlayerNickname}さん、ようこそ！`;
        } else {
            welcomeMessage.textContent = '';
        }
    } else {
        appTitleElement.style.display = 'none';
    }
}

function updateHomeProblemCount() {
    const countryCount = allPuzzles.country.puzzles ? allPuzzles.country.puzzles.length : 0;
    const capitalCount = allPuzzles.capital.puzzles ? allPuzzles.capital.puzzles.length : 0;
    const pokemonCount = allPuzzles.pokemon.puzzles ? allPuzzles.pokemon.puzzles.length : 0;

    const clearedCountryCount = playerStats.country_clears || 0;
    const clearedCapitalCount = playerStats.capital_clears || 0;
    const clearedPokemonCount = playerStats.pokemon_clears || 0;

    const countryCountElement = document.getElementById('country-problem-count');
    const capitalCountElement = document.getElementById('capital-problem-count');
    const pokemonCountElement = document.getElementById('pokemon-problem-count');

    if (countryCountElement) {
        countryCountElement.textContent =
            `問題数: ${countryCount}問 (クリア済: ${clearedCountryCount})`;
    }

    if (capitalCountElement) {
        capitalCountElement.textContent =
            `問題数: ${capitalCount}問 (クリア済: ${clearedCapitalCount})`;
    }

    if (pokemonCountElement) {
        pokemonCountElement.textContent =
            `問題数: ${pokemonCount}問 (クリア済: ${clearedPokemonCount})`;
    }
}

// ----------------------------------------------------
// 問題一覧
// ----------------------------------------------------
function showPuzzleListByMode(mode) {
    if (!isValidMode(mode)) {
        alert('無効なモードです。');
        return;
    }

    const modeName = getModeName(mode);

    currentListMode = mode;

    const puzzles = allPuzzles[mode].puzzles || [];
    const serverClearedIds = allPuzzles[mode].cleared_ids || [];
    const localClearedIds = getClearedPuzzles(mode);

    const clearedIds = new Set(
        [...serverClearedIds, ...localClearedIds].map(id => Number(id))
    );

    document.getElementById('puzzle-list-title').textContent = `${modeName} 問題一覧`;

    const container = document.getElementById('puzzle-list-container');

    if (puzzles.length === 0) {
        container.innerHTML = `
            <div class="puzzle-list-empty">
                問題がまだ登録されていません。
            </div>
        `;
        showScreen('puzzleList');
        return;
    }

    const sortedPuzzles = [...puzzles].sort((a, b) => Number(a.id) - Number(b.id));

    let html = '';

    sortedPuzzles.forEach((puzzle, index) => {
        const puzzleId = Number(puzzle.id);
        const isCleared = clearedIds.has(puzzleId);

        const clearCount =
            puzzle.clear_count ??
            puzzle.clearCount ??
            puzzle.cleared_count ??
            0;

        const creator = puzzle.creator || '不明';

        html += `
            <div class="puzzle-card ${isCleared ? 'cleared' : 'uncleared'}">
                <div class="puzzle-card-header">
                    <div class="puzzle-number">第 ${index + 1} 問</div>
                    <div class="puzzle-status ${isCleared ? 'cleared' : 'uncleared'}">
                        ${isCleared ? 'クリア済' : '未クリア'}
                    </div>
                </div>

                <div class="puzzle-meta">
                    <div class="puzzle-meta-label">製作者</div>
                    <div class="puzzle-meta-value">${creator}</div>

                    <div class="puzzle-meta-label">クリア者数</div>
                    <div class="puzzle-meta-value puzzle-clear-count">${clearCount}人</div>
                </div>

                <button class="puzzle-challenge-btn" onclick="startPuzzleById('${mode}', ${puzzleId})">
                    ${isCleared ? 'もう一度挑戦する' : 'この問題に挑戦する'}
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
    showScreen('puzzleList');
}

// 既存互換用
function showPuzzleList(isCountry) {
    showPuzzleListByMode(isCountry ? 'country' : 'capital');
}

function startPuzzleById(mode, puzzleId) {
    if (!isValidMode(mode)) {
        alert('無効なモードです。');
        showScreen('home');
        return;
    }

    const allProblemData = allPuzzles[mode].puzzles || [];

    allProblemData.sort((a, b) => Number(a.id) - Number(b.id));

    const selectedPuzzle = allProblemData.find(
        puzzle => Number(puzzle.id) === Number(puzzleId)
    );

    if (!selectedPuzzle) {
        alert('選択された問題が見つかりませんでした。');
        showScreen('home');
        return;
    }

    currentMode = mode;
    isCountryMode = mode === 'country';
    isCreationPlay = false;
    currentDictionary = getDictionaryByMode(mode);

    currentPuzzleIndex = allProblemData.findIndex(
        p => Number(p.id) === Number(selectedPuzzle.id)
    );

    initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
    boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));

    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;

    document.getElementById('current-game-title').textContent = getModeName(mode);
    document.getElementById('problem-number-display').textContent = `第 ${currentPuzzleIndex + 1} 問`;

    const creatorName = selectedPuzzle.creator || '不明';
    document.getElementById('creator-display').textContent = `制作者: ${creatorName}`;

    updateStatusDisplay();
    renderBoard(5);
    showScreen('mainGame');
}

// ----------------------------------------------------
// ゲーム開始
// ----------------------------------------------------
function startGameByMode(mode, isCreation) {
    if (!isValidMode(mode)) {
        alert('無効なモードです。');
        return;
    }

    const allProblemData = allPuzzles[mode].puzzles || [];
    allProblemData.sort((a, b) => Number(a.id) - Number(b.id));

    currentMode = mode;
    isCountryMode = mode === 'country';
    isCreationPlay = isCreation;
    currentDictionary = getDictionaryByMode(mode);

    if (!isCreation) {
        const serverClearedIds = allPuzzles[mode].cleared_ids || [];
        const localClearedIds = getClearedPuzzles(mode);
        const clearedIds = new Set(
            [...serverClearedIds, ...localClearedIds].map(id => Number(id))
        );

        const availablePuzzles = allProblemData.filter(
            puzzle => !clearedIds.has(Number(puzzle.id))
        );

        if (availablePuzzles.length === 0) {
            alert(`🎉 ${getModeName(mode)}のすべての問題をクリアしました！`);
            showScreen('home');
            return;
        }

        const selectedPuzzle = availablePuzzles[0];

        currentPuzzleIndex = allProblemData.findIndex(
            p => Number(p.id) === Number(selectedPuzzle.id)
        );

        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));

        const nextProblemNumber = (playerStats[`${mode}_clears`] || 0) + 1;
        document.getElementById('problem-number-display').textContent = `第 ${nextProblemNumber} 問`;

    } else {
        currentPuzzleIndex = -1;
        document.getElementById('problem-number-display').textContent = '問題制作モード';
    }

    selectedCells = [];
    usedWords = [];
    eraseButton.disabled = true;

    document.getElementById('current-game-title').textContent = getModeName(mode);

    let creatorName = '銀の焼き鳥';

    if (isCreation) {
        creatorName = currentPlayerNickname;
    } else if (currentPuzzleIndex !== -1) {
        creatorName = allProblemData[currentPuzzleIndex].creator || '不明';
    }

    document.getElementById('creator-display').textContent = `制作者: ${creatorName}`;

    updateStatusDisplay();
    renderBoard(5);
    showScreen('mainGame');
}

// 既存互換用
function startGame(isCountry, isCreation) {
    startGameByMode(isCountry ? 'country' : 'capital', isCreation);
}

// ----------------------------------------------------
// 盤面描画
// ----------------------------------------------------
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

            const isSelected = selectedCells.some(
                coord => coord[0] === r && coord[1] === c
            );

            if (isSelected) {
                cell.classList.add('selected');
            }

            boardElement.appendChild(cell);
        }
    }
}

function updateStatusDisplay() {
    document.getElementById('used-words-display').textContent =
        usedWords.join(', ') || 'なし';
}

// ----------------------------------------------------
// スコア更新・問題登録・クリア判定
// ----------------------------------------------------
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
                mode,
                puzzleId
            })
        });

        if (!response.ok) {
            throw new Error('スコア更新サーバーエラー');
        }

        const data = await response.json();
        playerStats[`${mode}_clears`] = data.newScore;

    } catch (error) {
        console.error('スコア更新に失敗しました。', error);
    }
}

async function submitNewPuzzle(mode, boardData, creator) {
    try {
        const response = await fetch(`${API_BASE_URL}/puzzles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                boardData,
                creator
            })
        });

        if (!response.ok) {
            throw new Error('問題登録サーバーエラー');
        }

        const data = await response.json();

        alert(
            `🎉 問題の登録に成功しました！\n制作者：${data.puzzle.creator}\nこの問題は今後、標準問題として出題されます。`
        );

        await loadPuzzlesAndWords();

    } catch (error) {
        console.error('問題登録に失敗しました。', error);
        alert('問題の登録に失敗しました。サーバーが起動しているか、API_BASE_URLが正しいか確認してください。');
    }
}

async function checkGameStatus() {
    const totalChars = boardData.flat().filter(char => char !== '').length;

    if (totalChars !== 0) {
        return;
    }

    const mode = currentMode;
    const modeName = getShortModeName(mode);

    if (!isCreationPlay) {
        const problemDataList = allPuzzles[mode].puzzles || [];

        const currentPuzzle = problemDataList.find(
            p => JSON.stringify(p.data) === JSON.stringify(initialPlayData)
        );

        if (currentPuzzle && currentPuzzle.id) {
            markPuzzleAsCleared(mode, currentPuzzle.id);

            if (currentPlayerId) {
                await updatePlayerScore(mode, currentPuzzle.id);
            } else {
                playerStats[`${mode}_clears`] = (playerStats[`${mode}_clears`] || 0) + 1;
            }
        }

        const latestClearedCount = playerStats[`${mode}_clears`] || 0;

        alert(
            `🎉 全ての文字を消去しました！クリアです！\nあなたの${modeName}クリア数は${latestClearedCount}問になりました。`
        );

        await loadPuzzlesAndWords();
        showScreen('home');

    } else {
        const registrationConfirmed = confirm(
            '🎉 作成した問題をクリアしました！\nこの問題を標準問題として登録しますか？'
        );

        if (registrationConfirmed) {
            const finalBoard = JSON.parse(JSON.stringify(initialPlayData));
            await submitNewPuzzle(mode, finalBoard, currentPlayerNickname);
            showScreen('home');
        } else {
            alert('問題の登録をスキップしました。作成画面に戻ります。');

            showScreen('create');
            renderCreateBoard();
            fillCreateBoard(initialPlayData);

            btnInputComplete.disabled = false;
            document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';

            const creationModeSelect = document.getElementById('creation-mode-select');
            if (creationModeSelect) {
                creationModeSelect.value = mode;
            }
        }
    }
}

// ----------------------------------------------------
// 3. ゲームロジックの中核
// ----------------------------------------------------
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

        const index = selectedCells.findIndex(
            coord => coord[0] === r && coord[1] === c
        );

        if (index > -1) {
            selectedCells.splice(index + 1);
        } else if (isHorizontal || isVertical) {
            let shouldAdd = false;

            if (selectedCells.length === 1) {
                shouldAdd = true;
            } else {
                const [firstR, firstC] = selectedCells[0];

                const isCurrentPatternHorizontal = selectedCells.every(
                    coord => coord[0] === firstR
                );

                const isCurrentPatternVertical = selectedCells.every(
                    coord => coord[1] === firstC
                );

                if (isCurrentPatternHorizontal) {
                    if (r === firstR && isHorizontal) {
                        shouldAdd = true;
                    }
                } else if (isCurrentPatternVertical) {
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
        } else {
            selectedCells = [[r, c]];
        }
    }

    eraseButton.disabled = selectedCells.length < 2;
    renderBoard(5);
}

eraseButton.addEventListener('click', async () => {
    if (selectedCells.length < 2) return;

    let sortedSelectedCells = [...selectedCells];

    const [firstR] = selectedCells[0];
    const isHorizontal = selectedCells.every(coord => coord[0] === firstR);

    if (isHorizontal) {
        sortedSelectedCells.sort((a, b) => a[1] - b[1]);
    } else {
        sortedSelectedCells.sort((a, b) => a[0] - b[0]);
    }

    const selectedWordChars = sortedSelectedCells.map(([r, c]) => boardData[r][c]);
    const selectedWord = selectedWordChars.join('');

    let finalWord = '';

    const modeLabel = getShortModeName(currentMode);

    if (selectedWord.includes('F')) {
        const tempWordChars = [...selectedWordChars];
        const fIndices = [];

        selectedWordChars.forEach((char, index) => {
            if (char === 'F') {
                fIndices.push(index);
            }
        });

        for (const index of fIndices) {
            const promptText = `「${selectedWord}」のうち、${index + 1}文字目（F）を何にしますか？`;
            const input = prompt(promptText);

            if (input && input.trim() !== '') {
                const inputChar = toKatakana(input).toUpperCase().slice(0, 1);

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
        alert(`「${finalWord}」は有効な${modeLabel}ではありません。`);
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
        renderCreateBoard();
        fillCreateBoard(initialPlayData);

        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent = '入力完了！解答を開始できます。';

    } else if (currentPuzzleIndex !== -1) {
        const problemDataList = allPuzzles[currentMode].puzzles || [];
        const selectedPuzzle = problemDataList[currentPuzzleIndex];

        if (!selectedPuzzle) return;

        initialPlayData = JSON.parse(JSON.stringify(selectedPuzzle.data));
        boardData = JSON.parse(JSON.stringify(selectedPuzzle.data));

        selectedCells = [];
        usedWords = [];
        eraseButton.disabled = true;

        renderBoard(5);
        updateStatusDisplay();
    }
});

// ----------------------------------------------------
// 4. 問題制作モード
// ----------------------------------------------------
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

            input.addEventListener('compositionstart', () => {
                isComposing = true;
            });

            input.addEventListener('compositionend', (e) => {
                isComposing = false;
                checkCreationInput(e);
            });

            input.addEventListener('input', (e) => {
                if (!isComposing) {
                    checkCreationInput(e);
                }
            });

            input.addEventListener('blur', (e) => {
                isComposing = false;
                checkCreationInput(e);
            });

            cell.appendChild(input);
            createBoardElement.appendChild(cell);
        }
    }

    const creationModeSelect = document.getElementById('creation-mode-select');
    if (creationModeSelect && !creationModeSelect.value) {
        creationModeSelect.value = 'country';
    }
}

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

    checkCreationInput();
}

function checkCreationInput(event) {
    if (event && event.target) {
        const input = event.target;
        let value = input.value;

        if (event.type === 'compositionend' || event.type === 'blur' || !isComposing) {
            value = value.toUpperCase();
            value = toKatakana(value);

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
        document.getElementById('create-status').textContent =
            `残り${40 - filledCount}マスに入力が必要です。`;
    }
}

btnInputComplete.addEventListener('click', () => {
    const inputs = document.querySelectorAll('.create-input');
    const newBoard = Array(8).fill(0).map(() => Array(5).fill(''));

    inputs.forEach(input => {
        const r = parseInt(input.dataset.r);
        const c = parseInt(input.dataset.c);

        newBoard[r][c] = input.value;
    });

    const modeSelect = document.getElementById('creation-mode-select');
    const mode = modeSelect ? modeSelect.value : 'country';

    initialPlayData = JSON.parse(JSON.stringify(newBoard));
    boardData = JSON.parse(JSON.stringify(newBoard));

    startGameByMode(mode, true);
});

// ----------------------------------------------------
// 5. ランキング
// ----------------------------------------------------
const rankingTabs = document.getElementById('ranking-tabs');

async function fetchAndDisplayRanking(type) {
    const container = document.getElementById('ranking-list-container');

    container.innerHTML = `<div>${type}ランキングをサーバーから取得中...</div>`;

    const totalScore =
        (playerStats.country_clears || 0) +
        (playerStats.capital_clears || 0) +
        (playerStats.pokemon_clears || 0);

    document.getElementById('ranking-nickname-display').innerHTML =
        `あなたの記録: <strong>${currentPlayerNickname}</strong> ` +
        `(国名: ${playerStats.country_clears || 0}, ` +
        `首都名: ${playerStats.capital_clears || 0}, ` +
        `ポケモン: ${playerStats.pokemon_clears || 0}, ` +
        `合計: ${totalScore})`;

    try {
        const response = await fetch(`${API_BASE_URL}/rankings/${type}`);

        if (!response.ok) {
            throw new Error('ランキング取得サーバーエラー');
        }

        const rankings = await response.json();

        let title = '総合';

        if (type === 'country') title = '国名';
        if (type === 'capital') title = '首都名';
        if (type === 'pokemon') title = 'ポケモン';

        let html = `<h3>${title}ランキング</h3>`;
        html += `<table class="ranking-table"><tr><th>順位</th><th>ニックネーム</th><th>クリア数</th></tr>`;

        rankings.forEach(item => {
            const isCurrentPlayer = item.nickname === currentPlayerNickname;

            html += `
                <tr style="${isCurrentPlayer ? 'background-color: #554400; font-weight: bold; color:#FFD700;' : ''}">
                    <td>${item.rank}</td>
                    <td>${item.nickname}</td>
                    <td>${item.score}</td>
                </tr>
            `;
        });

        html += '</table>';

        container.innerHTML = html;

    } catch (error) {
        console.error('ランキング取得に失敗しました。', error);

        container.innerHTML =
            `<p style="color:red;">ランキング取得エラー: サーバーが起動しているか、ネットワーク接続を確認してください。</p>`;
    }
}

// ----------------------------------------------------
// 5.5. ワードリスト表示
// ----------------------------------------------------
function displayWordList(type) {
    const dictionary = getDictionaryByMode(type);

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

    const sortedDictionary = [...dictionary].sort((a, b) => {
        if (a.length !== b.length) {
            return a.length - b.length;
        }

        return a.localeCompare(b);
    });

    sortedDictionary.forEach(word => {
        const item = document.createElement('div');
        item.classList.add('word-item');
        item.textContent = word;
        wordListContent.appendChild(item);
    });
}

// ----------------------------------------------------
// 6. イベントリスナー
// ----------------------------------------------------
function enforceMaxLength(elementId, maxLength) {
    const inputElement = document.getElementById(elementId);

    if (inputElement) {
        inputElement.addEventListener('input', function () {
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
        currentPlayerNickname = 'ゲスト';
        currentPlayerId = null;

        localStorage.removeItem('player_id');
        localStorage.removeItem('keshimasu_nickname');

        playerStats.country_clears = getClearedPuzzles('country').length;
        playerStats.capital_clears = getClearedPuzzles('capital').length;
        playerStats.pokemon_clears = getClearedPuzzles('pokemon').length;

        alert('ゲストとしてゲームを開始します。スコアはランキングに保存されません。');

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

// ホーム画面
document.getElementById('btn-country-mode').addEventListener('click', () => {
    showPuzzleListByMode('country');
});

document.getElementById('btn-capital-mode').addEventListener('click', () => {
    showPuzzleListByMode('capital');
});

const btnPokemonMode = document.getElementById('btn-pokemon-mode');
if (btnPokemonMode) {
    btnPokemonMode.addEventListener('click', () => {
        showPuzzleListByMode('pokemon');
    });
}

const btnPuzzleListBack = document.getElementById('btn-puzzle-list-back');
if (btnPuzzleListBack) {
    btnPuzzleListBack.addEventListener('click', () => {
        showScreen('home');
    });
}

document.getElementById('btn-create-mode').addEventListener('click', () => {
    if (!currentPlayerNickname || currentPlayerNickname === 'ゲスト') {
        alert('問題制作モードを利用するには、ログインしてください。');
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

if (rankingTabs) {
    rankingTabs.addEventListener('click', (event) => {
        if (event.target.tagName === 'BUTTON') {
            fetchAndDisplayRanking(event.target.dataset.type);
        }
    });
}

// ワードリスト
document.getElementById('btn-word-list').addEventListener('click', () => {
    showScreen('wordList');
    displayWordList('country');
});

if (wordListTabs) {
    wordListTabs.addEventListener('click', (event) => {
        if (event.target.tagName === 'BUTTON') {
            displayWordList(event.target.dataset.type);
        }
    });
}

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

// ----------------------------------------------------
// 7. 初期化
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    enforceMaxLength('nickname-input', 20);
});

setupPlayer();

