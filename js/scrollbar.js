// Viewport scrollbar theme: blue on light bg, gold on dark bg (smooth blend)
(function () {
  const root = document.documentElement;
  const DURATION = 420;

  const THEMES = {
    light: {
      thumb: { r: 18, g: 43, b: 79 },       // --prussian
      hover: { r: 28, g: 58, b: 95 },       // --admiralty
      track: { r: 240, g: 235, b: 225 },    // --parchment-deep
    },
    dark: {
      thumb: { r: 184, g: 150, b: 58 },     // --antique-gold
      hover: { r: 212, g: 174, b: 92 },     // --burnished-gold
      track: { r: 10, g: 26, b: 51 },       // --prussian-deep
    },
  };

  let ticking = false;
  let lastMode = null;
  let rafId = 0;
  let current = {
    thumb: { ...THEMES.light.thumb },
    hover: { ...THEMES.light.hover },
    track: { ...THEMES.light.track },
  };

  function cssRgb({ r, g, b }) {
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }

  function paint(state) {
    root.style.setProperty('--sb-thumb', cssRgb(state.thumb));
    root.style.setProperty('--sb-thumb-hover', cssRgb(state.hover));
    root.style.setProperty('--sb-track', cssRgb(state.track));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRgb(a, b, t) {
    return {
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t),
    };
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function animateTo(mode) {
    const target = THEMES[mode];
    const from = {
      thumb: { ...current.thumb },
      hover: { ...current.hover },
      track: { ...current.track },
    };
    if (rafId) cancelAnimationFrame(rafId);
    const start = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - start) / DURATION);
      const e = easeInOut(t);
      current = {
        thumb: lerpRgb(from.thumb, target.thumb, e),
        hover: lerpRgb(from.hover, target.hover, e),
        track: lerpRgb(from.track, target.track, e),
      };
      paint(current);
      if (t < 1) rafId = requestAnimationFrame(frame);
      else rafId = 0;
    }

    rafId = requestAnimationFrame(frame);
  }

  function parseRgb(value) {
    if (!value || value === 'transparent') return null;
    const m = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (a < 0.15) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }

  function luminance({ r, g, b }) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function backgroundBehind(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.nodeType === 1) {
        const rgb = parseRgb(getComputedStyle(node).backgroundColor);
        if (rgb) return rgb;
      }
      node = node.parentElement;
    }
    return parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 250, g: 247, b: 242 };
  }

  function sampleMode() {
    const x = Math.min(window.innerWidth - 24, Math.floor(window.innerWidth * 0.72));
    const y = Math.floor(window.innerHeight * 0.5);
    let el = document.elementFromPoint(x, y);
    if (!el || el === document.documentElement || el === document.body) {
      el = document.elementFromPoint(Math.floor(window.innerWidth * 0.5), y) || document.body;
    }
    const rgb = backgroundBehind(el);
    return luminance(rgb) < 0.42 ? 'dark' : 'light';
  }

  function apply(mode, instant) {
    if (mode === lastMode) return;
    lastMode = mode;
    root.classList.toggle('scrollbar-on-dark', mode === 'dark');
    root.classList.toggle('scrollbar-on-light', mode === 'light');
    if (instant) {
      current = {
        thumb: { ...THEMES[mode].thumb },
        hover: { ...THEMES[mode].hover },
        track: { ...THEMES[mode].track },
      };
      paint(current);
      return;
    }
    animateTo(mode);
  }

  function update() {
    ticking = false;
    apply(sampleMode(), false);
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  const locked = root.getAttribute('data-scrollbar');
  if (locked === 'dark' || locked === 'light') {
    apply(locked, true);
    return;
  }

  apply(sampleMode(), true);
  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
})();
