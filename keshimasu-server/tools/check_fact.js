// word_facts.json のキーが実際の辞書の表記と一致しているか確認するツール
// 使い方: node tools/check_facts.js
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const load = (name) => {
    const p = path.join(dataDir, name);
    if (!fs.existsSync(p)) { console.log(`(skip) ${name} が見つかりません`); return null; }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const toList = (d) => Array.isArray(d) ? d : (d && Array.isArray(d.words) ? d.words : d ? Object.keys(d) : []);

const facts = load('word_facts.json') || {};
const countries = toList(load('country_words.json'));
const capitals = toList(load('capital_words.json'));
const pokemon = toList(load('pokemon_words.json'));

const countryKeys = Object.keys(facts.country || {});
const dictC = new Set(countries);
const dictCap = new Set(capitals);

if (countries.length) {
    console.log('■ 辞書にあるが豆知識が無い国名:');
    console.log(countries.filter(w => !(w in (facts.country || {}))).join(' / ') || '(なし)');
    console.log('\n■ 豆知識にあるが辞書に無いキー(表記ゆれの可能性):');
    console.log(countryKeys.filter(k => !dictC.has(k)).join(' / ') || '(なし)');
}
if (capitals.length) {
    const caps = countryKeys.map(k => facts.country[k].capital).filter(Boolean);
    console.log('\n■ 辞書にある首都のうち、国の豆知識で使われていないもの:');
    console.log(capitals.filter(w => !caps.includes(w)).join(' / ') || '(なし)');
    console.log('\n■ 豆知識の首都名が辞書に無いもの:');
    console.log(caps.filter(c => !dictCap.has(c)).join(' / ') || '(なし)');
}
if (pokemon.length) {
    const pk = Object.keys(facts.pokemon || {});
    console.log('\n■ ポケモン豆知識のうち辞書に無いキー:', pk.filter(k => !pokemon.includes(k)).join(' / ') || '(なし)');
}