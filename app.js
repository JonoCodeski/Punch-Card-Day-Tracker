/* Punch Card — FIFO roster + swing tracker.
   The roster is the source of truth: a repeating cycle of blocks anchored to one
   fly-in date generates every swing forwards and backwards, forever. Punches are
   keyed by calendar date, so editing a roster never loses a tick. */
(function () {
  'use strict';

  var KEY = 'punchcard.v2';
  var OLD_KEY = 'punchcard.v1';
  var RING = 2 * Math.PI * 52;
  var DAY_MS = 86400000;

  var TYPES = {
    days:   { label: 'Day shift',   badge: 'On — days',   short: 'D' },
    nights: { label: 'Night shift', badge: 'On — nights', short: 'N' },
    off:    { label: 'R&R',         badge: 'R&R',         short: 'off' }
  };
  var COLORS = ['#d2622c', '#5b74c4', '#3fa88e', '#a874c8', '#c2a020', '#c4667f'];

  var state = { version: 2, people: [], activeId: null };
  var cursorISO = null;               // a date inside the swing being shown, null = follow today
  var tab = 'swing';
  var today = midnight(new Date());
  var viewYear = today.getFullYear(), viewMonth = today.getMonth();
  var sheetDateISO = null;

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['crewDot','barTitle','barSub','swingRange','swingWhen','backToNow','rrCard','rrHead','rrSub',
   'progressCard','ringFill','doneCount','ofCount','statDone','statLeft','statOut','gridHeading',
   'todayPunchBtn','grid','doneBanner','doneSub','noRoster','checkDate','calTitle','cal','calPeople',
   'peopleBar','fName','fStart','blocks','cycleSummary','presets','addBlock','removePerson',
   'backdrop','crewSheet','crewList','daySheet','daySheetTitle','dayVerdicts','dayPunchWrap',
   'dayPunchBtn','dataSheet','importFile','toast','confetti']
    .forEach(function (id) { el[id] = $(id); });

  /* ==================== dates ==================== */

  var WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function diffDays(a, b) { return Math.round((midnight(b) - midnight(a)) / DAY_MS); }
  function fmtShort(d) { return WD[d.getDay()] + ' ' + d.getDate(); }
  function fmtMed(d) { return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()]; }
  function fmtLong(d) { return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear(); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* ==================== model ==================== */

  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function newPerson(name) {
    return {
      id: uid(),
      name: name || ('Person ' + (state.people.length + 1)),
      start: toISO(today),
      blocks: [{ type: 'days', len: 14 }, { type: 'off', len: 14 }],
      punches: {}
    };
  }

  function normalisePerson(p) {
    if (!p || typeof p !== 'object') return null;
    var blocks = (Array.isArray(p.blocks) ? p.blocks : [])
      .map(function (b) {
        return { type: TYPES[b && b.type] ? b.type : 'days', len: clamp(parseInt(b && b.len, 10) || 0, 0, 365) };
      })
      .filter(function (b) { return b.len > 0; });
    if (!blocks.length) blocks = [{ type: 'days', len: 14 }, { type: 'off', len: 14 }];

    var punches = {};
    if (p.punches && typeof p.punches === 'object') {
      Object.keys(p.punches).forEach(function (k) { if (p.punches[k] && parseISO(k)) punches[k] = 1; });
    }
    return {
      id: String(p.id || uid()),
      name: String(p.name || 'Me').slice(0, 24),
      start: parseISO(p.start) ? p.start : toISO(today),
      blocks: blocks,
      punches: punches
    };
  }

  function active() {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === state.activeId) return state.people[i];
    return null;
  }
  function colorOf(p) { return COLORS[Math.max(0, state.people.indexOf(p)) % COLORS.length]; }

  /* ==================== roster maths ==================== */

  function cycleLen(p) {
    return p.blocks.reduce(function (s, b) { return s + b.len; }, 0);
  }

  /* Which block a date falls in, and how far through it. */
  function blockAt(p, date) {
    var start = parseISO(p.start), cyc = cycleLen(p);
    if (!start || cyc < 1) return null;
    var idx = diffDays(start, date) % cyc;
    if (idx < 0) idx += cyc;
    var cursor = 0;
    for (var i = 0; i < p.blocks.length; i++) {
      var b = p.blocks[i];
      if (idx < cursor + b.len) return { type: b.type, label: TYPES[b.type].label, dayNum: idx - cursor + 1, of: b.len };
      cursor += b.len;
    }
    return null;
  }
  function typeAt(p, date) {
    var b = blockAt(p, date);
    return b ? b.type : null;
  }
  function isOn(p, date) {
    var t = typeAt(p, date);
    return t === 'days' || t === 'nights';
  }
  function isFlyIn(p, d) { return isOn(p, d) && !isOn(p, addDays(d, -1)); }
  function isFlyOut(p, d) { return isOn(p, d) && !isOn(p, addDays(d, 1)); }

  /* The whole swing containing a date — a run of on-days, day and night blocks
     together, bounded by R&R on both sides. */
  function swingAt(p, date) {
    if (!isOn(p, date)) return null;
    var cyc = cycleLen(p), s = midnight(date), e = midnight(date), i;
    for (i = 0; i < cyc; i++) {
      var prev = addDays(s, -1);
      if (!isOn(p, prev)) break;
      s = prev;
    }
    for (i = 0; i < cyc; i++) {
      var next = addDays(e, 1);
      if (!isOn(p, next)) break;
      e = next;
    }
    return { start: s, end: e, len: diffDays(s, e) + 1 };
  }
  function nextSwing(p, from) {
    var cyc = cycleLen(p);
    for (var i = 1; i <= cyc * 2 + 2; i++) {
      var d = addDays(from, i);
      if (isOn(p, d)) return swingAt(p, d);
    }
    return null;
  }
  function prevSwing(p, from) {
    var cyc = cycleLen(p);
    for (var i = 1; i <= cyc * 2 + 2; i++) {
      var d = addDays(from, -i);
      if (isOn(p, d)) return swingAt(p, d);
    }
    return null;
  }

  /* The swing on screen: the one you're in, else the next one up, else whatever
     the arrows have been pointed at. */
  function viewSwing(p) {
    if (cursorISO) {
      var s = swingAt(p, parseISO(cursorISO));
      if (s) return { swing: s, mode: 'browse' };
      cursorISO = null;
    }
    var cur = swingAt(p, today);
    if (cur) return { swing: cur, mode: 'now' };
    return { swing: nextSwing(p, today), mode: 'next' };
  }

  function punchedIn(p, swing) {
    var n = 0;
    for (var i = 0; i < swing.len; i++) if (p.punches[toISO(addDays(swing.start, i))]) n++;
    return n;
  }

  function nextChange(p, date) {
    var here = typeAt(p, date), cyc = cycleLen(p);
    for (var i = 1; i <= cyc; i++) {
      var d = addDays(date, i), t = typeAt(p, d);
      if (t && t !== here) {
        var what = t === 'off' ? 'R&R starts' : t === 'days' ? 'day shift starts' : 'night shift starts';
        return what + ' ' + fmtMed(d) + ' (' + plural(i, 'day') + ' away)';
      }
    }
    return '';
  }

  /* ==================== storage ==================== */

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — device storage is full or blocked'); }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}

    if (raw) {
      try {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.people) && d.people.length) {
          state.people = d.people.map(normalisePerson).filter(Boolean);
          state.activeId = d.activeId && byId(d.activeId) ? d.activeId : state.people[0].id;
          return;
        }
      } catch (e) {}
    }

    if (migrateV1()) return;

    var p = newPerson('Me');
    state.people = [p];
    state.activeId = p.id;
  }

  /* Old versions stored hand-made swings. Keep every tick by re-keying it to the
     date it fell on, and seed a cycle from the most recent swing. */
  function migrateV1() {
    var raw = null;
    try { raw = localStorage.getItem(OLD_KEY); } catch (e) { return false; }
    if (!raw) return false;

    var old;
    try { old = JSON.parse(raw); } catch (e) { return false; }
    if (!old || !Array.isArray(old.swings) || !old.swings.length) return false;

    var p = newPerson('Me'), dated = [];
    old.swings.forEach(function (s) {
      var start = parseISO(s && s.start);
      if (!start || !Array.isArray(s.days)) return;
      dated.push({ start: start, len: s.days.length });
      s.days.forEach(function (on, i) { if (on) p.punches[toISO(addDays(start, i))] = 1; });
    });

    if (dated.length) {
      dated.sort(function (a, b) { return b.start - a.start; });
      var latest = dated[0];
      p.start = toISO(latest.start);
      p.blocks = [{ type: 'days', len: latest.len }, { type: 'off', len: latest.len }];
    }

    state.people = [p];
    state.activeId = p.id;
    save();
    return true;
  }

  function byId(id) {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === id) return state.people[i];
    return null;
  }

  /* ==================== render: chrome ==================== */

  function render() {
    var p = active();
    if (!p) return;

    el.crewDot.style.background = colorOf(p);
    el.barTitle.textContent = p.name;

    var b = blockAt(p, today);
    if (!b) {
      el.barSub.textContent = 'No cycle set';
    } else if (b.type === 'off') {
      var n = nextSwing(p, today);
      el.barSub.textContent = n
        ? 'R&R — fly in ' + fmtMed(n.start) + ', ' + plural(diffDays(today, n.start), 'day')
        : 'R&R';
    } else {
      var sw = swingAt(p, today);
      el.barSub.textContent = 'Day ' + (diffDays(sw.start, today) + 1) + ' of ' + sw.len +
        ' · ' + (b.type === 'nights' ? 'nights' : 'days');
    }

    renderSwing(p);
    renderCalendar();
    renderRoster(p);
    renderCrew();
  }

  /* ==================== render: swing ==================== */

  function renderSwing(p) {
    var v = viewSwing(p), s = v.swing;

    el.noRoster.hidden = !!s;
    el.progressCard.hidden = !s;
    el.grid.hidden = !s;
    el.backToNow.hidden = v.mode !== 'browse';

    if (!s) {
      el.swingRange.textContent = '—';
      el.swingWhen.textContent = 'No swing found in this cycle';
      el.rrCard.hidden = true;
      el.doneBanner.hidden = true;
      el.todayPunchBtn.hidden = true;
      el.grid.innerHTML = '';
      return;
    }

    var done = punchedIn(p, s), left = s.len - done, complete = left === 0;
    var isNow = diffDays(s.start, today) >= 0 && diffDays(today, s.end) >= 0;

    el.swingRange.textContent = fmtMed(s.start) + ' → ' + fmtMed(s.end);
    el.swingWhen.textContent = isNow
      ? 'This swing — ' + plural(s.len, 'day')
      : (s.start > today ? 'Starts in ' + plural(diffDays(today, s.start), 'day') : 'Finished ' + plural(diffDays(s.end, today), 'day') + ' ago')
        + ' — ' + plural(s.len, 'day');

    /* R&R hero, only when today really is a day off and we're looking at what's next */
    var offNow = v.mode === 'next';
    el.rrCard.hidden = !offNow;
    if (offNow) {
      var away = diffDays(today, s.start);
      el.rrHead.textContent = away === 0 ? 'Fly in today' : 'Fly in ' + fmtMed(s.start);
      el.rrSub.textContent = (away === 1 ? 'Tomorrow' : plural(away, 'day') + ' to go') +
        ' · next swing is ' + plural(s.len, 'day') + ', home ' + fmtMed(s.end);
    }

    el.doneCount.textContent = done;
    el.ofCount.textContent = 'of ' + s.len;
    el.ringFill.style.strokeDashoffset = RING * (1 - done / s.len);
    el.ringFill.classList.toggle('complete', complete);
    el.statDone.textContent = plural(done, 'day');
    el.statLeft.textContent = complete ? 'None — done' : plural(left, 'day');
    el.statOut.textContent = fmtMed(s.end);

    el.doneBanner.hidden = !complete;
    if (complete) el.doneSub.textContent = 'All ' + s.len + ' days punched. Home ' + fmtMed(s.end) + '.';

    var todayIdx = isNow ? diffDays(s.start, today) : -1;
    el.todayPunchBtn.hidden = todayIdx < 0;
    if (todayIdx >= 0) {
      el.todayPunchBtn.textContent = p.punches[toISO(today)] ? 'Unpunch today' : 'Punch today';
    }

    el.gridHeading.textContent = describeCycleRun(p, s);
    renderGrid(p, s, todayIdx);
  }

  /* "7 days + 7 nights" for a mixed swing, "14 days" for a plain one */
  function describeCycleRun(p, s) {
    var runs = [], i, t, prev = null;
    for (i = 0; i < s.len; i++) {
      t = typeAt(p, addDays(s.start, i));
      if (t !== prev) { runs.push({ type: t, n: 1 }); prev = t; }
      else runs[runs.length - 1].n++;
    }
    return runs.map(function (r) {
      return r.n + ' ' + (r.type === 'nights' ? (r.n === 1 ? 'night' : 'nights') : (r.n === 1 ? 'day' : 'days'));
    }).join(' + ');
  }

  function renderGrid(p, s, todayIdx) {
    var frag = document.createDocumentFragment();

    for (var i = 0; i < s.len; i++) {
      var d = addDays(s.start, i), iso = toISO(d), t = typeAt(p, d);
      var on = !!p.punches[iso];

      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day t-' + t + (on ? ' punched' : '') + (i === todayIdx ? ' today' : '');
      cell.dataset.iso = iso;

      var flyIn = i === 0, flyOut = i === s.len - 1;
      var sub = i === todayIdx ? 'Today' : fmtShort(d);
      var aria = 'Day ' + (i + 1) + ', ' + fmtLong(d) + ', ' + TYPES[t].label +
        (flyIn ? ', fly in' : '') + (flyOut ? ', fly out' : '') + (on ? ', punched' : '');
      cell.setAttribute('aria-label', aria);
      cell.setAttribute('aria-pressed', on ? 'true' : 'false');

      cell.innerHTML =
        '<span class="edge"></span>' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<span class="d">' + sub + '</span>' +
        (flyIn ? '<span class="plane" title="Fly in">✈</span>' : '') +
        (flyOut ? '<span class="plane out" title="Fly out">✈</span>' : '') +
        '<span class="mark"><svg viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg></span>';

      frag.appendChild(cell);
    }

    el.grid.innerHTML = '';
    el.grid.appendChild(frag);
  }

  function togglePunch(iso, cell) {
    var p = active();
    if (!p) return;

    var v = viewSwing(p), s = v.swing;
    var was = s ? punchedIn(p, s) === s.len : false;

    if (p.punches[iso]) delete p.punches[iso];
    else p.punches[iso] = 1;
    save();

    if (p.punches[iso] && cell) {
      cell.classList.add('pop');
      var r = document.createElement('span');
      r.className = 'ripple';
      cell.appendChild(r);
      setTimeout(function () { cell.classList.remove('pop'); r.remove(); }, 520);
    }
    if (navigator.vibrate) navigator.vibrate(p.punches[iso] ? 18 : 8);

    render();

    if (s && !was && punchedIn(p, s) === s.len) {
      celebrate();
      toast('Swing complete! 🎉');
    }
  }

  /* ==================== render: calendar ==================== */

  function renderCalendar() {
    var crew = state.people.filter(function (p) { return blockAt(p, today); });
    var multi = crew.length > 1;
    var first = new Date(viewYear, viewMonth, 1);
    var frag = document.createDocumentFragment();

    el.calTitle.textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function (d) {
      var h = document.createElement('div');
      h.className = 'dow';
      h.textContent = d;
      frag.appendChild(h);
    });

    var lead = (first.getDay() + 6) % 7;
    var gridStart = new Date(viewYear, viewMonth, 1 - lead);
    var act = active();

    for (var i = 0; i < 42; i++) {
      var d = addDays(gridStart, i), iso = toISO(d);
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell' + (d.getMonth() !== viewMonth ? ' other' : '') + (diffDays(today, d) === 0 ? ' today' : '');
      cell.dataset.iso = iso;

      var html = '<span class="num">' + d.getDate() + '</span>', titles = [];

      for (var j = 0; j < crew.length; j++) {
        var p = crew[j], b = blockAt(p, d);
        if (!b) continue;
        var mark = '';
        if (b.type !== 'off') {
          if (isFlyIn(p, d)) mark = '✈';
          else if (isFlyOut(p, d)) mark = '✈';
        }
        var face = multi ? (p.name || '?').trim().charAt(0).toUpperCase() : TYPES[b.type].short;
        var tick = (p === act && p.punches[iso]) ? '<span class="tick">✓</span>' : '';
        html += '<span class="strip ' + b.type + '">' + (mark ? mark + ' ' : '') + esc(face) + tick + '</span>';
        titles.push(p.name + ': ' + b.label + ' (day ' + b.dayNum + '/' + b.of + ')');
      }

      cell.innerHTML = html;
      cell.title = fmtLong(d) + (titles.length ? ' — ' + titles.join(' · ') : '');
      frag.appendChild(cell);
    }

    el.cal.innerHTML = '';
    el.cal.appendChild(frag);

    el.calPeople.innerHTML = multi
      ? 'Rows top to bottom: ' + crew.map(function (p) {
          return '<span><i style="background:' + colorOf(p) + '"></i>' + esc(p.name) + '</span>';
        }).join('')
      : '';
  }

  function openDaySheet(iso) {
    var d = parseISO(iso);
    if (!d) return;
    sheetDateISO = iso;
    el.daySheetTitle.textContent = fmtLong(d);

    var frag = document.createDocumentFragment();
    state.people.forEach(function (p) {
      var b = blockAt(p, d);
      if (!b) return;
      var row = document.createElement('div');
      row.className = 'verdict ' + b.type;

      var bits = [];
      if (b.type === 'off') {
        bits.push('day ' + b.dayNum + ' of ' + b.of + ' off');
      } else {
        var s = swingAt(p, d);
        bits.push('Day ' + (s ? diffDays(s.start, d) + 1 : b.dayNum) + ' of ' + (s ? s.len : b.of));
        if (isFlyIn(p, d)) bits.push('✈ fly in');
        if (isFlyOut(p, d)) bits.push('✈ fly out');
        if (p.punches[iso]) bits.push('✓ punched');
      }
      var nc = nextChange(p, d);
      if (nc) bits.push(nc);

      row.innerHTML =
        '<span class="who"><i style="background:' + colorOf(p) + '"></i>' + esc(p.name) + '</span>' +
        '<span class="badge">' + TYPES[b.type].badge + '</span>' +
        '<span class="detail">' + esc(bits.join(' · ')) + '</span>';
      frag.appendChild(row);
    });

    el.dayVerdicts.innerHTML = '';
    el.dayVerdicts.appendChild(frag);

    var p = active();
    var punchable = p && isOn(p, d);
    el.dayPunchWrap.hidden = !punchable;
    if (punchable) el.dayPunchBtn.textContent = p.punches[iso] ? 'Unpunch this day' : 'Punch this day';

    openSheet(el.daySheet);
  }

  /* ==================== render: roster ==================== */

  function renderRoster(p) {
    el.fName.value = p.name;
    el.fStart.value = p.start;
    el.removePerson.hidden = state.people.length < 2;

    var frag = document.createDocumentFragment();
    p.blocks.forEach(function (b, i) {
      var row = document.createElement('div');
      row.className = 'block-row';

      var num = document.createElement('div');
      num.className = 'block-num';
      num.textContent = i + 1;

      var sel = document.createElement('select');
      sel.className = 'b-' + b.type;
      sel.setAttribute('aria-label', 'Block ' + (i + 1) + ' type');
      [['days','Days on'],['nights','Nights on'],['off','Off (R&R)']].forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        if (o[0] === b.type) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { b.type = sel.value; save(); render(); });

      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '1'; inp.max = '90'; inp.inputMode = 'numeric'; inp.value = b.len;
      inp.setAttribute('aria-label', 'Block ' + (i + 1) + ' length in days');
      inp.addEventListener('change', function () {
        b.len = clamp(parseInt(inp.value, 10) || 1, 1, 90);
        inp.value = b.len;
        save(); render();
      });

      var del = document.createElement('button');
      del.type = 'button'; del.className = 'del-btn'; del.innerHTML = '✕';
      del.setAttribute('aria-label', 'Remove block ' + (i + 1));
      del.addEventListener('click', function () {
        if (p.blocks.length < 2) { toast('A cycle needs at least one block'); return; }
        p.blocks.splice(i, 1);
        save(); render();
      });

      row.appendChild(num); row.appendChild(sel); row.appendChild(inp); row.appendChild(del);
      frag.appendChild(row);
    });
    el.blocks.innerHTML = '';
    el.blocks.appendChild(frag);

    var cyc = cycleLen(p);
    var parts = p.blocks.map(function (b) {
      return b.len + (b.type === 'days' ? ' days on' : b.type === 'nights' ? ' nights on' : ' off');
    });
    el.cycleSummary.innerHTML = 'Full cycle: <strong>' + plural(cyc, 'day') + '</strong> — ' + esc(parts.join(' → ')) + ', then repeats.';

    var cur = JSON.stringify(p.blocks.map(function (b) { return [b.type, b.len]; }));
    Array.prototype.forEach.call(el.presets.children, function (btn) {
      btn.classList.toggle('on', btn.dataset.blocks === cur);
    });

    renderPeopleBar();
  }

  function renderPeopleBar() {
    var frag = document.createDocumentFragment();
    state.people.forEach(function (p) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'person-chip' + (p.id === state.activeId ? ' active' : '');
      chip.dataset.person = p.id;
      chip.innerHTML = '<i style="background:' + colorOf(p) + '"></i>' + esc(p.name);
      frag.appendChild(chip);
    });
    el.peopleBar.innerHTML = '';
    el.peopleBar.appendChild(frag);
  }

  function renderCrew() {
    var frag = document.createDocumentFragment();
    state.people.forEach(function (p) {
      var b = blockAt(p, today);
      var sub = !b ? 'No cycle' : b.type === 'off'
        ? 'R&R — day ' + b.dayNum + ' of ' + b.of
        : TYPES[b.type].badge + ' — day ' + b.dayNum + ' of ' + b.of;

      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'crew-item' + (p.id === state.activeId ? ' active' : '');
      btn.dataset.person = p.id;
      btn.innerHTML = '<i style="background:' + colorOf(p) + '"></i><span class="meta">' +
        '<span class="nm">' + esc(p.name) + '</span><span class="sub">' + esc(sub) + '</span></span>';
      li.appendChild(btn);
      frag.appendChild(li);
    });
    el.crewList.innerHTML = '';
    el.crewList.appendChild(frag);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ==================== tabs & sheets ==================== */

  function showTab(name) {
    tab = name;
    ['swing','calendar','roster'].forEach(function (t) {
      $('tab-' + t).hidden = t !== name;
    });
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    window.scrollTo(0, 0);
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
    el.crewSheet.hidden = true;
    el.daySheet.hidden = true;
    el.dataSheet.hidden = true;
    document.body.style.overflow = '';
  }

  /* ==================== backup ==================== */

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
        var d = JSON.parse(reader.result);
        var people = Array.isArray(d && d.people) ? d.people.map(normalisePerson).filter(Boolean) : [];

        /* a v1 backup carries swings, not people — bring those across too */
        if (!people.length && d && Array.isArray(d.swings)) {
          var p = newPerson('Me'), dated = [];
          d.swings.forEach(function (s) {
            var st = parseISO(s && s.start);
            if (!st || !Array.isArray(s.days)) return;
            dated.push({ start: st, len: s.days.length });
            s.days.forEach(function (on, i) { if (on) p.punches[toISO(addDays(st, i))] = 1; });
          });
          if (dated.length) {
            dated.sort(function (a, b) { return b.start - a.start; });
            p.start = toISO(dated[0].start);
            p.blocks = [{ type: 'days', len: dated[0].len }, { type: 'off', len: dated[0].len }];
          }
          people = [p];
        }
        if (!people.length) throw new Error('nothing usable');

        if (!confirm('Replace everything on this device with ' + plural(people.length, 'person').replace('persons', 'people') + ' from this backup?')) return;

        state.people = people;
        state.activeId = people[0].id;
        cursorISO = null;
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
    if (!confirm('Erase every roster and punch on this device?')) return;
    var p = newPerson('Me');
    state.people = [p];
    state.activeId = p.id;
    cursorISO = null;
    try { localStorage.removeItem(OLD_KEY); } catch (e) {}
    save();
    closeSheets();
    render();
    toast('All data erased');
  }

  /* ==================== toast & confetti ==================== */

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
    var colors = ['#f5a623', '#3fa88e', '#f2efe7', '#d2622c', '#5b74c4'];
    var bits = [];

    for (var i = 0; i < 110; i++) {
      bits.push({
        x: Math.random() * W, y: -Math.random() * H * 0.4,
        w: (5 + Math.random() * 6) * dpr, h: (8 + Math.random() * 9) * dpr,
        vy: (2.2 + Math.random() * 3.4) * dpr, vx: (Math.random() - 0.5) * 2.4 * dpr,
        a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.28,
        c: colors[(Math.random() * colors.length) | 0]
      });
    }

    var end = Date.now() + 2600;
    (function frame() {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      if (Date.now() < end) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    })();
  }

  /* ==================== events ==================== */

  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  el.grid.addEventListener('click', function (e) {
    var cell = e.target.closest('.day');
    if (cell) togglePunch(cell.dataset.iso, cell);
  });

  el.cal.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (cell) openDaySheet(cell.dataset.iso);
  });

  el.dayPunchBtn.addEventListener('click', function () {
    if (!sheetDateISO) return;
    togglePunch(sheetDateISO, null);
    openDaySheet(sheetDateISO);
  });

  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-person]');
    if (chip) {
      state.activeId = chip.dataset.person;
      cursorISO = null;
      save();
      closeSheets();
      render();
      return;
    }

    var step = e.target.closest('[data-swing-step]');
    if (step) {
      var p = active();
      if (!p) return;
      var cur = viewSwing(p).swing;
      if (!cur) return;
      var to = +step.dataset.swingStep > 0 ? nextSwing(p, cur.end) : prevSwing(p, cur.start);
      if (!to) { toast('No swing that way — check the cycle'); return; }
      cursorISO = toISO(to.start);
      render();
      return;
    }

    var act = e.target.closest('[data-action]');
    if (!act) return;
    switch (act.dataset.action) {
      case 'close-sheets': closeSheets(); break;
      case 'add-person': addPerson(); break;
      case 'export': exportData(); break;
      case 'import': el.importFile.click(); break;
      case 'wipe': wipe(); break;
    }
  });

  function addPerson() {
    var p = newPerson();
    state.people.push(p);
    state.activeId = p.id;
    cursorISO = null;
    save();
    closeSheets();
    showTab('roster');
    render();
    el.fName.focus();
    el.fName.select();
  }

  el.backToNow.addEventListener('click', function () { cursorISO = null; render(); });
  $('crewBtn').addEventListener('click', function () { renderCrew(); openSheet(el.crewSheet); });
  $('menuBtn').addEventListener('click', function () { openSheet(el.dataSheet); });
  el.backdrop.addEventListener('click', closeSheets);

  el.fName.addEventListener('input', function () {
    var p = active();
    if (!p) return;
    p.name = el.fName.value.slice(0, 24);
    save();
    el.barTitle.textContent = p.name;
    renderPeopleBar();
    renderCalendar();
  });

  el.fStart.addEventListener('change', function () {
    var p = active();
    if (!p || !parseISO(el.fStart.value)) return;
    p.start = el.fStart.value;
    cursorISO = null;
    save();
    render();
  });

  el.addBlock.addEventListener('click', function () {
    var p = active();
    if (!p) return;
    var last = p.blocks[p.blocks.length - 1];
    p.blocks.push({ type: last && last.type !== 'off' ? 'off' : 'days', len: 7 });
    save();
    render();
  });

  el.presets.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-blocks]');
    var p = active();
    if (!btn || !p) return;
    p.blocks = JSON.parse(btn.dataset.blocks).map(function (b) { return { type: b[0], len: b[1] }; });
    cursorISO = null;
    save();
    render();
  });

  el.removePerson.addEventListener('click', function () {
    var p = active();
    if (!p || state.people.length < 2) return;
    if (!confirm('Remove ' + p.name + ' and their roster?')) return;
    state.people = state.people.filter(function (x) { return x.id !== p.id; });
    state.activeId = state.people[0].id;
    cursorISO = null;
    save();
    render();
    toast('Person removed');
  });

  el.todayPunchBtn.addEventListener('click', function () {
    var iso = toISO(today);
    var cell = el.grid.querySelector('.day[data-iso="' + iso + '"]');
    togglePunch(iso, cell);
  });

  el.checkDate.addEventListener('change', function () {
    var d = parseISO(el.checkDate.value);
    if (!d) return;
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    renderCalendar();
    openDaySheet(el.checkDate.value);
  });

  $('prevMonth').addEventListener('click', function () {
    if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  $('nextMonth').addEventListener('click', function () {
    if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });
  $('thisMonth').addEventListener('click', function () {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    renderCalendar();
  });

  el.importFile.addEventListener('change', function () {
    if (this.files && this.files[0]) importData(this.files[0]);
    this.value = '';
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheets();
  });

  /* a swing rolls over at midnight — recheck when the app comes back */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var now = midnight(new Date());
    if (diffDays(today, now) !== 0) { today = now; cursorISO = null; }
    render();
  });

  /* ==================== boot ==================== */

  load();
  el.checkDate.value = toISO(today);
  showTab('swing');
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
