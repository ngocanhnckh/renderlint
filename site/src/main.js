(function () {
  // Copy buttons
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var s = b.querySelector('span');
    var old = s.textContent;
    function say(t) {
      s.textContent = t;
      b.classList.add('said');
      setTimeout(function () { s.textContent = old; b.classList.remove('said'); }, 1800);
    }
    // When the clipboard isn't available (permission denied, not a secure origin), select the command instead.
    function fallback() {
      var code = b.parentNode.querySelector('code');
      var r = document.createRange();
      r.selectNodeContents(code);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      say('Press Ctrl+C');
    }
    if (!navigator.clipboard) { fallback(); return; }
    navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () { say('Copied'); }, fallback);
  });

  // Scroll reveals: blocks below the fold fade up as they enter the viewport, siblings staggered.
  // Nothing is hidden without JS, with reduced motion, or if it is already on screen at load.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    var sel = '.section-head,.define>div,.facts>div,.logos li,.grid-2>*,.pairs>*,.table-wrap,.steps>li,.results .big>div,.results figure,.gates>.gate,.faq>div,.posts>*,.cta .wrap>*,.rule,.related,.prose>figure,.prose>pre,.prose>.callout';
    var io = new IntersectionObserver(function (entries) {
      var batch = entries.filter(function (en) { return en.isIntersecting; });
      batch.forEach(function (en, i) {
        var el = en.target;
        el.style.setProperty('--d', Math.min(i, 6) * 0.08 + 's');
        el.classList.add('in');
        io.unobserve(el);
        // Back to plain styles once shown, so hover transitions work as written.
        setTimeout(function () { el.classList.remove('rv', 'in'); el.style.removeProperty('--d'); }, 1400 + i * 80);
      });
    }, { rootMargin: '0px 0px -48px 0px', threshold: 0 });
    var vh = window.innerHeight;
    document.querySelectorAll(sel).forEach(function (el) {
      if (el.parentElement.closest('.rv') || el.getBoundingClientRect().top < vh) return;
      el.classList.add('rv');
      io.observe(el);
    });
  }

  // Hero clip: the poster is the page's image; the video loads only after the page has loaded,
  // never on Save-Data, and never plays by itself when the user prefers reduced motion.
  var card = document.querySelector('[data-clip]');
  if (!card) return;
  var btn = card.querySelector('.play');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var saveData = navigator.connection && navigator.connection.saveData;
  var video = null;
  var playIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  function label(playing) {
    btn.innerHTML = (playing ? pauseIcon : playIcon) + '<span>' + (playing ? 'Pause animation' : 'Play animation') + '</span>';
    btn.hidden = false;
  }
  function load(autoplay) {
    if (video) return video;
    video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.preload = 'auto';
    video.poster = card.getAttribute('data-poster');
    ['webm', 'mp4'].forEach(function (t) {
      var s = document.createElement('source');
      s.src = card.getAttribute('data-' + t);
      s.type = 'video/' + t;
      video.appendChild(s);
    });
    video.style.opacity = '0';
    video.style.transition = 'opacity .4s';
    video.addEventListener('playing', function () { video.style.opacity = '1'; label(true); });
    video.addEventListener('pause', function () { label(false); });
    card.insertBefore(video, btn);
    if (autoplay) video.play().catch(function () { label(false); });
    return video;
  }
  btn.addEventListener('click', function () {
    var v = load(false);
    if (v.paused) v.play(); else v.pause();
  });
  if (reduce.matches || saveData) { label(false); return; }
  var start = function () { (window.requestIdleCallback || setTimeout)(function () { load(true); }, { timeout: 2000 }); };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
})();
