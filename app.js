/* Punch Card — swing day tracker. Everything lives in localStorage on the device. */
(function () {
  'use strict';

  var KEY = 'punchcard.v1';
  var RING = 2 * Math.PI * 52;

  var state = { swings: [], activeId: null };
  var editingId = null;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    main: $('main'), empty: $('empty'), dash: $('dash'),
    swingName: $('swingName'), swingSub: $('swingSub'),
    ringFill: $('ringFill'), doneCount: $('doneCount'), ofCount: $('ofCount'),
    statDone: $('statDone'), statLeft: $('statLeft'), statEnd: $('statEnd'),
    grid: $('grid'), doneBanner: $('doneBanner'), todayBtn: $('todayBtn'),
    backdrop: $('backdrop'), swingsSheet: $('swingsSheet'), editSheet: $('editSheet'),
    dataSheet: $('dataSheet'), swingList: $('swingList'), editSheetTitle: $('editSheetTitle'),
    editForm: $('editForm'), fName: $('fName'), fLength: $('fLength'), fStart: $('fStart'),
    presets: $('presets'), saveBtn: $('saveBtn'), deleteBtn: $('deleteBtn'),
    importFile: $('importFile'), toast: $('toast'), confetti: $('confetti')
  };

  /* ---------------- storage ---------------- */

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.swings)) {
        state.swings = data.swings.map(normalise).filter(Boolean);
        state.activeId = data.activeId || (state.swings[0] && state.swings[0].id) || null;
      }
    } catch (e) { /* corrupt or blocked storage — start fresh */ }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save — device storage is full or blocked');
    }
  }

  function normalise(s) {
    if (!s || typeof s !== 'object') return null;
    var len = clamp(parseInt(s.length, 10) || 14, 1, 90);
    var days = Array.isArray(s.days) ? s.days.slice(0, len).map(Boolean) : [];
    while (days.length < len) days.push(false);
    return {
      id: String(s.id || uid()),
      name: String(s.name || 'Swing').slice(0, 40),
      length: len,
      start: /^\d{4}-\d{2}-\d{2}$/.test(s.start) ? s.start : '',
      days: days,
      created: s.created || Date.now()
    };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /* ---------------- dates ---------------- */

  var DAY_MS = 86400000;
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseISO(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function toISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function daysBetween(a, b) { return Math.round((midnight(b) - midnight(a)) / DAY_MS); }
  function fmtShort(d) { return WD[d.getDay()] + ' ' + d.getDate(); }
  function fmtLong(d) { return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()]; }

  /* index of today within the swing, or -1 */
  function todayIndex(s) {
    if (!s.start) return -1;
    var i = daysBetween(parseISO(s.start), new Date());
    return (i >= 0 && i < s.length) ? i : -1;
  }

  /* ---------------- derived ---------------- */

  function activeSwing() {
    for (var i = 0; i < state.swings.length; i++) {
      if (state.swings[i].id === state.activeId) return state.swings[i];
    }
    return null;
  }
  function punched(s) {
    var n = 0;
    for (var i = 0; i < s.days.length; i++) if (s.days[i]) n++;
    return n;
  }
  function nextUnpunched(s) {
    for (var i = 0; i < s.days.length; i++) if (!s.days[i]) return i;
    return -1;
  }

  /* ---------------- render ---------------- */

  function render() {
    var s = activeSwing();
    el.empty.hidden = !!s;
    el.dash.hidden = !s;

    if (!s) {
      el.swingName.textContent = 'Punch Card';
      el.swingSub.textContent = 'No swing yet';
      return;
    }

    var done = punched(s), left = s.length - done, complete = left === 0;

    el.swingName.textContent = s.name;
    el.swingSub.textContent = complete
      ? 'Complete — ' + s.length + ' days'
      : done + ' of ' + s.length + ' days punched';

    el.doneCount.textContent = done;
    el.ofCount.textContent = 'of ' + s.length;
    el.ringFill.style.strokeDashoffset = RING * (1 - done / s.length);
    el.ringFill.classList.toggle('complete', complete);

    el.statDone.textContent = done + (done === 1 ? ' day' : ' days');
    el.statLeft.textContent = complete ? 'None — done' : left + (left === 1 ? ' day' : ' days');
    el.statEnd.textContent = s.start ? fmtLong(addDays(parseISO(s.start), s.length - 1)) : '—';

    el.doneBanner.hidden = !complete;

    var ti = todayIndex(s);
    var target = ti >= 0 ? ti : nextUnpunched(s);
    el.todayBtn.hidden = complete || target < 0;
    el.todayBtn.textContent = ti >= 0
      ? (s.days[ti] ? 'Unpunch today' : 'Punch today')
      : 'Punch day ' + (target + 1);

    renderGrid(s, ti);
  }

  function renderGrid(s, ti) {
    var frag = document.createDocumentFragment();
    var start = s.start ? parseISO(s.start) : null;

    for (var i = 0; i < s.length; i++) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day' + (s.days[i] ? ' punched' : '') + (i === ti ? ' today' : '');
      cell.dataset.i = i;
      cell.setAttribute('aria-pressed', s.days[i] ? 'true' : 'false');

      var label = 'Day ' + (i + 1);
      var sub = i === ti ? 'Today' : (start ? fmtShort(addDays(start, i)) : 'Day');
      if (start) label += ', ' + fmtLong(addDays(start, i));

      cell.setAttribute('aria-label', label + (s.days[i] ? ', punched' : ''));
      cell.innerHTML =
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="d">' + sub + '</span>' +
        '<span class="mark"><svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg></span>';

      frag.appendChild(cell);
    }
    el.grid.innerHTML = '';
    el.grid.appendChild(frag);
  }

  function renderSwingList() {
    var frag = document.createDocumentFragment();

    if (!state.swings.length) {
      var p = document.createElement('li');
      p.className = 'hint';
      p.textContent = 'No swings yet.';
      frag.appendChild(p);
    }

    state.swings.slice().sort(function (a, b) { return b.created - a.created; }).forEach(function (s) {
      var done = punched(s), pct = Math.round(done / s.length * 100), complete = done === s.length;
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swing-item' + (s.id === state.activeId ? ' active' : '') + (complete ? ' done' : '');
      b.dataset.swing = s.id;

      var sub = s.start
        ? fmtLong(parseISO(s.start)) + ' → ' + fmtLong(addDays(parseISO(s.start), s.length - 1))
        : s.length + ' days';

      b.innerHTML =
        '<span class="meta">' +
          '<span class="nm"></span>' +
          '<span class="sub"></span>' +
          '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
        '</span>' +
        '<span class="pct">' + done + '/' + s.length + '</span>';

      b.querySelector('.nm').textContent = s.name;
      b.querySelector('.sub').textContent = sub;

      li.appendChild(b);
      frag.appendChild(li);
    });

    el.swingList.innerHTML = '';
    el.swingList.appendChild(frag);
  }

  /* ---------------- actions ---------------- */

  function togglePunch(i, cell) {
    var s = activeSwing();
    if (!s || i < 0 || i >= s.length) return;

    var wasComplete = punched(s) === s.length;
    s.days[i] = !s.days[i];
    save();

    if (s.days[i] && cell) {
      cell.classList.add('pop');
      var r = document.createElement('span');
      r.className = 'ripple';
      cell.appendChild(r);
      setTimeout(function () { cell.classList.remove('pop'); r.remove(); }, 520);
    }
    if (navigator.vibrate) navigator.vibrate(s.days[i] ? 18 : 8);

    render();

    if (!wasComplete && punched(s) === s.length) {
      celebrate();
      toast('Swing complete! 🎉');
    }
  }

  function openSheet(node) {
    closeSheets();
    el.toast.hidden = true;
    el.backdrop.hidden = false;
    node.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSheets() {
    el.backdrop.hidden = true;
    el.swingsSheet.hidden = true;
    el.editSheet.hidden = true;
    el.dataSheet.hidden = true;
    document.body.style.overflow = '';
  }

  function openEditor(id) {
    editingId = id || null;
    var s = id ? activeSwingById(id) : null;

    el.editSheetTitle.textContent = s ? 'Edit swing' : 'New swing';
    el.saveBtn.textContent = s ? 'Save changes' : 'Start swing';
    el.deleteBtn.hidden = !s;

    el.fName.value = s ? s.name : 'Swing ' + (state.swings.length + 1);
    el.fLength.value = s ? s.length : 14;
    el.fStart.value = s ? s.start : toISO(new Date());
    markPresets();
    openSheet(el.editSheet);
  }

  function activeSwingById(id) {
    for (var i = 0; i < state.swings.length; i++) if (state.swings[i].id === id) return state.swings[i];
    return null;
  }

  function markPresets() {
    var v = parseInt(el.fLength.value, 10);
    Array.prototype.forEach.call(el.presets.children, function (b) {
      b.classList.toggle('on', parseInt(b.dataset.len, 10) === v);
    });
  }

  function submitEditor(e) {
    e.preventDefault();
    var len = clamp(parseInt(el.fLength.value, 10) || 14, 1, 90);
    var name = el.fName.value.trim().slice(0, 40) || 'Swing ' + (state.swings.length + 1);
    var start = el.fStart.value || '';

    if (editingId) {
      var s = activeSwingById(editingId);
      s.name = name;
      s.start = start;
      if (len !== s.length) {
        var days = s.days.slice(0, len);
        while (days.length < len) days.push(false);
        s.days = days;
        s.length = len;
      }
    } else {
      var fresh = normalise({ id: uid(), name: name, length: len, start: start, days: [], created: Date.now() });
      state.swings.push(fresh);
      state.activeId = fresh.id;
    }
    save();
    closeSheets();
    render();
    toast(editingId ? 'Swing updated' : 'Swing started');
    editingId = null;
  }

  function deleteSwing() {
    var s = activeSwingById(editingId);
    if (!s) return;
    if (!confirm('Delete "' + s.name + '"? This cannot be undone.')) return;

    state.swings = state.swings.filter(function (x) { return x.id !== s.id; });
    if (state.activeId === s.id) state.activeId = state.swings.length ? state.swings[state.swings.length - 1].id : null;
    save();
    closeSheets();
    render();
    toast('Swing deleted');
    editingId = null;
  }

  /* ---------------- backup ---------------- */

  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'punch-card-backup-' + toISO(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.swings)) throw new Error('bad file');
        var swings = data.swings.map(normalise).filter(Boolean);
        if (!confirm('Replace your ' + state.swings.length + ' swing(s) with ' + swings.length + ' from this backup?')) return;
        state.swings = swings;
        state.activeId = data.activeId && activeSwingById(data.activeId) ? data.activeId : (swings[0] && swings[0].id) || null;
        save();
        closeSheets();
        render();
        toast('Backup restored');
      } catch (err) {
        toast('That file could not be read');
      }
    };
    reader.readAsText(file);
  }

  function wipe() {
    if (!confirm('Erase every swing on this device?')) return;
    state = { swings: [], activeId: null };
    save();
    closeSheets();
    render();
    toast('All data erased');
  }

  /* ---------------- toast + confetti ---------------- */

  var toastTimer;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function celebrate() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var cv = el.confetti, ctx = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    var colors = ['#ff9436', '#4ec98a', '#f2efe7', '#ffd166', '#6aa9ff'];
    var bits = [];

    for (var i = 0; i < 110; i++) {
      bits.push({
        x: Math.random() * W,
        y: -Math.random() * H * 0.4,
        w: (5 + Math.random() * 6) * dpr,
        h: (8 + Math.random() * 9) * dpr,
        vy: (2.2 + Math.random() * 3.4) * dpr,
        vx: (Math.random() - 0.5) * 2.4 * dpr,
        a: Math.random() * Math.PI,
        va: (Math.random() - 0.5) * 0.28,
        c: colors[(Math.random() * colors.length) | 0]
      });
    }

    var end = Date.now() + 2600;
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (Date.now() < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    })();
  }

  /* ---------------- events ---------------- */

  el.grid.addEventListener('click', function (e) {
    var cell = e.target.closest('.day');
    if (cell) togglePunch(parseInt(cell.dataset.i, 10), cell);
  });

  el.swingList.addEventListener('click', function (e) {
    var item = e.target.closest('.swing-item');
    if (!item) return;
    state.activeId = item.dataset.swing;
    save();
    closeSheets();
    render();
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'new-swing': openEditor(null); break;
      case 'edit-swing': openEditor(state.activeId); break;
      case 'close-sheets': closeSheets(); editingId = null; break;
      case 'punch-today': punchTarget(); break;
      case 'export': exportData(); break;
      case 'import': el.importFile.click(); break;
      case 'wipe': wipe(); break;
    }
  });

  function punchTarget() {
    var s = activeSwing();
    if (!s) return;
    var ti = todayIndex(s);
    var i = ti >= 0 ? ti : nextUnpunched(s);
    if (i < 0) return;
    togglePunch(i, el.grid.children[i]);
  }

  $('swingsBtn').addEventListener('click', function () { renderSwingList(); openSheet(el.swingsSheet); });
  $('menuBtn').addEventListener('click', function () { openSheet(el.dataSheet); });
  el.backdrop.addEventListener('click', function () { closeSheets(); editingId = null; });

  el.editForm.addEventListener('submit', submitEditor);
  el.deleteBtn.addEventListener('click', deleteSwing);
  el.fLength.addEventListener('input', markPresets);

  el.presets.addEventListener('click', function (e) {
    var b = e.target.closest('[data-len]');
    if (!b) return;
    el.fLength.value = b.dataset.len;
    markPresets();
  });

  document.querySelectorAll('.stepper .step').forEach(function (b) {
    b.addEventListener('click', function () {
      el.fLength.value = clamp((parseInt(el.fLength.value, 10) || 14) + parseInt(b.dataset.step, 10), 1, 90);
      markPresets();
    });
  });

  el.importFile.addEventListener('change', function () {
    if (this.files && this.files[0]) importData(this.files[0]);
    this.value = '';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheets(); editingId = null; }
  });

  /* a swing rolls over at midnight — refresh "today" when the app comes back */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });

  /* ---------------- boot ---------------- */

  load();
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
