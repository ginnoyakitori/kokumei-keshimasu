// 表示テーマ（ダーク / ライト / 端末に合わせる）
// <head> で同期的に読み込み、最初の描画前に data-theme を決めて、ちらつきを防ぐ。
// 保存値: localStorage "keshimasu_theme_v1" = "dark" | "light" | "auto"（未設定は端末に合わせる）
(function () {
    var KEY = 'keshimasu_theme_v1';
    var root = document.documentElement;
    var query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    var listeners = [];

    function read() {
        try {
            var value = localStorage.getItem(KEY);
            if (value === 'light' || value === 'dark' || value === 'auto') return value;
        } catch (e) { /* 読めなければ既定値 */ }
        return 'auto';
    }

    var preference = read();

    function effective() {
        if (preference === 'auto') return query && query.matches ? 'light' : 'dark';
        return preference;
    }

    function apply() {
        var theme = effective();
        root.setAttribute('data-theme', theme);
        root.setAttribute('data-theme-pref', preference);

        var themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.setAttribute('content', theme === 'light' ? '#6fc0ff' : '#0a1230');

        var scheme = document.querySelector('meta[name="color-scheme"]');
        if (scheme) scheme.setAttribute('content', theme);

        listeners.forEach(function (fn) { try { fn(preference, theme); } catch (e) { /* 無視 */ } });
    }

    function onSystemChange() { if (preference === 'auto') apply(); }

    if (query) {
        if (query.addEventListener) query.addEventListener('change', onSystemChange);
        else if (query.addListener) query.addListener(onSystemChange);
    }

    window.KeshiTheme = {
        get: function () { return preference; },
        effective: effective,
        set: function (value) {
            if (value !== 'light' && value !== 'dark' && value !== 'auto') return;
            preference = value;
            try { localStorage.setItem(KEY, value); } catch (e) { /* 保存できなくても今回は有効 */ }
            apply();
        },
        onChange: function (fn) { listeners.push(fn); }
    };

    apply();
})();
