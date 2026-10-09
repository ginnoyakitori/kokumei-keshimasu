// keshimasu-client/script.js
// 国名ケシマス----// 国名ケシマス + 首都名ケシマス + ポケモンケシマス 統合版
// API URL
// ----------------------------------------------------
const API_BASE_URL = '/api';

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

// ワード判定を高速にするための Set（配列と同じ内容）
const DICT_SETS = {
    country: new Set(),
    capital: new Set(),
    pokemon: new Set()
};

let boardData = [];
let initialPlayData = [];
let selectedCells = [];
let usedWords = [];

let isCountryMode = true; // 既存互換用
let currentMode = 'country';

let isCreationPlay = false;
let currentDictionary = new Set(); // 判定用（Set）。一覧表示には COUNTRY_DICT などの配列を使う
let currentPuzzleIndex = -1;
let currentPuzzleId = null; // 現在プレイ中の問題ID（作問モードではnull）
let currentListMode = 'country';

// IME入力中かどうかを判定するフラグ（作問モード用）
let isComposing = false;

let currentPlayerNickname = null;
let isGuestPlayer = false; // ゲストとしてプレイ中か（ニックネームの文字列では判定しない）
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

/**
 * HTMLへ埋め込む文字列を安全化する
 * サーバーや利用者から取得した文字列をinnerHTMLへ入れる前に使用する
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function toKatakana(str) {
    return str.replace(/[\u3041-\u3096]/g, function (match) {
        const chr = match.charCodeAt(0) + 0x60;
        return String.fromCharCode(chr);
    });
}

// ポケモンモードのみで使える文字
// ニドラン♂、ニドラン♀、ポリゴンZ、ポリゴン2、「・」を含む名前等に対応
const POKEMON_ONLY_CHARS = ['♂', '♀', 'Z', '2', '・'];

// mode: 'country' | 'capital' | 'pokemon'
// ※サーバー(server.js)の isValidBoardCharacter と同じ条件にしておくこと
function isValidGameChar(char, mode) {
    if (char === 'F') return true;

    if (POKEMON_ONLY_CHARS.includes(char)) {
        return mode === 'pokemon';
    }

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

function getDictionarySetByMode(mode) {
    return DICT_SETS[mode] || new Set();
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
// 辞書は内容が変わらないので、一度取得したら再取得しない
async function loadDictionariesOnce() {
    const alreadyLoaded =
        COUNTRY_DICT.length > 0 &&
        CAPITAL_DICT.length > 0 &&
        POKEMON_DICT.length > 0;

    if (alreadyLoaded) {
        return;
    }

    const responses = await Promise.all(
        ['country', 'capital', 'pokemon'].map(mode =>
            fetch(
                `${API_BASE_URL}/words/${mode}`,
                {
                    credentials: 'same-origin'
                }
            )
        )
    );

    if (responses.some(response => !response.ok)) {
        throw new Error('辞書リストの取得に失敗しました。');
    }

    const [country, capital, pokemon] = await Promise.all(
        responses.map(response => response.json())
    );

    COUNTRY_DICT = country;
    CAPITAL_DICT = capital;
    POKEMON_DICT = pokemon;

    // 判定用のSetを作る（includes の線形探索をやめる）
    DICT_SETS.country = new Set(country);
    DICT_SETS.capital = new Set(capital);
    DICT_SETS.pokemon = new Set(pokemon);
}

async function loadPuzzlesAndWords() {
    const modeList = [
        'country',
        'capital',
        'pokemon'
    ];

    try {
        const puzzleResults = await Promise.all(
            modeList.map(async mode => {
                const response = await fetch(
                    `${API_BASE_URL}/puzzles/${mode}`,
                    {
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json'
                        }
                    }
                );

                if (!response.ok) {
                    throw new Error(
                        `${mode}問題リストの取得に失敗しました。`
                    );
                }

                return {
                    mode,
                    data: await response.json()
                };
            })
        );

        for (const { mode, data } of puzzleResults) {
            allPuzzles[mode] = data;

            if (
                data.player_identified &&
                currentPlayerId
            ) {
                localStorage.setItem(
                    `cleared_puzzles_${mode}_id_${currentPlayerId}`,
                    JSON.stringify(
                        data.cleared_ids || []
                    )
                );
            }
        }

        await loadDictionariesOnce();

        updateHomeProblemCount();
    } catch (error) {
        console.error(
            '問題または辞書の読み込みに失敗しました。',
            {
                name: error.name
            }
        );

        alert(
            '問題データを読み込めませんでした。時間を空けて再試行してください。'
        );
    }
}
async function getCurrentPlayer() {
    try {
        const response = await fetch(
            `${API_BASE_URL}/player/me`,
            {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json'
                }
            }
        );

        if (response.status === 401) {
            return null;
        }

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(
                data?.message ||
                'プレイヤー情報を取得できませんでした。'
            );
        }

        if (!data?.player) {
            throw new Error(
                'プレイヤー情報の形式が正しくありません。'
            );
        }

        setPlayerSession(data.player);

        const player = data.player;

        if (Array.isArray(player.cleared_country_ids)) {
            localStorage.setItem(
                `cleared_puzzles_country_id_${currentPlayerId}`,
                JSON.stringify(player.cleared_country_ids)
            );
        }

        if (Array.isArray(player.cleared_capital_ids)) {
            localStorage.setItem(
                `cleared_puzzles_capital_id_${currentPlayerId}`,
                JSON.stringify(player.cleared_capital_ids)
            );
        }

        if (Array.isArray(player.cleared_pokemon_ids)) {
            localStorage.setItem(
                `cleared_puzzles_pokemon_id_${currentPlayerId}`,
                JSON.stringify(player.cleared_pokemon_ids)
            );
        }

        return player;
    } catch (error) {
        console.error(
            'プレイヤー情報の取得に失敗しました。',
            {
                name: error.name
            }
        );

        return null;
    }
}

function setPlayerSession(playerData) {
    if (!playerData || !playerData.id || !playerData.nickname) {
        throw new Error('プレイヤー情報の形式が正しくありません。');
    }

    currentPlayerNickname = String(playerData.nickname);
    isGuestPlayer = false;
    currentPlayerId = Number(playerData.id);

    playerStats.country_clears =
        Number(playerData.country_clears) || 0;

    playerStats.capital_clears =
        Number(playerData.capital_clears) || 0;

    playerStats.pokemon_clears =
        Number(playerData.pokemon_clears) || 0;
}

// ログイン済みかどうか（サーバーのセッションに対応したプレイヤーIDがあるか）
function isLoggedIn() {
    return currentPlayerId !== null && !isGuestPlayer;
}

function clearLocalPlayerState() {
    currentPlayerId = null;
    currentPlayerNickname = null;
    isGuestPlayer = false;

    playerStats = {
        country_clears: 0,
        capital_clears: 0,
        pokemon_clears: 0
    };

    // 旧バージョンで保存された認証関連データも削除
    localStorage.removeItem('player_id');
    localStorage.removeItem('keshimasu_nickname');

    if (inputNickname) {
        inputNickname.value = '';
    }

    if (inputPasscode) {
        inputPasscode.value = '';
    }

    if (welcomeMessage) {
        welcomeMessage.textContent = '';
    }
}

async function attemptLogin(nickname, passcode) {
    const finalName =
        typeof nickname === 'string'
            ? nickname.trim()
            : '';

    if (!finalName || typeof passcode !== 'string' || !passcode) {
        alert(
            'ニックネームとパスコードの両方を入力してください。'
        );

        return false;
    }

    if ([...finalName].length > 20) {
        alert('ニックネームは20文字以内で入力してください。');
        return false;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/player/login`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({
                    nickname: finalName,
                    passcode
                })
            }
        );

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            alert(
                data?.message ||
                'ログインに失敗しました。'
            );

            inputPasscode.value = '';
            return false;
        }

        if (!data?.player) {
            alert('プレイヤー情報を取得できませんでした。');
            return false;
        }

        setPlayerSession(data.player);
        inputPasscode.value = '';

        await loadPuzzlesAndWords();

        alert(
            `${currentPlayerNickname}さん、ログインしました。`
        );

        showScreen('home');
        return true;
    } catch (error) {
        console.error(
            'ログイン処理に失敗しました。',
            {
                name: error.name
            }
        );

        alert(
            'ネットワークエラーによりログインできませんでした。'
        );

        return false;
    }
}
async function attemptRegister(nickname, passcode) {
    const finalName =
        typeof nickname === 'string'
            ? nickname.trim()
            : '';

    if (!finalName || typeof passcode !== 'string' || !passcode) {
        alert(
            'ニックネームとパスコードの両方を入力してください。'
        );

        return false;
    }

    if ([...finalName].length > 20) {
        alert('ニックネームは20文字以内で入力してください。');
        return false;
    }

    if (passcode.length < 8 || passcode.length > 72) {
        alert(
            'パスコードは8文字以上72文字以内で入力してください。'
        );

        return false;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/player/register`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({
                    nickname: finalName,
                    passcode
                })
            }
        );

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            alert(
                data?.message ||
                '新規登録に失敗しました。'
            );

            inputPasscode.value = '';
            return false;
        }

        if (!data?.player) {
            alert('プレイヤー情報を取得できませんでした。');
            return false;
        }

        setPlayerSession(data.player);
        inputPasscode.value = '';

        await loadPuzzlesAndWords();

        alert(
            `${currentPlayerNickname}さん、新規登録しました。`
        );

        showScreen('home');
        return true;
    } catch (error) {
        console.error(
            '新規登録処理に失敗しました。',
            {
                name: error.name
            }
        );

        alert(
            'ネットワークエラーにより新規登録できませんでした。'
        );

        return false;
    }
}

async function setupPlayer() {
    currentPlayerId = null;
    currentPlayerNickname = null;

    playerStats = {
        country_clears: 0,
        capital_clears: 0,
        pokemon_clears: 0
    };

    try {
        const player = await getCurrentPlayer();

        if (player) {
            await loadPuzzlesAndWords();
            showScreen('home');
            return;
        }
    } catch (error) {
        console.error(
            'ログイン状態の確認に失敗しました。',
            {
                name: error.name
            }
        );
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

        if (isLoggedIn() && currentPlayerNickname) {
            welcomeMessage.textContent = `${currentPlayerNickname}さん、ようこそ！`;
        } else if (isGuestPlayer) {
            welcomeMessage.textContent = 'ゲストとしてプレイ中です（スコアは保存されません）';
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

    const creator = escapeHtml(
        puzzle.creator || '不明'
    );

    const clearCount = Number(
        puzzle.clear_count ??
        puzzle.clearCount ??
        puzzle.cleared_count ??
        0
    ) || 0;

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

    const allProblemData = [
    ...(allPuzzles[mode].puzzles || [])
].sort(
    (a, b) => Number(a.id) - Number(b.id)
);
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
    currentDictionary = getDictionarySetByMode(mode);

    currentPuzzleIndex = allProblemData.findIndex(
        p => Number(p.id) === Number(selectedPuzzle.id)
    );

    currentPuzzleId = Number(selectedPuzzle.id);

    // 浮いている文字がある盤面は、開始時に下へ落とす
    initialPlayData = dropBoardLetters(selectedPuzzle.data);
    boardData = JSON.parse(JSON.stringify(initialPlayData));

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

    const allProblemData = [
    ...(allPuzzles[mode].puzzles || [])
].sort(
    (a, b) => Number(a.id) - Number(b.id)
);
    currentMode = mode;
    isCountryMode = mode === 'country';
    isCreationPlay = isCreation;
    currentDictionary = getDictionarySetByMode(mode);

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

        currentPuzzleId = Number(selectedPuzzle.id);

        // 浮いている文字がある盤面は、開始時に下へ落とす
        initialPlayData = dropBoardLetters(selectedPuzzle.data);
        boardData = JSON.parse(JSON.stringify(initialPlayData));

        const nextProblemNumber = (playerStats[`${mode}_clears`] || 0) + 1;
        document.getElementById('problem-number-display').textContent = `第 ${nextProblemNumber} 問`;

    } else {
        currentPuzzleIndex = -1;
        currentPuzzleId = null;
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
    if (
        !isLoggedIn() ||
        isCreationPlay
    ) {
        return false;
    }

    if (!isValidMode(mode)) {
        return false;
    }

    const numericPuzzleId = Number(puzzleId);

    if (
        !Number.isSafeInteger(numericPuzzleId) ||
        numericPuzzleId <= 0
    ) {
        return false;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/score/update`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({
                    mode,
                    puzzleId: numericPuzzleId
                })
            }
        );

        const data = await response.json().catch(() => null);

        if (response.status === 401) {
             clearLocalPlayerState();

            alert(
                'ログインの有効期限が切れました。再度ログインしてください。'
            );

            showScreen('auth');
            return false;
        }

        if (!response.ok) {
            throw new Error(
                data?.message ||
                'スコアを更新できませんでした。'
            );
        }

        playerStats[`${mode}_clears`] =
            Number(data.newScore) || 0;

        return true;
    } catch (error) {
        console.error(
            'スコア更新に失敗しました。',
            {
                name: error.name
            }
        );

        return false;
    }
}

async function submitNewPuzzle(mode, newBoardData) {
    if (
        !isLoggedIn() ||
        !currentPlayerNickname
    ) {
        alert('問題を登録するにはログインが必要です。');
        showScreen('auth');
        return false;
    }

    if (!isValidMode(mode)) {
        alert('無効なモードです。');
        return false;
    }

    if (
        !Array.isArray(newBoardData) ||
        newBoardData.length !== 8 ||
        !newBoardData.every(
            row =>
                Array.isArray(row) &&
                row.length === 5 &&
                row.every(
                    cell =>
                        typeof cell === 'string' &&
                        [...cell].length <= 1
                )
        )
    ) {
        alert('盤面データの形式が正しくありません。');
        return false;
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/puzzles`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({
                    mode,
                    boardData: newBoardData
                })
            }
        );

        const data = await response.json().catch(() => null);

        if (response.status === 401) {
            clearLocalPlayerState();

            alert(
                'ログインの有効期限が切れました。再度ログインしてください。'
            );

            showScreen('auth');
            return false;
        }

        if (!response.ok) {
            alert(
                data?.message ||
                '問題を登録できませんでした。'
            );

            return false;
        }

        const creatorName =
            data?.puzzle?.creator || currentPlayerNickname;

        alert(
            `問題を登録しました。\n` +
            `制作者: ${creatorName}\n` +
            'この問題は今後、標準問題として出題されます。'
        );

        await loadPuzzlesAndWords();
        return true;
    } catch (error) {
        console.error('問題登録に失敗しました。', {
            name: error.name
        });

        alert(
            'ネットワークエラーにより問題を登録できませんでした。'
        );

        return false;
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
        // 盤面の内容ではなく、プレイ開始時に保持した問題IDでクリアを記録する
        if (currentPuzzleId) {
            markPuzzleAsCleared(mode, currentPuzzleId);

            if (currentPlayerId) {
                await updatePlayerScore(mode, currentPuzzleId);
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
            const registered = await submitNewPuzzle(
    mode,
    finalBoard
);

if (registered) {
    showScreen('home');
}
        } else {
            alert('問題の登録をスキップしました。作成画面に戻ります。');

            showScreen('create');
            renderCreateBoard();

            // 判定モードを先に戻してから盤面を復元する
            // （順序が逆だと、ポケモン専用文字が「使えない文字」として消えてしまう）
            const creationModeSelect = document.getElementById('creation-mode-select');
            if (creationModeSelect) {
                creationModeSelect.value = mode;
            }

            fillCreateBoard(initialPlayData);
        }
    }
}

// ----------------------------------------------------
// 3. ゲームロジックの中核
// ----------------------------------------------------
// 空マスの上に浮いた文字を下へ落とした新しい盤面を返す（元の盤面は変更しない）
// ※サーバー(server.js)の dropBoardLetters と同じ処理にしておくこと
function dropBoardLetters(board) {
    const rowCount = board.length;
    const result = board.map(row => [...row]);
    const columnCount = rowCount > 0 ? board[0].length : 0;

    for (let c = 0; c < columnCount; c++) {
        const letters = [];

        for (let r = rowCount - 1; r >= 0; r--) {
            if (board[r][c] !== '') {
                letters.push(board[r][c]);
            }
        }

        for (let r = rowCount - 1; r >= 0; r--) {
            result[r][c] = letters[rowCount - 1 - r] ?? '';
        }
    }

    return result;
}

function applyGravity() {
    boardData = dropBoardLetters(boardData);
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

                if (!isValidGameChar(inputChar, currentMode)) {
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

    if (!currentDictionary.has(finalWord)) {
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

        // 作問時の判定モードに合わせてから盤面を復元する
        const creationModeSelectOnReset = document.getElementById('creation-mode-select');
        if (creationModeSelectOnReset) {
            creationModeSelectOnReset.value = currentMode;
        }

        fillCreateBoard(initialPlayData);

    } else if (initialPlayData.length > 0) {
        // プレイ開始時に保存した初期盤面へ戻す（問題リストを再検索しない）
        boardData = JSON.parse(JSON.stringify(initialPlayData));

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

function getCreationMode() {
    const modeSelect = document.getElementById('creation-mode-select');
    return modeSelect && isValidMode(modeSelect.value)
        ? modeSelect.value
        : 'country';
}

function checkCreationInput(event) {
    const mode = getCreationMode();

    if (event && event.target) {
        const input = event.target;
        let value = input.value;

        if (event.type === 'compositionend' || event.type === 'blur' || !isComposing) {
            value = value.toUpperCase();
            value = toKatakana(value);

            if (value.length > 0 && !isValidGameChar(value, mode)) {
                value = '';
            }

            input.value = value.slice(0, 1);
        }
    }

    const inputs = document.querySelectorAll('.create-input');
    let filledCount = 0;

    inputs.forEach(input => {
        if (input.value.length === 0) {
            return;
        }

        // 判定モードを切り替えたとき、そのモードで使えない文字は消す
        if (input.value.length === 1 && isValidGameChar(input.value, mode)) {
            filledCount++;
        } else {
            input.value = '';
        }
    });

    if (filledCount >= 1) {
        btnInputComplete.disabled = false;
        document.getElementById('create-status').textContent =
            `入力済み: ${filledCount}マス。解答を開始できます。`;
    } else {
        btnInputComplete.disabled = true;
        document.getElementById('create-status').textContent =
            '1マス以上に入力してください。';
    }
}

// 判定モードを切り替えたら、入力済みの文字を再チェックする
const creationModeSelectElement = document.getElementById('creation-mode-select');

if (creationModeSelectElement) {
    creationModeSelectElement.addEventListener('change', () => {
        checkCreationInput();
    });
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

    // 空マスの上に浮いた文字は下へ落とした状態で開始する
    initialPlayData = dropBoardLetters(newBoard);
    boardData = JSON.parse(JSON.stringify(initialPlayData));

    startGameByMode(mode, true);
});

// ----------------------------------------------------
// 5. ランキング
// ----------------------------------------------------
const rankingTabs = document.getElementById('ranking-tabs');

async function fetchAndDisplayRanking(type) {
    const container = document.getElementById('ranking-list-container');
    const nicknameDisplay = document.getElementById(
        'ranking-nickname-display'
    );

    container.classList.remove('ranking-error');
    container.textContent = `${type}ランキングをサーバーから取得中...`;

    const countryClears = Number(playerStats.country_clears) || 0;
    const capitalClears = Number(playerStats.capital_clears) || 0;
    const pokemonClears = Number(playerStats.pokemon_clears) || 0;

    const totalScore =
        countryClears +
        capitalClears +
        pokemonClears;

    const safeCurrentPlayerNickname = escapeHtml(
        isLoggedIn() ? currentPlayerNickname : 'ゲスト'
    );

    nicknameDisplay.innerHTML =
        `あなたの記録: <strong>${safeCurrentPlayerNickname}</strong> ` +
        `(国名: ${countryClears}, ` +
        `首都名: ${capitalClears}, ` +
        `ポケモン: ${pokemonClears}, ` +
        `合計: ${totalScore})`;

    try {
        const response = await fetch(
            `${API_BASE_URL}/rankings/${encodeURIComponent(type)}`
        );

        if (!response.ok) {
            throw new Error('ランキング取得サーバーエラー');
        }

        const rankings = await response.json();

        if (!Array.isArray(rankings)) {
            throw new Error('ランキングデータの形式が不正です');
        }

        let title = '総合';

        if (type === 'country') {
            title = '国名';
        } else if (type === 'capital') {
            title = '首都名';
        } else if (type === 'pokemon') {
            title = 'ポケモン';
        }

        let html = `<h3>${escapeHtml(title)}ランキング</h3>`;

        html += `
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th>順位</th>
                        <th>ニックネーム</th>
                        <th>クリア数</th>
                    </tr>
                </thead>
                <tbody>
        `;

        rankings.forEach(item => {
            const nickname = String(item.nickname || '名前なし');
            const safeNickname = escapeHtml(nickname);

            const safeRank = Number.isFinite(Number(item.rank))
                ? Number(item.rank)
                : 0;

            const safeScore = Number.isFinite(Number(item.score))
                ? Number(item.score)
                : 0;

            // ゲストはランキングに載らないので、ログイン中のみ自分の行を強調する
            const isCurrentPlayer =
                isLoggedIn() &&
                nickname === currentPlayerNickname;

            html += `
                <tr class="${isCurrentPlayer ? 'current-player-row' : ''}">
                    <td>${safeRank}</td>
                    <td>${safeNickname}</td>
                    <td>${safeScore}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    } catch (error) {
        console.error('ランキング取得に失敗しました。', {
            name: error.name
        });

        container.classList.add('ranking-error');
        container.textContent =
            'ランキング取得エラー: サーバーが起動しているか、ネットワーク接続を確認してください。';
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
    inputPasscode.addEventListener(
        'keydown',
        event => {
            if (
                event.key === 'Enter' &&
                !event.isComposing
            ) {
                event.preventDefault();

                attemptLogin(
                    inputNickname.value,
                    inputPasscode.value
                );
            }
        }
    );
}

if (btnGuestPlay) {
    btnGuestPlay.addEventListener(
        'click',
        async () => {
            btnGuestPlay.disabled = true;

            try {
                await fetch(
                    `${API_BASE_URL}/player/logout`,
                    {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json'
                        }
                    }
                );
            } catch (error) {
                console.warn(
                    '既存セッションの終了に失敗しました。',
                    {
                        name: error.name
                    }
                );
            } finally {
                clearLocalPlayerState();

                // ニックネームの文字列ではなく、専用フラグでゲストを判定する
                isGuestPlayer = true;
                currentPlayerNickname = null;
                currentPlayerId = null;

                playerStats.country_clears =
                    getClearedPuzzles('country').length;

                playerStats.capital_clears =
                    getClearedPuzzles('capital').length;

                playerStats.pokemon_clears =
                    getClearedPuzzles('pokemon').length;

                btnGuestPlay.disabled = false;

                alert(
                    'ゲストとしてゲームを開始します。' +
                    'スコアはランキングに保存されません。'
                );

                await loadPuzzlesAndWords();
                showScreen('home');
            }
        }
    );
}
const logoutButton =
    document.getElementById('btn-logout');

if (logoutButton) {
    logoutButton.addEventListener(
        'click',
        async () => {
            logoutButton.disabled = true;

            try {
                await fetch(
                    `${API_BASE_URL}/player/logout`,
                    {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            Accept: 'application/json'
                        }
                    }
                );
            } catch (error) {
                console.error(
                    'ログアウト通信に失敗しました。',
                    {
                        name: error.name
                    }
                );
            } finally {
                clearLocalPlayerState();
                logoutButton.disabled = false;
                showScreen('auth');
            }
        }
    );
}

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
    if (!isLoggedIn()) {
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