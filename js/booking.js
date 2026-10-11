// Contact page — native demo booking (availability + booking via Netlify Functions → Calendly)
(() => {
  const root = document.getElementById('booking');
  if (!root) return;

  const API = {
    event: '/api/booking/event',
    availability: '/api/booking/availability',
    book: '/api/booking',
  };
  const REQUEST_TIMEOUT_MS = 20000;
  const CACHE_TTL_MS = 2 * 60 * 1000;
  const MONTHS_AHEAD = 12;
  const TZ_MARGIN_MS = 14 * 60 * 60 * 1000;
  // Format check only — it cannot prove the visitor owns the address.
  const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[A-Za-z]{2,}$/;
  const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,19}$/;
  const MAX_GUESTS = 3; // Mirrors the server cap in netlify/functions/booking-create.mjs

  const el = {
    durationItem: document.getElementById('bookingDurationItem'),
    duration: document.getElementById('bookingDuration'),
    locationItem: document.getElementById('bookingLocationItem'),
    location: document.getElementById('bookingLocation'),
    tz: document.getElementById('bookingTimezone'),
    tzValue: document.getElementById('bookingTzValue'),
    tzPanel: document.getElementById('bookingTzPanel'),
    tzSearch: document.getElementById('bookingTzSearch'),
    tzList: document.getElementById('bookingTzList'),
    status: document.getElementById('bookingStatus'),
    pick: document.getElementById('bookingPick'),
    calendar: document.getElementById('bookingCalendar'),
    prev: document.getElementById('bookingPrev'),
    next: document.getElementById('bookingNext'),
    month: document.getElementById('bookingMonth'),
    grid: document.getElementById('bookingGrid'),
    calNote: document.getElementById('bookingCalNote'),
    dayLabel: document.getElementById('bookingDayLabel'),
    slots: document.getElementById('bookingSlots'),
    form: document.getElementById('bookingForm'),
    summaryWhen: document.getElementById('bookingSummaryWhen'),
    summaryMeta: document.getElementById('bookingSummaryMeta'),
    change: document.getElementById('bookingChange'),
    name: document.getElementById('bookingName'),
    email: document.getElementById('bookingEmail'),
    extra: document.getElementById('bookingExtraFields'),
    website: document.getElementById('bookingWebsite'),
    addGuests: document.getElementById('bookingAddGuests'),
    guestsField: document.getElementById('bookingGuestsField'),
    guests: document.getElementById('bookingGuests'),
    submit: document.getElementById('bookingSubmit'),
  };

  const state = {
    event: null,
    tz: detectTimeZone(),
    view: null,              // { year, month } — month is 0-based
    months: new Map(),       // 'YYYY-MM' → { slots: [iso], fetchedAt }
    loading: false,
    loadError: null,
    fetchSeq: 0,
    autoAdvance: 2,          // initial load skips up to two empty months
    slide: 0,                // -1 / 1: direction of the pending month slide
    revealDays: false,       // fade bookable days in on the next render
    selectedDay: null,       // 'YYYY-MM-DD' in state.tz
    selectedSlot: null,      // ISO string (UTC)
    submitting: false,
  };

  // ---- Utilities --------------------------------------------------------------

  function detectTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
    } catch {
      return 'Europe/London';
    }
  }

  const prefers12h = (() => {
    try {
      return new Intl.DateTimeFormat(navigator.language, { hour: 'numeric' }).resolvedOptions().hour12 !== false;
    } catch {
      return true;
    }
  })();

  function dayKeyIn(date, tz) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(date);
  }

  function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  function dayKey(year, month, day) {
    return `${monthKey(year, month)}-${String(day).padStart(2, '0')}`;
  }

  function parseDayKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return { year: y, month: m - 1, day: d };
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat('en-GB', {
      hour: prefers12h ? 'numeric' : '2-digit', minute: '2-digit', hour12: prefers12h, timeZone: state.tz,
    }).format(new Date(iso));
  }

  function formatDayLong(key) {
    const { year, month, day } = parseDayKey(key);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month, day)));
  }

  function formatDayShort(key) {
    const { year, month, day } = parseDayKey(key);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month, day)));
  }

  function tzOffset(tz) {
    try {
      return new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName').value;
    } catch {
      return ''; // older browsers: no offset shown
    }
  }

  // 'GMT+5:30' → 330, 'GMT' → 0 (for sorting).
  function offsetMinutes(offset) {
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offset);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  }

  function describeZone(tz) {
    const parts = tz.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    const region = parts.slice(0, -1).join(' / ').replace(/_/g, ' ');
    const offset = tzOffset(tz);
    return { tz, city, region, offset, minutes: offsetMinutes(offset) };
  }

  function tzLabel(tz) {
    const zone = describeZone(tz);
    return zone.offset ? `${zone.city} (${zone.offset})` : zone.city;
  }

  async function request(url, options) {
    let res;
    try {
      res = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return {
        ok: false,
        status: 0,
        error: {
          code: 'network',
          message: timedOut
            ? 'The request took too long. Please check your connection and try again.'
            : 'We could not reach the booking service. Please check your connection and try again.',
        },
      };
    }
    const data = await res.json().catch(() => null);
    if (res.ok && data) return { ok: true, status: res.status, data };
    if (res.status === 429) {
      // Netlify's rate limiter answers before the function, without a JSON body.
      return {
        ok: false,
        status: res.status,
        error: {
          code: 'rate_limited',
          message: 'Too many requests in a short time. Please wait a minute and try again.',
        },
      };
    }
    return {
      ok: false,
      status: res.status,
      error: (data && data.error) || {
        code: 'unknown',
        message: 'Something went wrong. Please try again.',
      },
    };
  }

  function showStatus(message, tone) {
    if (!message) {
      el.status.hidden = true;
      el.status.textContent = '';
      return;
    }
    el.status.textContent = message;
    el.status.dataset.tone = tone || 'error';
    el.status.hidden = false;
  }

  // Restarts a CSS animation class on an element that stays in the DOM.
  function playAnimation(node, className) {
    node.classList.remove('slide-next', 'slide-prev', 'is-entering');
    void node.offsetWidth; // reflow so the animation runs again
    node.classList.add(className);
  }

  // ---- Event details ----------------------------------------------------------

  async function loadEvent() {
    const res = await request(API.event);
    if (!res.ok) {
      if (res.error.code === 'not_configured') showUnavailable(res.error.message);
      return;
    }
    state.event = res.data.event;
    renderEvent();
    renderExtraFields();
  }

  function renderEvent() {
    const ev = state.event;
    if (!ev) return;
    // The heading stays as written in contact.html (fixed wording for SEO).
    // contact.html ships defaults for these so the header doesn't shift;
    // Calendly's values replace them here.
    el.durationItem.hidden = !ev.duration;
    if (ev.duration) el.duration.textContent = `${ev.duration} minutes`;
    el.locationItem.hidden = ev.locations.length === 0;
    if (ev.locations.length === 1) el.location.textContent = ev.locations[0].label;
    else if (ev.locations.length > 1) el.location.textContent = 'Choose how to meet';
  }

  function showUnavailable(message) {
    el.pick.hidden = true;
    el.form.hidden = true;
    showStatus(message, 'error');
  }

  // ---- Time zone ----------------------------------------------------------------

  // A custom listbox rather than a native <select>, whose option list can't
  // be styled to match the site.
  const tzPicker = {
    zones: null,   // all zones, sorted by UTC offset then city
    shown: [],     // zones matching the current search
    active: -1,    // keyboard-highlighted index within `shown`
    hideTimer: 0,  // pending hide after the close transition
  };

  function allZones() {
    if (tzPicker.zones) return tzPicker.zones;
    let names = [];
    try {
      names = Intl.supportedValuesOf('timeZone');
    } catch { /* fall back to the detected zone only */ }
    if (!names.includes(state.tz)) names = [state.tz, ...names];
    tzPicker.zones = names.map(describeZone)
      .sort((x, y) => x.minutes - y.minutes || x.city.localeCompare(y.city));
    return tzPicker.zones;
  }

  function renderTimeZones() {
    el.tzValue.textContent = tzLabel(state.tz);
  }

  function renderTzList() {
    const query = el.tzSearch.value.trim().toLowerCase().replace(/\s+/g, ' ');
    tzPicker.shown = allZones().filter((z) => !query ||
      `${z.city} ${z.region} ${z.tz.replace(/_/g, ' ')} ${z.offset}`.toLowerCase().includes(query));
    if (query) {
      // Cities starting with the query first ("tok" → Tokyo before Vostok).
      const rank = (z) => (z.city.toLowerCase().startsWith(query) ? 0 : 1);
      tzPicker.shown.sort((x, y) => rank(x) - rank(y));
    }

    const frag = document.createDocumentFragment();
    tzPicker.shown.forEach((z, i) => {
      const li = document.createElement('li');
      li.id = `bookingTzOpt-${i}`;
      li.className = 'booking-tz-option';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(z.tz === state.tz));
      li.dataset.index = String(i);

      const name = document.createElement('span');
      name.className = 'booking-tz-name';
      name.textContent = z.city;
      if (z.region) {
        const region = document.createElement('span');
        region.className = 'booking-tz-region';
        region.textContent = z.region;
        name.appendChild(region);
      }
      const offset = document.createElement('span');
      offset.className = 'booking-tz-offset';
      offset.textContent = z.offset;
      li.append(name, offset);
      frag.appendChild(li);
    });
    if (!tzPicker.shown.length) {
      const li = document.createElement('li');
      li.className = 'booking-tz-empty';
      li.textContent = 'No matching time zone';
      frag.appendChild(li);
    }
    el.tzList.replaceChildren(frag);

    const selected = tzPicker.shown.findIndex((z) => z.tz === state.tz);
    setActiveZone(query ? 0 : Math.max(selected, 0), { center: !query });
  }

  function setActiveZone(index, { center } = {}) {
    const prev = el.tzList.querySelector('.is-active');
    if (prev) prev.classList.remove('is-active');
    if (!tzPicker.shown.length) {
      tzPicker.active = -1;
      el.tzSearch.removeAttribute('aria-activedescendant');
      return;
    }
    tzPicker.active = Math.min(Math.max(index, 0), tzPicker.shown.length - 1);
    const li = document.getElementById(`bookingTzOpt-${tzPicker.active}`);
    li.classList.add('is-active');
    el.tzSearch.setAttribute('aria-activedescendant', li.id);
    // Scroll the list only (not the page) to keep the option visible.
    const list = el.tzList;
    if (center) {
      list.scrollTop = li.offsetTop - (list.clientHeight - li.offsetHeight) / 2;
    } else if (li.offsetTop < list.scrollTop) {
      list.scrollTop = li.offsetTop;
    } else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
  }

  function tzPickerOpen() {
    return el.tz.getAttribute('aria-expanded') === 'true';
  }

  function openTzPicker() {
    clearTimeout(tzPicker.hideTimer);
    el.tzPanel.hidden = false;
    el.tz.setAttribute('aria-expanded', 'true');
    el.tzSearch.value = '';
    renderTzList();
    void el.tzPanel.offsetWidth; // start the transition from the closed state
    el.tzPanel.classList.add('is-open');
    el.tzSearch.focus({ preventScroll: true });
  }

  function closeTzPicker({ restoreFocus } = {}) {
    if (!tzPickerOpen()) return;
    el.tz.setAttribute('aria-expanded', 'false');
    el.tzPanel.classList.remove('is-open');
    // Hide once the fade-out has finished (matches the CSS transition).
    tzPicker.hideTimer = setTimeout(() => { el.tzPanel.hidden = true; }, 200);
    if (restoreFocus) el.tz.focus({ preventScroll: true });
  }

  function chooseZone(tz) {
    closeTzPicker({ restoreFocus: true });
    if (tz === state.tz) return;
    state.tz = tz;
    renderTimeZones();
    // Slots are absolute times; only their grouping into days changes.
    if (state.selectedSlot) {
      state.selectedDay = dayKeyIn(new Date(state.selectedSlot), state.tz);
    } else {
      state.selectedDay = null;
    }
    renderCalendar();
    renderTimes();
    if (!el.form.hidden) renderSummary();
  }

  el.tz.addEventListener('click', () => {
    if (tzPickerOpen()) closeTzPicker({ restoreFocus: true });
    else openTzPicker();
  });

  el.tzSearch.addEventListener('input', renderTzList);

  el.tzSearch.addEventListener('keydown', (e) => {
    const page = 8;
    if (e.key === 'ArrowDown') setActiveZone(tzPicker.active + 1);
    else if (e.key === 'ArrowUp') setActiveZone(tzPicker.active - 1);
    else if (e.key === 'PageDown') setActiveZone(tzPicker.active + page);
    else if (e.key === 'PageUp') setActiveZone(tzPicker.active - page);
    else if (e.key === 'Enter') {
      if (tzPicker.active >= 0) chooseZone(tzPicker.shown[tzPicker.active].tz);
    } else if (e.key === 'Escape') {
      closeTzPicker({ restoreFocus: true });
    } else if (e.key === 'Tab') {
      closeTzPicker();
      return;
    } else {
      return;
    }
    e.preventDefault();
  });

  el.tzList.addEventListener('mousemove', (e) => {
    const li = e.target.closest('.booking-tz-option');
    if (li && Number(li.dataset.index) !== tzPicker.active) {
      el.tzList.querySelector('.is-active')?.classList.remove('is-active');
      tzPicker.active = Number(li.dataset.index);
      li.classList.add('is-active');
      el.tzSearch.setAttribute('aria-activedescendant', li.id);
    }
  });

  el.tzList.addEventListener('click', (e) => {
    const li = e.target.closest('.booking-tz-option');
    if (li) chooseZone(tzPicker.shown[Number(li.dataset.index)].tz);
  });

  // Keep focus in the search box when clicking inside the list.
  el.tzList.addEventListener('mousedown', (e) => e.preventDefault());

  document.addEventListener('mousedown', (e) => {
    if (tzPickerOpen() && !el.tzPanel.contains(e.target) && !el.tz.contains(e.target)) closeTzPicker();
  });

  // ---- Availability -----------------------------------------------------------

  function todayKey() {
    return dayKeyIn(new Date(), state.tz);
  }

  function currentMonth() {
    const { year, month } = parseDayKey(todayKey());
    return { year, month };
  }

  function monthOffset(view) {
    const now = currentMonth();
    return (view.year - now.year) * 12 + (view.month - now.month);
  }

  function slotsForView() {
    const entry = state.months.get(monthKey(state.view.year, state.view.month));
    const byDay = new Map();
    if (!entry) return byDay;
    const prefix = monthKey(state.view.year, state.view.month);
    entry.slots.forEach((iso) => {
      const key = dayKeyIn(new Date(iso), state.tz);
      if (!key.startsWith(prefix)) return;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(iso);
    });
    return byDay;
  }

  async function loadMonth({ force } = {}) {
    const { year, month } = state.view;
    const key = monthKey(year, month);
    const cached = state.months.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      state.loading = false;
      state.loadError = null;
      renderCalendar();
      renderTimes();
      return;
    }

    const seq = ++state.fetchSeq;
    state.loading = true;
    state.loadError = null;
    renderCalendar();
    renderTimes();

    // Fetch the month with a margin either side so any time zone's view of
    // the month is covered; days are grouped client-side in state.tz.
    const start = new Date(Date.UTC(year, month, 1) - TZ_MARGIN_MS);
    const end = new Date(Date.UTC(year, month + 1, 1) + TZ_MARGIN_MS);
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const res = await request(`${API.availability}?${params}`);

    if (seq !== state.fetchSeq) return; // a newer month was requested meanwhile

    state.loading = false;
    if (!res.ok) {
      state.loadError = res.error;
      if (res.error.code === 'not_configured') {
        showUnavailable(res.error.message);
        return;
      }
    } else {
      state.months.set(key, { slots: res.data.slots, fetchedAt: Date.now() });
      state.revealDays = true;

      // On first load, move past months with nothing left to book.
      if (state.autoAdvance > 0 && slotsForView().size === 0 && monthOffset(state.view) < MONTHS_AHEAD) {
        state.autoAdvance -= 1;
        goToMonth(1);
        return;
      }
      state.autoAdvance = 0;
    }

    if (state.selectedDay && !slotsForView().has(state.selectedDay)) {
      state.selectedDay = null;
    }
    renderCalendar();
    renderTimes();
  }

  function goToMonth(delta) {
    const d = new Date(Date.UTC(state.view.year, state.view.month + delta, 1));
    state.view = { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    state.slide = delta > 0 ? 1 : -1;
    if (state.selectedDay && !state.selectedDay.startsWith(monthKey(state.view.year, state.view.month))) {
      state.selectedDay = null;
    }
    loadMonth();
  }

  el.prev.addEventListener('click', () => {
    state.autoAdvance = 0;
    goToMonth(-1);
  });
  el.next.addEventListener('click', () => {
    state.autoAdvance = 0;
    goToMonth(1);
  });

  // ---- Calendar ---------------------------------------------------------------

  function renderCalendar() {
    const { year, month } = state.view;
    el.month.textContent = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month, 1)));

    const offset = monthOffset(state.view);
    el.prev.disabled = offset <= 0 || state.loading;
    el.next.disabled = offset >= MONTHS_AHEAD || state.loading;

    el.calendar.setAttribute('aria-busy', state.loading ? 'true' : 'false');
    el.calendar.classList.toggle('is-loading', state.loading);

    const byDay = state.loading || state.loadError ? new Map() : slotsForView();
    const today = todayKey();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const leading = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Monday-first

    const frag = document.createDocumentFragment();
    for (let i = 0; i < leading; i += 1) {
      const blank = document.createElement('span');
      blank.className = 'booking-day is-blank';
      blank.setAttribute('aria-hidden', 'true');
      frag.appendChild(blank);
    }

    let focusable = null;
    let revealIndex = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dayKey(year, month, day);
      const count = byDay.has(key) ? byDay.get(key).length : 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-day';
      btn.textContent = String(day);
      btn.dataset.day = key;
      btn.tabIndex = -1;

      const available = count > 0;
      btn.disabled = !available;
      if (available) {
        btn.classList.add('is-available');
        if (state.revealDays) {
          btn.classList.add('is-entering');
          btn.style.setProperty('--i', String(revealIndex));
          revealIndex += 1;
        }
      }
      if (key === today) btn.classList.add('is-today');
      if (key === state.selectedDay) {
        btn.classList.add('is-selected');
        btn.setAttribute('aria-pressed', 'true');
      } else if (available) {
        btn.setAttribute('aria-pressed', 'false');
      }

      const label = formatDayLong(key);
      btn.setAttribute(
        'aria-label',
        available ? `${label}, ${count} time${count === 1 ? '' : 's'} available` : `${label}, unavailable`
      );

      if (available && (!focusable || key === state.selectedDay)) focusable = btn;
      frag.appendChild(btn);
    }
    if (focusable) focusable.tabIndex = 0;
    state.revealDays = false;

    el.grid.replaceChildren(frag);

    if (state.slide) {
      const cls = state.slide > 0 ? 'slide-next' : 'slide-prev';
      playAnimation(el.grid, cls);
      playAnimation(el.month, cls);
      state.slide = 0;
    }

    // While loading, the note is silent visually (but still announced and
    // still taking its space); the pulsing placeholders show progress.
    el.calNote.classList.toggle('is-silent', state.loading);
    if (state.loading) {
      el.calNote.textContent = 'Loading available times…';
    } else if (state.loadError) {
      el.calNote.textContent = '';
    } else if (byDay.size === 0) {
      el.calNote.textContent = 'No available times this month.';
    } else {
      el.calNote.textContent = '';
    }
  }

  el.grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.booking-day.is-available');
    if (!btn) return;
    selectDay(btn.dataset.day);
    // Stacked layout (narrow screens): bring the times into view.
    const label = el.dayLabel.getBoundingClientRect();
    if (label.top > btn.getBoundingClientRect().bottom && label.top > window.innerHeight - 160) {
      el.dayLabel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  el.grid.addEventListener('keydown', (e) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in steps)) return;
    const days = Array.from(el.grid.querySelectorAll('.booking-day.is-available'));
    const index = days.indexOf(document.activeElement);
    if (index === -1) return;
    e.preventDefault();

    const current = parseDayKey(days[index].dataset.day).day;
    const target = current + steps[e.key];
    const forward = steps[e.key] > 0;
    const next = forward
      ? days.find((d) => parseDayKey(d.dataset.day).day >= target)
      : days.slice().reverse().find((d) => parseDayKey(d.dataset.day).day <= target);
    if (!next) return;
    days[index].tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  });

  function selectDay(key) {
    state.selectedDay = key;
    state.selectedSlot = null;
    renderCalendar();
    renderTimes();
    const focusTarget = el.grid.querySelector(`[data-day="${key}"]`);
    if (focusTarget) focusTarget.focus();
  }

  // ---- Times ------------------------------------------------------------------

  function renderTimes() {
    const frag = document.createDocumentFragment();

    el.slots.removeAttribute('aria-busy');
    if (state.loading) {
      // Placeholder slots while times load; the calendar note announces it.
      el.dayLabel.textContent = 'Available times';
      el.slots.setAttribute('aria-busy', 'true');
      for (let i = 0; i < 6; i += 1) {
        const ghost = document.createElement('div');
        ghost.className = 'booking-slot-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        frag.appendChild(ghost);
      }
      el.slots.replaceChildren(frag);
      return;
    }

    if (state.loadError) {
      el.dayLabel.textContent = 'Available times';
      const wrap = document.createElement('div');
      wrap.className = 'booking-slots-error';
      wrap.appendChild(note(state.loadError.message || 'We could not load available times.'));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'booking-link';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => loadMonth({ force: true }));
      wrap.appendChild(retry);
      el.slots.replaceChildren(wrap);
      return;
    }

    const byDay = slotsForView();

    if (!state.selectedDay) {
      el.dayLabel.textContent = 'Select a date';
      if (byDay.size === 0) {
        const wrap = document.createElement('div');
        wrap.appendChild(note('Nothing open in this month.'));
        if (monthOffset(state.view) < MONTHS_AHEAD) {
          const nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'booking-link';
          nextBtn.textContent = 'See next month';
          nextBtn.addEventListener('click', () => goToMonth(1));
          wrap.appendChild(nextBtn);
        }
        el.slots.replaceChildren(wrap);
        return;
      }
      const first = Array.from(byDay.keys()).sort()[0];
      const wrap = document.createElement('div');
      wrap.appendChild(note('Choose a highlighted date to see open times.'));
      const firstBtn = document.createElement('button');
      firstBtn.type = 'button';
      firstBtn.className = 'booking-link';
      firstBtn.textContent = `First available: ${formatDayShort(first)}`;
      firstBtn.addEventListener('click', () => selectDay(first));
      wrap.appendChild(firstBtn);
      el.slots.replaceChildren(wrap);
      return;
    }

    el.dayLabel.textContent = formatDayLong(state.selectedDay);
    const times = byDay.get(state.selectedDay) || [];
    if (!times.length) {
      el.slots.replaceChildren(note('No times left on this date. Please choose another.'));
      return;
    }

    times.forEach((iso, i) => {
      const item = document.createElement('div');
      item.setAttribute('role', 'listitem');
      item.className = 'booking-slot-item';
      item.style.setProperty('--i', String(i));
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-slot';
      btn.textContent = formatTime(iso);
      btn.dataset.slot = iso;
      btn.setAttribute('aria-label', `${formatTime(iso)}, ${formatDayLong(state.selectedDay)}`);
      item.appendChild(btn);
      frag.appendChild(item);
    });
    el.slots.replaceChildren(frag);
  }

  function note(text) {
    const p = document.createElement('p');
    p.className = 'booking-note';
    p.textContent = text;
    return p;
  }

  el.slots.addEventListener('click', (e) => {
    const btn = e.target.closest('.booking-slot');
    if (!btn) return;
    state.selectedSlot = btn.dataset.slot;
    showDetails();
  });

  // ---- Details step -----------------------------------------------------------

  function showDetails() {
    showStatus(null);
    renderSummary();
    el.pick.hidden = true;
    el.form.hidden = false;
    playAnimation(el.form, 'is-entering');
    el.summaryWhen.focus();
  }

  function showPicker() {
    state.selectedSlot = null;
    el.form.hidden = true;
    el.pick.hidden = false;
    playAnimation(el.pick, 'is-entering');
    renderCalendar();
    renderTimes();
  }

  el.change.addEventListener('click', () => {
    showStatus(null);
    showPicker();
    const day = state.selectedDay && el.grid.querySelector(`[data-day="${state.selectedDay}"]`);
    if (day) day.focus();
  });

  function renderSummary() {
    if (!state.selectedSlot) return;
    const start = new Date(state.selectedSlot);
    const duration = state.event && state.event.duration;
    const startText = formatTime(state.selectedSlot);
    const endText = duration ? formatTime(new Date(start.getTime() + duration * 60000).toISOString()) : '';
    el.summaryWhen.textContent =
      `${formatDayLong(dayKeyIn(start, state.tz))} · ${startText}${endText ? ` – ${endText}` : ''}`;

    const meta = [tzLabel(state.tz)];
    if (duration) meta.push(`${duration} minutes`);
    if (state.event && state.event.locations.length === 1) meta.push(state.event.locations[0].label);
    el.summaryMeta.textContent = meta.join(' · ');
  }

  // Extra fields come from the Calendly event: a meeting-location choice (if
  // the event offers several) and any custom booking questions.
  function renderExtraFields() {
    const ev = state.event;
    const frag = document.createDocumentFragment();

    if (ev.locations.length > 1) {
      const fieldset = makeFieldset('Meeting location', 'location', true);
      ev.locations.forEach((loc) => {
        fieldset.appendChild(makeChoice('radio', 'location', String(loc.id), loc.detail ? `${loc.label} — ${loc.detail}` : loc.label));
      });
      fieldset.appendChild(makeError('location'));
      frag.appendChild(fieldset);
    }
    if (ev.locations.some((loc) => loc.input)) {
      frag.appendChild(makeLocationInput());
    }

    ev.questions.forEach((q) => frag.appendChild(makeQuestion(q)));
    el.extra.replaceChildren(frag);
    syncLocationInput();
  }

  function makeError(id) {
    const p = document.createElement('p');
    p.className = 'field-error';
    p.id = `booking-${id}-error`;
    p.hidden = true;
    return p;
  }

  function makeFieldset(legendText, id, required) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'field booking-choices';
    fieldset.dataset.field = id;
    fieldset.setAttribute('aria-describedby', `booking-${id}-error`);
    const legend = document.createElement('legend');
    legend.textContent = required ? legendText : `${legendText} (optional)`;
    fieldset.appendChild(legend);
    return fieldset;
  }

  function makeChoice(type, name, value, labelText) {
    const label = document.createElement('label');
    label.className = 'booking-choice';
    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.value = value;
    const span = document.createElement('span');
    span.textContent = labelText;
    label.append(input, span);
    return label;
  }

  function makeTextField(id, labelText, { type = 'text', multiline = false, required = false, placeholder = '', autocomplete = '' } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.dataset.field = id;
    const label = document.createElement('label');
    label.htmlFor = `booking-${id}`;
    label.textContent = required ? labelText : `${labelText} (optional)`;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = type;
    input.id = `booking-${id}`;
    input.name = id;
    input.maxLength = multiline ? 10000 : 1000;
    if (placeholder) input.placeholder = placeholder;
    if (autocomplete) input.autocomplete = autocomplete;
    input.setAttribute('aria-describedby', `booking-${id}-error`);
    wrap.append(label, input, makeError(id));
    return wrap;
  }

  function makeLocationInput() {
    const wrap = makeTextField('location-value', 'Where should we meet?', { required: true });
    wrap.classList.add('booking-location-value');
    return wrap;
  }

  function makeQuestion(q) {
    const id = `question-${q.position}`;
    if (q.type === 'single_select' || q.type === 'multi_select') {
      const fieldset = makeFieldset(q.name, id, q.required);
      const type = q.type === 'single_select' ? 'radio' : 'checkbox';
      q.choices.forEach((choice) => fieldset.appendChild(makeChoice(type, id, choice, choice)));
      if (q.includeOther) {
        fieldset.appendChild(makeChoice(type, id, '__other__', 'Other'));
        const other = document.createElement('input');
        other.type = 'text';
        other.className = 'booking-other';
        other.name = `${id}-other`;
        other.maxLength = 1000;
        other.placeholder = 'Please specify';
        other.setAttribute('aria-label', `${q.name} — other`);
        fieldset.appendChild(other);
      }
      fieldset.appendChild(makeError(id));
      return fieldset;
    }
    return makeTextField(id, q.name, {
      type: q.type === 'phone_number' ? 'tel' : 'text',
      multiline: q.type === 'text',
      required: q.required,
      placeholder: q.type === 'phone_number' ? '+44 20 7692 5259' : '',
      autocomplete: q.type === 'phone_number' ? 'tel' : '',
    });
  }

  function selectedLocation() {
    const locs = state.event ? state.event.locations : [];
    if (locs.length === 1) return locs[0];
    const checked = el.extra.querySelector('input[name="location"]:checked');
    return checked ? locs[Number(checked.value)] : null;
  }

  function syncLocationInput() {
    const wrap = el.extra.querySelector('.booking-location-value');
    if (!wrap) return;
    const loc = selectedLocation();
    const input = wrap.querySelector('input');
    const label = wrap.querySelector('label');
    wrap.hidden = !(loc && loc.input);
    if (loc && loc.input === 'phone') {
      label.textContent = 'Phone number to call';
      input.type = 'tel';
      input.autocomplete = 'tel';
      input.placeholder = '+44 20 7692 5259';
    } else {
      label.textContent = 'Where should we meet?';
      input.type = 'text';
      input.autocomplete = 'off';
      input.placeholder = '';
    }
  }

  el.extra.addEventListener('change', (e) => {
    if (e.target.name === 'location') syncLocationInput();
    clearError(e.target.closest('[data-field]'));
  });

  // ---- Validation ---------------------------------------------------------------

  function setError(field, message) {
    const container = field && (field.closest('[data-field]') || field.closest('.field'));
    const errorEl = container && container.querySelector('.field-error');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    container.classList.add('has-error');
    const input = container.querySelector('input, textarea');
    if (input && container.tagName !== 'FIELDSET') input.setAttribute('aria-invalid', 'true');
  }

  function clearError(container) {
    if (!container) return;
    const errorEl = container.querySelector('.field-error');
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    container.classList.remove('has-error');
    container.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid'));
  }

  function validateName() {
    const value = el.name.value.trim();
    if (!value) return 'Please enter your full name.';
    if (value.length > 100) return 'Please keep your name under 100 characters.';
    return '';
  }

  function validateEmail() {
    const value = el.email.value.trim();
    if (!value) return 'Please enter your email address.';
    if (!EMAIL_PATTERN.test(value) || value.length > 254) return 'Please enter a valid email address, e.g. jane@company.com.';
    if (!isCompanyEmail(value)) return 'Please use your company email address rather than a personal one.';
    return '';
  }

  function parseGuests() {
    return el.guests.value.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
  }

  function validateGuests() {
    const guests = parseGuests();
    if (guests.length > MAX_GUESTS) return `You can add up to ${MAX_GUESTS} guests.`;
    const invalid = guests.filter((g) => !EMAIL_PATTERN.test(g) || g.length > 254);
    if (invalid.length) return `Please check: ${invalid.join(', ')}`;
    return '';
  }

  el.addGuests.addEventListener('click', () => {
    const open = el.guestsField.hidden;
    el.guestsField.hidden = !open;
    el.addGuests.setAttribute('aria-expanded', String(open));
    el.addGuests.textContent = open ? '− Remove guests' : '+ Add guests';
    if (open) {
      el.guests.focus();
    } else {
      el.guests.value = '';
      clearError(el.guestsField);
    }
  });

  [[el.name, validateName], [el.email, validateEmail], [el.guests, validateGuests]].forEach(([input, validate]) => {
    input.addEventListener('blur', () => {
      if (!input.value.trim()) return; // don't nag on an untouched field
      const message = validate();
      if (message) setError(input, message);
    });
    input.addEventListener('input', () => clearError(input.closest('.field')));
  });

  el.extra.addEventListener('input', (e) => clearError(e.target.closest('[data-field]')));

  // Collects answers and returns { errors: [[element, message]], payload }.
  function collect() {
    const errors = [];
    const nameError = validateName();
    if (nameError) errors.push([el.name, nameError]);
    const emailError = validateEmail();
    if (emailError) errors.push([el.email, emailError]);
    const guestsError = el.guestsField.hidden ? '' : validateGuests();
    if (guestsError) errors.push([el.guests, guestsError]);

    // Drop duplicates and the visitor's own address.
    const own = el.email.value.trim().toLowerCase();
    const guests = el.guestsField.hidden ? [] : [...new Set(parseGuests().map((g) => g.toLowerCase()))]
      .filter((g) => g !== own);

    const payload = {
      start: state.selectedSlot,
      name: el.name.value.trim(),
      email: el.email.value.trim(),
      timezone: state.tz,
      website: el.website.value,
      guests,
      answers: [],
    };

    const ev = state.event;
    if (ev && ev.locations.length) {
      const loc = selectedLocation();
      if (!loc) {
        errors.push([el.extra.querySelector('[data-field="location"] input'), 'Please choose how you would like to meet.']);
      } else {
        payload.locationId = loc.id;
        if (loc.input) {
          const input = el.extra.querySelector('#booking-location-value');
          const value = input.value.trim();
          const valid = loc.input === 'phone' ? PHONE_PATTERN.test(value) : value.length > 0;
          if (!valid) {
            errors.push([input, loc.input === 'phone'
              ? 'Please enter a phone number with country code, e.g. +44 20 7692 5259.'
              : 'Please tell us where you would like to meet.']);
          }
          payload.locationValue = value;
        }
      }
    }

    (ev ? ev.questions : []).forEach((q) => {
      const id = `question-${q.position}`;
      const container = el.extra.querySelector(`[data-field="${id}"]`);
      let answer;
      if (q.type === 'single_select' || q.type === 'multi_select') {
        const checked = Array.from(container.querySelectorAll(`input[name="${id}"]:checked`)).map((i) => i.value);
        const otherText = (container.querySelector('.booking-other') || { value: '' }).value.trim();
        const values = checked.map((v) => (v === '__other__' ? otherText : v)).filter(Boolean);
        if (checked.includes('__other__') && !otherText) {
          errors.push([container.querySelector('input'), 'Please specify your answer.']);
        }
        answer = q.type === 'single_select' ? values[0] || '' : values;
        if (q.required && !values.length) errors.push([container.querySelector('input'), 'Please choose an option.']);
      } else {
        const input = container.querySelector('input, textarea');
        answer = input.value.trim();
        if (q.required && !answer) errors.push([input, 'This field is required.']);
        else if (answer && q.type === 'phone_number' && !PHONE_PATTERN.test(answer)) {
          errors.push([input, 'Please enter a phone number with country code, e.g. +44 20 7692 5259.']);
        }
      }
      payload.answers.push({ position: q.position, answer });
    });

    return { errors, payload };
  }

  // ---- Submit -----------------------------------------------------------------

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.submitting) return;
    showStatus(null);
    el.form.querySelectorAll('.has-error').forEach(clearError);

    if (!state.selectedSlot) {
      showPicker();
      return;
    }

    // The event's location options and questions must be known before booking.
    if (!state.event) {
      await loadEvent();
      if (!state.event) {
        if (el.status.hidden) showStatus('We could not load the booking details. Please try again.', 'error');
        return;
      }
    }

    const { errors, payload } = collect();
    if (errors.length) {
      errors.forEach(([field, message]) => setError(field, message));
      if (errors[0][0]) errors[0][0].focus();
      return;
    }

    state.submitting = true;
    el.submit.disabled = true;
    el.change.disabled = true;
    el.form.setAttribute('aria-busy', 'true');
    const originalText = el.submit.textContent;
    el.submit.textContent = 'Booking…';

    const res = await request(API.book, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    state.submitting = false;
    el.submit.disabled = false;
    el.change.disabled = false;
    el.form.removeAttribute('aria-busy');
    el.submit.textContent = originalText;

    if (res.ok && res.data && res.data.booking) {
      onBooked(res.data.booking);
      return;
    }

    const err = res.error;
    if (err.code === 'slot_unavailable') {
      // Keep the visitor's details; refresh times so they can pick again.
      state.months.delete(monthKey(state.view.year, state.view.month));
      showPicker();
      showStatus(err.message, 'warning');
      loadMonth({ force: true });
      return;
    }
    if (err.code === 'not_configured') {
      showUnavailable(err.message);
      return;
    }
    if (err.field) {
      const target = err.field === 'guests' ? el.guests
        : err.field === 'name' ? el.name
        : err.field === 'email' ? el.email
          : el.extra.querySelector(`[data-field="${err.field}"] input, [data-field="${err.field}"] textarea`)
            || el.extra.querySelector('#booking-location-value');
      if (target) {
        setError(target, err.message);
        target.focus();
        return;
      }
    }
    showStatus(err.message, 'error');
  });

  function onBooked(booking) {
    el.form.reset();
    el.guestsField.hidden = true;
    el.addGuests.setAttribute('aria-expanded', 'false');
    el.addGuests.textContent = '+ Add guests';
    el.form.hidden = true;
    el.pick.hidden = true;
    state.selectedSlot = null;
    state.selectedDay = null;
    state.months.clear();

    const done = document.createElement('div');
    done.className = 'booking-done';
    const p = document.createElement('p');
    p.className = 'booking-note';
    p.textContent = `Booked for ${formatDayLong(dayKeyIn(new Date(booking.start), booking.timezone))}. ` +
      `Details are on their way to ${booking.email}.`;
    done.appendChild(p);
    if (booking.rescheduleUrl) {
      const a = document.createElement('a');
      a.className = 'booking-link';
      a.href = booking.rescheduleUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Need to reschedule?';
      done.appendChild(a);
    }
    root.appendChild(done);

    document.dispatchEvent(new CustomEvent('booking:confirmed', { detail: booking }));
  }

  // ---- Init -------------------------------------------------------------------

  renderTimeZones();
  state.view = currentMonth();
  loadEvent();
  loadMonth();
})();
