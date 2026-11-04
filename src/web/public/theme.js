(function () {
  var KEY = 'voicey-theme';
  var COLORS = { dark: '#1e1f22', blue: '#4641D9' };
  function read() { try { return localStorage.getItem(KEY) === 'blue' ? 'blue' : 'dark'; } catch (e) { return 'dark'; } }
  function apply(t) {
    if (t === 'blue') document.documentElement.setAttribute('data-theme', 'blue');
    else document.documentElement.removeAttribute('data-theme');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', COLORS[t]);
  }
  window.VoiceyTheme = {
    get: function () { return document.documentElement.getAttribute('data-theme') === 'blue' ? 'blue' : 'dark'; },
    set: function (t) { t = t === 'blue' ? 'blue' : 'dark'; apply(t); try { localStorage.setItem(KEY, t); } catch (e) {} },
  };
  apply(read());
  document.addEventListener('DOMContentLoaded', function () { apply(read()); });
})()