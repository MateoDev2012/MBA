/**
 * Site chrome, shared by every page of the site, so it is a single file instead
 * of a copy in each HTML document.
 *
 * It handles the things that are decoration rather than content: the theme
 * toggle, copy-to-clipboard on code blocks, tabs, the mobile menu, the "on this
 * page" highlighting, the reading progress bar and the scroll reveal.
 *
 * Everything here is progressive enhancement. The only exception is the `js`
 * class on <html>, which the reveal animation needs: without it, the animated
 * elements are visible from the start instead of invisible forever.
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'rbx-theme';
  var root = document.documentElement;
  root.classList.add('js');

  // --- Theme -----------------------------------------------------------------

  function currentTheme() {
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) { /* private mode */ }
    var btn = document.querySelector('[data-theme-toggle]');
    if (btn) btn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
  }

  function initTheme() {
    var btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
      btn.addEventListener('click', function () {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
      });
    }
    // Exposed so a page can force a theme (the widget demo, for example).
    window.RbxTheme = { get: currentTheme, set: applyTheme };
  }

  // --- Copy to clipboard -----------------------------------------------------

  function copyText(text) {
    // navigator.clipboard needs a secure context, so there is a fallback for
    // people testing on http://192.168.x.x instead of localhost.
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy not allowed'));
    });
  }

  function initCopyButtons(scope) {
    var blocks = (scope || document).querySelectorAll('pre');
    Array.prototype.forEach.call(blocks, function (pre) {
      // A block may already be wrapped in the markup (or have been handled on
      // a previous call), so reuse the wrapper and never add two buttons.
      var box = pre.closest('.codeblock');
      if (!box) {
        box = document.createElement('div');
        box.className = 'codeblock';
        pre.parentNode.insertBefore(box, pre);
        box.appendChild(pre);
      }
      if (box.querySelector(':scope > .copy')) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy';
      btn.textContent = 'Copy';
      btn.setAttribute('aria-label', 'Copy code to clipboard');
      box.appendChild(btn);

      btn.addEventListener('click', function () {
        copyText(pre.innerText)
          .then(function () {
            btn.textContent = 'Copied';
            btn.classList.add('done');
            setTimeout(function () {
              btn.textContent = 'Copy';
              btn.classList.remove('done');
            }, 1600);
          })
          .catch(function () {
            btn.textContent = 'Press Ctrl+C';
            setTimeout(function () { btn.textContent = 'Copy'; }, 2200);
          });
      });
    });
  }

  // --- Tabs ------------------------------------------------------------------

  function initTabs() {
    var groups = document.querySelectorAll('[data-tabs]');
    Array.prototype.forEach.call(groups, function (group) {
      var tabs = Array.prototype.slice.call(group.querySelectorAll('[role="tab"]'));

      function select(tab) {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          if (panel) panel.hidden = !on;
        });
        try {
          localStorage.setItem('rbx-tab-' + group.dataset.tabs, tab.dataset.tab);
        } catch (_) { /* ignore */ }
      }

      tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () { select(tab); });
        tab.addEventListener('keydown', function (e) {
          var dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          var next = tabs[(i + dir + tabs.length) % tabs.length];
          next.focus();
          select(next);
        });
      });

      var saved = null;
      try { saved = localStorage.getItem('rbx-tab-' + group.dataset.tabs); } catch (_) { /* ignore */ }
      var initial = tabs.filter(function (t) { return t.dataset.tab === saved; })[0] || tabs[0];
      if (initial) select(initial);
    });
  }

  // --- Navigation -----------------------------------------------------------

  /** One nav can appear twice (desktop bar + mobile sheet), so every match of
   *  the current page's href is marked, not just the first. */
  function initActiveNav() {
    var here = location.pathname.replace(/\/+$/, '') || '/';
    var links = document.querySelectorAll('.nav a[href], .mobilenav a[href]');
    Array.prototype.forEach.call(links, function (link) {
      var href;
      try { href = new URL(link.getAttribute('href'), location.href); } catch (_) { return; }
      if (href.origin !== location.origin) return;
      var path = href.pathname.replace(/\/+$/, '') || '/';
      // A link to "/docs" is also the active one while sitting on "/docs.html",
      // because the static handler serves both and people bookmark either.
      if (path === here || path + '.html' === here) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  function initMobileNav() {
    var btn = document.querySelector('[data-menu-toggle]');
    var panel = document.getElementById('mobileNav');
    if (!btn || !panel) return;

    function close() {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      panel.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { close(); btn.focus(); }
    });
    // A resize past the breakpoint hides the bar that is no longer shown, so the
    // open panel does not stay open behind the desktop nav.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && !panel.hidden) close();
    });
  }

  // --- "On this page" highlighting -----------------------------------------

  function initScrollspy() {
    var groups = document.querySelectorAll('[data-toc]');
    if (!groups.length || !('IntersectionObserver' in window)) return;

    Array.prototype.forEach.call(groups, function (group) {
      var links = Array.prototype.slice.call(group.querySelectorAll('a[href^="#"]'));
      var map = {};
      var targets = [];
      links.forEach(function (link) {
        var el = document.querySelector(link.getAttribute('href'));
        if (el) { map[el.id] = link; targets.push(el); }
      });
      if (!targets.length) return;

      var visible = new Set();
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) visible.add(entry.target.id);
            else visible.delete(entry.target.id);
          });
          // The topmost visible section wins, so the label matches what you read.
          var active = targets.filter(function (t) { return visible.has(t.id); })[0];
          links.forEach(function (l) { l.classList.remove('active'); });
          if (active && map[active.id]) map[active.id].classList.add('active');
        },
        { rootMargin: '-72px 0px -62% 0px', threshold: 0 }
      );
      targets.forEach(function (t) { observer.observe(t); });
    });
  }

  // --- Reading progress -----------------------------------------------------

  function initProgress() {
    var bar = document.querySelector('[data-progress]');
    if (!bar) return;

    var ticking = false;
    function update() {
      ticking = false;
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      bar.style.width = (scrollable > 40 ? Math.min(100, (window.scrollY / scrollable) * 100) : 0) + '%';
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // --- Reveal on scroll -----------------------------------------------------

  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.04 }
    );
    Array.prototype.forEach.call(items, function (el) { observer.observe(el); });
  }

  // --- Footer year ----------------------------------------------------------

  function initYear() {
    var slots = document.querySelectorAll('[data-year]');
    var y = String(new Date().getFullYear());
    Array.prototype.forEach.call(slots, function (el) { el.textContent = y; });
  }

  function init() {
    initTheme();
    initCopyButtons();
    initTabs();
    initActiveNav();
    initMobileNav();
    initScrollspy();
    initProgress();
    initReveal();
    initYear();
    // So a page that injects markup at runtime (the playground) can give the
    // new code blocks their copy buttons too.
    window.RbxSite = { enhance: function (scope) { initCopyButtons(scope); } };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
