/* Slideshow iCloud — compatível com Safari 12 (ES2017, sem ?. e ??). */
(function () {
  'use strict';

  var CFG = window.SLIDESHOW_CONFIG || {};
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  var EFFECTS = {
    'fade': 'Fade',
    'slide-left': 'Slide ←', 'slide-right': 'Slide →', 'slide-up': 'Slide ↑', 'slide-down': 'Slide ↓',
    'push': 'Push',
    'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out',
    'kenburns': 'Ken Burns',
    'flip-h': 'Flip 3D horizontal', 'flip-v': 'Flip 3D vertical',
    'rotate-zoom': 'Rotate + zoom',
    'curtain': 'Cortina', 'iris': 'Íris',
    'blinds': 'Persianas', 'mosaic': 'Mosaico'
  };

  var DEFAULTS = {
    interval: 12,
    duration: 1.0,
    order: 'random',
    blurBg: true,
    effects: Object.keys(EFFECTS),
    dimStart: '23:30',
    dimEnd: '06:30',
    dimLevel: 0.85,
    reloadHours: 4,
    refreshMinutes: 10
  };

  /* ---------- armazenamento seguro ---------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* cheio ou bloqueado */ } }

  function loadSettings() {
    var s = {};
    var k;
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var saved = JSON.parse(lsGet('slideshow.settings') || '{}');
      for (k in saved) if (k in DEFAULTS) s[k] = saved[k];
    } catch (e) { /* ignora */ }
    // parâmetros na URL têm prioridade (ex.: ?interval=20&effects=fade,iris)
    var q = window.location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < q.length; i++) {
      var p = q[i].split('=');
      var key = decodeURIComponent(p[0] || '');
      if (!(key in DEFAULTS) || p.length < 2) continue;
      var val = decodeURIComponent(p[1]);
      if (key === 'effects') s[key] = val.split(',');
      else if (typeof DEFAULTS[key] === 'number') s[key] = parseFloat(val);
      else if (typeof DEFAULTS[key] === 'boolean') s[key] = val === '1' || val === 'true';
      else s[key] = val;
    }
    s.effects = s.effects.filter(function (e) { return e in EFFECTS; });
    return s;
  }

  var S = loadSettings();

  /* ---------- elementos ---------- */
  var stage = document.getElementById('stage');
  var dimEl = document.getElementById('dim');
  var statusEl = document.getElementById('status');
  var hintEl = document.getElementById('hint');
  var gearEl = document.getElementById('gear');
  var panelEl = document.getElementById('panel');
  var form = document.getElementById('settings');
  var video = document.getElementById('nosleep');

  function setStatus(t) { statusEl.textContent = t || ''; }

  /* diagnóstico na tela: abra a página com ?debug=1 */
  var DEBUG = /[?&]debug=1/.test(window.location.search);
  var logEl = null;
  var t0 = Date.now();
  function log(msg) {
    if (!DEBUG) return;
    if (!logEl) {
      logEl = document.createElement('pre');
      logEl.style.cssText = 'position:fixed;left:0;top:0;right:0;max-height:45%;overflow:hidden;margin:0;' +
        'padding:8px;background:rgba(0,0,0,.75);color:#7f7;font:12px Menlo,monospace;z-index:99;' +
        'white-space:pre-wrap;pointer-events:none';
      document.body.appendChild(logEl);
    }
    var line = ((Date.now() - t0) / 1000).toFixed(1) + 's  ' + msg;
    logEl.textContent = (line + '\n' + logEl.textContent).slice(0, 4000);
  }
  window.onerror = function (m, src, line) { log('ERRO JS: ' + m + ' (' + line + ')'); };
  log('início · ' + navigator.userAgent);

  /* ---------- estado ---------- */
  var photos = [];          // lista atual {id,url,w,h,date}
  var queue = [];           // ids a exibir
  var currentId = null;
  var currentSlide = null;
  var pending = null;       // {photo, img, promise}
  var timer = null;
  var busy = false;
  var paused = false;
  var lastEffect = null;

  /* ---------- utilidades ---------- */
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rand(arr.length)]; }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = rand(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function css(el, props) {
    for (var k in props) {
      var v = props[k];
      if (k === 'transform') { el.style.webkitTransform = v; el.style.transform = v; }
      else if (k === 'clipPath') { el.style.webkitClipPath = v; el.style.clipPath = v; }
      else if (k === 'transition') { el.style.webkitTransition = v; el.style.transition = v; }
      else if (k === 'transformOrigin') { el.style.webkitTransformOrigin = v; el.style.transformOrigin = v; }
      else el.style[k] = v;
    }
  }

  /** Anima transform/opacity/clip-path via transição CSS. Resolve ao terminar. */
  function tween(el, from, to, ms, ease, delay) {
    delay = delay || 0;
    css(el, { transition: 'none' });
    css(el, from);
    void el.offsetWidth; // força reflow para fixar o estado inicial
    var props = 'opacity ' + ms + 'ms ' + ease + ' ' + delay + 'ms, ' +
      '-webkit-transform ' + ms + 'ms ' + ease + ' ' + delay + 'ms, ' +
      'transform ' + ms + 'ms ' + ease + ' ' + delay + 'ms, ' +
      '-webkit-clip-path ' + ms + 'ms ' + ease + ' ' + delay + 'ms, ' +
      'clip-path ' + ms + 'ms ' + ease + ' ' + delay + 'ms';
    css(el, { transition: props });
    css(el, to);
    return wait(ms + delay + 40);
  }

  var EASE = 'cubic-bezier(.4,0,.2,1)';
  var EASE_IN = 'cubic-bezier(.5,0,.9,.5)';
  var EASE_OUT = 'cubic-bezier(.1,.5,.5,1)';

  /* ---------- imagens ---------- */
  function loadImage(photo) {
    var img = new Image();
    var p = new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, 30000);
      img.onload = function () { clearTimeout(t); resolve(img); };
      img.onerror = function () { clearTimeout(t); reject(new Error('erro ao carregar')); };
    });
    img.src = photo.url;
    return { photo: photo, img: img, promise: p };
  }

  function releaseImg(img) {
    if (!img) return;
    img.onload = img.onerror = null;
    img.src = BLANK;
  }

  /**
   * Fundo desfocado barato: reduz a foto a ~16 px num canvas e deixa o navegador
   * ampliar (a ampliação suaviza = desfoque). Sem filter: blur, que pesa no iPad mini 2.
   */
  function makeBlur(src) {
    var W = stage.clientWidth || 1024, H = stage.clientHeight || 768;
    var c = document.createElement('canvas');
    c.className = 'bg';
    try {
      var iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
      if (!iw || !ih) return c;
      // passo 1: reduz para ~128 px (evita serrilhado na redução)
      var mid = document.createElement('canvas');
      mid.width = 128; mid.height = Math.max(1, Math.round(128 * H / W));
      var s1 = Math.max(mid.width / iw, mid.height / ih);
      mid.getContext('2d').drawImage(src, (mid.width - iw * s1) / 2, (mid.height - ih * s1) / 2, iw * s1, ih * s1);
      // passo 2: reduz para 16 px
      var small = document.createElement('canvas');
      small.width = 16; small.height = Math.max(1, Math.round(16 * H / W));
      small.getContext('2d').drawImage(mid, 0, 0, small.width, small.height);
      // passo 3: amplia para 64 px, suavizando, e escurece um pouco
      c.width = 64; c.height = Math.max(1, Math.round(64 * H / W));
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, c.width, c.height);
      mid.width = mid.height = 0;
      small.width = small.height = 0;
    } catch (e) { /* sem fundo, fica preto */ }
    return c;
  }

  function cloneCanvas(src) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    try { c.getContext('2d').drawImage(src, 0, 0); } catch (e) { /* ignora */ }
    return c;
  }

  function makeSlide(url, loaded) {
    var d = document.createElement('div');
    d.className = 'slide';
    if (S.blurBg && loaded) d.appendChild(makeBlur(loaded));
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    d.appendChild(img);
    return d;
  }

  function destroySlide(el) {
    if (!el) return;
    var imgs = el.getElementsByTagName('img');
    for (var i = 0; i < imgs.length; i++) releaseImg(imgs[i]);
    var cvs = el.getElementsByTagName('canvas');
    for (var j = 0; j < cvs.length; j++) { cvs[j].width = 0; cvs[j].height = 0; }
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  /* camada com recortes (persianas/mosaico) da nova imagem */
  function makeTiles(url, cols, rows, bg) {
    var W = stage.clientWidth, H = stage.clientHeight;
    var layer = document.createElement('div');
    layer.className = 'fx-layer';
    var tiles = [];
    var tw = Math.ceil(W / cols), th = Math.ceil(H / rows);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var t = document.createElement('div');
        t.className = 'tile';
        css(t, { left: (c * tw) + 'px', top: (r * th) + 'px', width: tw + 'px', height: th + 'px' });
        if (bg && bg.width) {
          var bc = cloneCanvas(bg);
          bc.className = 'tile-bg';
          css(bc, { left: (-c * tw) + 'px', top: (-r * th) + 'px', width: W + 'px', height: H + 'px' });
          t.appendChild(bc);
        }
        var img = document.createElement('img');
        img.src = url;
        css(img, { left: (-c * tw) + 'px', top: (-r * th) + 'px', width: W + 'px', height: H + 'px' });
        t.appendChild(img);
        layer.appendChild(t);
        tiles.push(t);
      }
    }
    return { layer: layer, tiles: tiles };
  }

  /* ---------- transições ---------- */
  // Cada efeito recebe (velho, novo, ms, url) com o novo já no palco por cima.
  var FX = {
    'fade': function (o, n, d) {
      return tween(n, { opacity: 0 }, { opacity: 1 }, d, 'ease-in-out');
    },
    'slide-left': function (o, n, d) { return slideIn(n, '100%,0', d); },
    'slide-right': function (o, n, d) { return slideIn(n, '-100%,0', d); },
    'slide-up': function (o, n, d) { return slideIn(n, '0,100%', d); },
    'slide-down': function (o, n, d) { return slideIn(n, '0,-100%', d); },
    'push': function (o, n, d) {
      var dirs = [['100%,0', '-100%,0'], ['-100%,0', '100%,0'], ['0,100%', '0,-100%'], ['0,-100%', '0,100%']];
      var dir = pick(dirs);
      var a = o ? tween(o, { transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(' + dir[1] + ',0)' }, d, EASE) : null;
      var b = tween(n, { transform: 'translate3d(' + dir[0] + ',0)' }, { transform: 'translate3d(0,0,0)' }, d, EASE);
      return Promise.all([a, b]);
    },
    'zoom-in': function (o, n, d) {
      return tween(n, { opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }, d, EASE_OUT);
    },
    'zoom-out': function (o, n, d) {
      if (!o) return FX.fade(o, n, d);
      n.style.zIndex = 1; o.style.zIndex = 2;
      return tween(o, { opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.6)' }, d, EASE_IN);
    },
    'kenburns': function (o, n, d) {
      var hold = (S.interval * 1000) + d;
      var s0 = 1 + Math.random() * 0.05, s1 = 1.12 + Math.random() * 0.1;
      var x = (rand(7) - 3) * 1.5, y = (rand(7) - 3) * 1.5;
      var img = n.querySelector('img');
      // a imagem faz o zoom lento; a slide faz o fade
      tween(img, { transform: 'scale(' + s0 + ') translate3d(0,0,0)' },
        { transform: 'scale(' + s1 + ') translate3d(' + x + '%,' + y + '%,0)' }, hold, 'linear');
      return tween(n, { opacity: 0 }, { opacity: 1 }, d, 'ease-in-out');
    },
    'flip-h': function (o, n, d) { return flip(o, n, d, 'rotateY'); },
    'flip-v': function (o, n, d) { return flip(o, n, d, 'rotateX'); },
    'rotate-zoom': function (o, n, d) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      return tween(n, { opacity: 0, transform: 'rotate(' + (dir * 200) + 'deg) scale(0.15)' },
        { opacity: 1, transform: 'rotate(0deg) scale(1)' }, d, EASE_OUT);
    },
    'curtain': function (o, n, d) {
      var from = Math.random() < 0.5 ? 'inset(0% 50% 0% 50%)' : 'inset(50% 0% 50% 0%)';
      return tween(n, { clipPath: from }, { clipPath: 'inset(0% 0% 0% 0%)' }, d, EASE);
    },
    'iris': function (o, n, d) {
      var x = 30 + rand(41), y = 30 + rand(41);
      return tween(n, { clipPath: 'circle(0% at ' + x + '% ' + y + '%)' },
        { clipPath: 'circle(110% at ' + x + '% ' + y + '%)' }, d, EASE_IN);
    },
    'blinds': function (o, n, d, url) {
      var vertical = Math.random() < 0.5;
      var count = 10;
      var bg = n.querySelector('canvas.bg');
      var t = vertical ? makeTiles(url, count, 1, bg) : makeTiles(url, 1, count, bg);
      n.style.opacity = 0;
      stage.appendChild(t.layer);
      var step = d * 0.5 / count;
      var each = d * 0.5;
      var jobs = t.tiles.map(function (tile, i) {
        css(tile, { transformOrigin: vertical ? '0 50%' : '50% 0' });
        return tween(tile, { transform: vertical ? 'scaleX(0.001)' : 'scaleY(0.001)' },
          { transform: 'scale(1,1)' }, each, EASE, i * step);
      });
      return Promise.all(jobs).then(function () {
        n.style.opacity = 1;
        destroySlide(t.layer);
      });
    },
    'mosaic': function (o, n, d, url) {
      var landscape = stage.clientWidth >= stage.clientHeight;
      var t = makeTiles(url, landscape ? 6 : 4, landscape ? 4 : 6, n.querySelector('canvas.bg'));
      n.style.opacity = 0;
      stage.appendChild(t.layer);
      var order = shuffle(t.tiles.map(function (x, i) { return i; }));
      var each = d * 0.45;
      var step = (d - each) / t.tiles.length;
      var jobs = order.map(function (idx, k) {
        return tween(t.tiles[idx], { opacity: 0, transform: 'scale(0.2)' },
          { opacity: 1, transform: 'scale(1)' }, each, EASE_OUT, k * step);
      });
      return Promise.all(jobs).then(function () {
        n.style.opacity = 1;
        destroySlide(t.layer);
      });
    }
  };

  function slideIn(n, from, d) {
    return tween(n, { transform: 'translate3d(' + from + ',0)' }, { transform: 'translate3d(0,0,0)' }, d, EASE);
  }

  function flip(o, n, d, axis) {
    var half = d / 2;
    if (!o) return FX.fade(o, n, d);
    css(n, { transform: axis + '(-90deg)' });
    return tween(o, { transform: axis + '(0deg)' }, { transform: axis + '(90deg)' }, half, EASE_IN)
      .then(function () {
        o.style.opacity = 0;
        return tween(n, { transform: axis + '(-90deg)' }, { transform: axis + '(0deg)' }, half, EASE_OUT);
      });
  }

  function chooseEffect() {
    var list = S.effects.length ? S.effects : ['fade'];
    if (list.length > 1) list = list.filter(function (e) { return e !== lastEffect; });
    lastEffect = pick(list);
    return lastEffect;
  }

  /* ---------- fila de exibição ---------- */
  function rebuildQueue() {
    var ids = photos.map(function (p) { return p.id; });
    if (S.order === 'random') {
      shuffle(ids);
      if (ids.length > 1 && ids[0] === currentId) ids.push(ids.shift());
    } else if (S.order === 'newest') {
      ids = photos.slice().sort(function (a, b) {
        return String(b.date || '').localeCompare(String(a.date || ''));
      }).map(function (p) { return p.id; });
    } else if (currentId) {
      var i = ids.indexOf(currentId);
      if (i >= 0) ids = ids.slice(i + 1).concat(ids.slice(0, i + 1));
    }
    queue = ids;
  }

  function findPhoto(id) {
    for (var i = 0; i < photos.length; i++) if (photos[i].id === id) return photos[i];
    return null;
  }

  function nextPhoto() {
    for (var tries = 0; tries < 2; tries++) {
      while (queue.length) {
        var p = findPhoto(queue.shift());
        if (p) return p;
      }
      rebuildQueue();
    }
    return null;
  }

  /* ---------- ciclo ---------- */
  function preloadNext() {
    if (pending) return;
    var p = nextPhoto();
    if (p) pending = loadImage(p);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(advance, ms);
  }

  function advance() {
    if (paused || busy) { schedule(1000); return; }
    if (!photos.length) { schedule(5000); return; }
    preloadNext();
    var job = pending;
    if (!job) { schedule(5000); return; }
    busy = true;
    job.promise.then(function () {
      log('foto ok ' + job.img.naturalWidth + 'x' + job.img.naturalHeight);
      pending = null;
      return show(job.photo, job.img);
    }, function () {
      // URL expirada ou falha de rede: descarta, atualiza lista e tenta outra
      pending = null;
      log('foto falhou: ' + job.photo.id);
      if (!currentSlide) setStatus('Não consegui carregar a foto. Tentando outra…');
      releaseImg(job.img);
      refreshList();
      busy = false;
      schedule(2000);
      return 'skip';
    }).then(function (r) {
      if (r === 'skip') return;
      busy = false;
      setStatus('');
      preloadNext();
      schedule(S.interval * 1000);
    }).catch(function () {
      busy = false;
      schedule(3000);
    });
  }

  function show(photo, loaderImg) {
    var old = currentSlide;
    var n = makeSlide(photo.url, loaderImg);
    stage.appendChild(n);
    releaseImg(loaderImg); // a <img> do slide já usa a versão em cache
    var effect = old ? chooseEffect() : 'fade';
    var ms = Math.max(300, S.duration * 1000);
    if (effect === 'blinds' || effect === 'mosaic') ms = ms * 1.4;
    currentSlide = n;
    currentId = photo.id;
    var run;
    try { run = FX[effect](old, n, ms, photo.url); } catch (e) { run = FX.fade(old, n, ms); }
    return Promise.resolve(run).then(function () {
      css(n, { transition: 'none', opacity: 1, clipPath: 'none', zIndex: '' });
      if (effect !== 'kenburns') css(n, { transform: 'translate3d(0,0,0)' });
      destroySlide(old);
    });
  }

  /* ---------- lista de fotos ---------- */
  function workerBase() {
    var u = CFG.workerUrl || '';
    return u.charAt(u.length - 1) === '/' ? u : u + '/';
  }

  function applyList(list) {
    if (!list || !list.length) return;
    var base = workerBase();
    list = list.filter(function (p) { return p && p.id && p.c; });
    list.forEach(function (p) {
      p.url = base + 'photo?id=' + encodeURIComponent(p.id) + '&c=' + encodeURIComponent(p.c);
    });
    if (!list.length) return;
    var oldIds = {};
    photos.forEach(function (p) { oldIds[p.id] = true; });
    var hadPhotos = photos.length > 0;
    photos = list;
    var fresh = list.filter(function (p) { return !oldIds[p.id]; }).map(function (p) { return p.id; });
    if (hadPhotos && fresh.length) {
      // fotos novas entram na frente da fila
      queue = fresh.concat(queue.filter(function (id) { return fresh.indexOf(id) === -1; }));
    }
    if (pending && !findPhoto(pending.photo.id)) { releaseImg(pending.img); pending = null; }
  }

  /** GET de JSON via XHR (o Safari 9 / iOS 9 não tem fetch). */
  function getJSON(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var sep = url.indexOf('?') === -1 ? '?' : '&';
      xhr.open('GET', url + sep + '_=' + Date.now(), true); // evita cache do Safari
      xhr.timeout = timeoutMs || 90000;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('HTTP ' + xhr.status)); return; }
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('JSON inválido')); }
      };
      xhr.onerror = function () { reject(new Error('rede/CORS/certificado (status ' + xhr.status + ')')); };
      xhr.ontimeout = function () { reject(new Error('tempo esgotado')); };
      xhr.send();
    });
  }

  var refreshing = false;
  function refreshList() {
    if (refreshing || !CFG.workerUrl) return Promise.resolve();
    refreshing = true;
    log('pedindo lista…');
    return getJSON(CFG.workerUrl).then(function (data) {
      var list = (data && data.photos) || [];
      log('lista recebida: ' + list.length + ' fotos');
      if (list.length && !currentSlide) setStatus('Carregando a primeira foto…');
      if (list.length) {
        applyList(list);
        lsSet('slideshow.lastList', JSON.stringify(list));
      } else if (!photos.length) {
        setStatus('O álbum está vazio.');
      }
    }).catch(function (e) {
      log('lista falhou: ' + (e && e.message || e));
      if (!photos.length) {
        setStatus('Sem conexão. Tentando novamente…');
        setTimeout(refreshList, 15000);
      }
    }).then(function () { refreshing = false; });
  }

  /* ---------- modo quiosque ---------- */
  var noSleepOn = false;
  function enableNoSleep() {
    if (noSleepOn) return;
    var p;
    try { p = video.play(); } catch (e) { p = null; }
    if (p && p.then) {
      p.then(function () { noSleepOn = true; hintEl.className = 'off'; })
        .catch(function () { /* tenta no próximo toque */ });
    } else {
      noSleepOn = true; hintEl.className = 'off';
    }
  }
  // alguns iOS pausam o vídeo; reforça periodicamente
  setInterval(function () { if (noSleepOn && video.paused) { try { video.play(); } catch (e) { /* */ } } }, 30000);

  function minutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
  }
  function updateDim() {
    var a = minutes(S.dimStart), b = minutes(S.dimEnd);
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();
    var on = false;
    if (!isNaN(a) && !isNaN(b) && a !== b) on = a < b ? (m >= a && m < b) : (m >= a || m < b);
    dimEl.style.opacity = on ? String(Math.min(1, Math.max(0, S.dimLevel))) : '0';
  }
  setInterval(updateDim, 30000);

  var reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    if (!(S.reloadHours > 0)) return;
    reloadTimer = setTimeout(function tryReload() {
      if (navigator.onLine === false) { reloadTimer = setTimeout(tryReload, 5 * 60000); return; }
      window.location.reload();
    }, S.reloadHours * 3600000);
  }

  document.addEventListener('visibilitychange', function () {
    paused = document.hidden;
    if (!paused) { refreshList(); schedule(1500); }
  });

  /* ---------- toques e configurações ---------- */
  var gearTimer = null;
  document.addEventListener('touchend', onTap, false);
  document.addEventListener('click', onTap, false);
  function onTap(e) {
    enableNoSleep();
    if (!panelEl.hidden) return;
    if (e.target === gearEl) return;
    gearEl.className = 'show';
    clearTimeout(gearTimer);
    gearTimer = setTimeout(function () { gearEl.className = ''; }, 5000);
  }
  document.addEventListener('touchmove', function (e) {
    if (panelEl.hidden) e.preventDefault();
  }, { passive: false });

  var effBox = document.getElementById('effects');
  Object.keys(EFFECTS).forEach(function (k) {
    var l = document.createElement('label');
    var c = document.createElement('input');
    c.type = 'checkbox'; c.name = 'fx'; c.value = k;
    l.appendChild(c);
    l.appendChild(document.createTextNode(' ' + EFFECTS[k]));
    effBox.appendChild(l);
  });

  function fillForm() {
    form.interval.value = S.interval;
    form.duration.value = S.duration;
    form.order.value = S.order;
    form.blurBg.checked = !!S.blurBg;
    form.dimStart.value = S.dimStart;
    form.dimEnd.value = S.dimEnd;
    form.dimLevel.value = S.dimLevel;
    form.reloadHours.value = S.reloadHours;
    var boxes = form.querySelectorAll('input[name=fx]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = S.effects.indexOf(boxes[i].value) !== -1;
  }
  function setAll(v) {
    var boxes = form.querySelectorAll('input[name=fx]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = v;
  }

  gearEl.addEventListener('click', function (e) {
    e.stopPropagation();
    fillForm();
    panelEl.hidden = false;
    paused = true;
  });
  document.getElementById('btnAll').addEventListener('click', function () { setAll(true); });
  document.getElementById('btnNone').addEventListener('click', function () { setAll(false); });
  document.getElementById('btnReload').addEventListener('click', function () { window.location.reload(); });
  document.getElementById('btnCancel').addEventListener('click', closePanel);

  function closePanel() {
    panelEl.hidden = true;
    gearEl.className = '';
    paused = false;
    schedule(1000);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var fx = [];
    var boxes = form.querySelectorAll('input[name=fx]');
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) fx.push(boxes[i].value);
    var orderChanged = S.order !== form.order.value;
    S.interval = Math.max(3, parseFloat(form.interval.value) || DEFAULTS.interval);
    S.duration = Math.min(5, Math.max(0.3, parseFloat(form.duration.value) || DEFAULTS.duration));
    S.order = form.order.value;
    S.blurBg = form.blurBg.checked;
    S.effects = fx.length ? fx : ['fade'];
    S.dimStart = form.dimStart.value || DEFAULTS.dimStart;
    S.dimEnd = form.dimEnd.value || DEFAULTS.dimEnd;
    S.dimLevel = parseFloat(form.dimLevel.value);
    if (isNaN(S.dimLevel)) S.dimLevel = DEFAULTS.dimLevel;
    S.reloadHours = parseFloat(form.reloadHours.value) || 0;
    lsSet('slideshow.settings', JSON.stringify(S));
    if (orderChanged) {
      if (pending) { releaseImg(pending.img); pending = null; }
      rebuildQueue();
    }
    updateDim();
    scheduleReload();
    closePanel();
  });

  /* ---------- início ---------- */
  function start() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sem SW */ });
    }
    if (!CFG.workerUrl || CFG.workerUrl.indexOf('SEU-SUBDOMINIO') !== -1) {
      setStatus('Configure workerUrl em config.js');
    } else {
      setStatus('Carregando fotos…');
    }
    try {
      var cached = JSON.parse(lsGet('slideshow.lastList') || '[]');
      if (cached.length) applyList(cached);
    } catch (e) { /* ignora */ }

    refreshList().then(function () { schedule(photos.length ? 300 : 5000); });
    setInterval(refreshList, Math.max(1, S.refreshMinutes) * 60000);
    updateDim();
    scheduleReload();
  }

  start();
})();
