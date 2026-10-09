// keshimasu-server/utils/auth.js

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = 10;

/**
 * パスコードをハッシュ化する
 *
 * @param {string} passcode
 * @returns {Promise<string>}
 */
async function hashPasscode(passcode) {
    return bcrypt.hash(passcode, SALT_ROUNDS);
}

/**
 * 入力されたパスコードと保存済みハッシュを比較する
 *
 * @param {string} passcode
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePasscode(passcode, hash) {
    if (
        typeof passcode !== 'string' ||
        typeof hash !== 'string' ||
        !hash
    ) {
        return false;
    }

    return bcrypt.compare(passcode, hash);
}

// ログイン時にニックネームが存在しない場合の「ダミー比較」用ハッシュ
// 存在しないニックネームでも bcrypt の比較時間を発生させ、
// 応答時間の差からアカウントの有無を推測されにくくする
let dummyHashPromise = null;

function getDummyHash() {
    if (!dummyHashPromise) {
        dummyHashPromise = bcrypt.hash(
            crypto.randomBytes(16).toString('hex'),
            SALT_ROUNDS
        );
    }

    return dummyHashPromise;
}

/**
 * 存在しないアカウントに対して、本物の比較と同程度の時間を消費する
 *
 * @param {string} passcode
 * @returns {Promise<void>}
 */
async function consumeDummyComparison(passcode) {
    const input = typeof passcode === 'string' ? passcode : '';

    await bcrypt.compare(input, await getDummyHash());
}

// 起動直後の最初のログインが遅くならないよう、先にハッシュを作っておく
getDummyHash();

/**
 * 推測困難なセッショントークンを生成する
 *
 * @returns {string}
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * セッショントークンをSHA-256でハッシュ化する
 *
 * DBには生のトークンではなく、このハッシュだけを保存する。
 *
 * @param {string} token
 * @returns {string}
 */
function hashSessionToken(token) {
    return crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');
}

/**
 * 二つの文字列をタイミング攻撃に配慮して比較する
 *
 * @param {string} valueA
 * @param {string} valueB
 * @returns {boolean}
 */
function safeEqual(valueA, valueB) {
    const bufferA = Buffer.from(String(valueA));
    const bufferB = Buffer.from(String(valueB));

    if (bufferA.length !== bufferB.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufferA, bufferB);
}

module.exports = {
    hashPasscode,
    comparePasscode,
    consumeDummyComparison,
    generateSessionToken,
    hashSessionToken,
    safeEqual
};