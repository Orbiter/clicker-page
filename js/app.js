(function () {
  'use strict';

  var app = document.getElementById('app');
  var dropzone = document.getElementById('dropzone');
  var slideWrap = document.getElementById('slideWrap');
  var slideEl = document.getElementById('slide');
  var pagerEl = document.getElementById('pager');
  var sourceLabelEl = document.getElementById('sourceLabel');

  var slides = [];
  var currentIndex = 0;
  var touchStartX = 0;
  var touchStartY = 0;
  var dragDepth = 0;
  var currentBaseUrl = window.location.href;

  function renderMarkdown(markdown) {
    if (window.ClickerMarkdownRenderer && typeof window.ClickerMarkdownRenderer.render === 'function') {
      return window.ClickerMarkdownRenderer.render(markdown);
    }
    return '<pre><code>Markdown renderer missing.</code></pre>';
  }

  function splitSlides(markdown) {
    var lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    var chunks = [];
    var current = [];

    function pushCurrent() {
      var text = current.join('\n').trim();
      if (text) chunks.push(text);
      current = [];
    }

    lines.forEach(function (line, index) {
      var isRule = /^\s*([-*_])\1{2,}\s*$/.test(line);
      var isH1H2 = /^\s*#{1,2}\s+/.test(line);

      if (isRule) {
        pushCurrent();
        return;
      }

      if (isH1H2 && current.join('\n').trim() && index !== 0) {
        pushCurrent();
      }

      current.push(line);
    });

    pushCurrent();

    if (!chunks.length) {
      var fallback = String(markdown || '').trim();
      if (fallback) chunks.push(fallback);
    }

    return chunks;
  }

  function updateView() {
    var total = slides.length;

    if (!total) {
      slideWrap.style.display = 'none';
      pagerEl.style.display = 'none';
      dropzone.style.display = 'flex';
      return;
    }

    currentIndex = Math.max(0, Math.min(currentIndex, total - 1));
    slideEl.innerHTML = renderMarkdown(slides[currentIndex]);
    resolveRelativeAssets(slideEl, currentBaseUrl);
    slideEl.scrollTop = 0;

    dropzone.style.display = 'none';
    slideWrap.style.display = 'block';
    pagerEl.style.display = 'block';
    pagerEl.textContent = String(currentIndex + 1) + ' / ' + String(total);
  }

  function goNext() {
    if (currentIndex < slides.length - 1) {
      currentIndex += 1;
      updateView();
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex -= 1;
      updateView();
    }
  }

  function loadMarkdown(markdown, sourceLabel, baseUrl) {
    var trimmed = String(markdown || '').trim();
    if (!trimmed) return;

    slides = splitSlides(trimmed);
    currentIndex = 0;
    sourceLabelEl.textContent = sourceLabel || '';
    currentBaseUrl = baseUrl || window.location.href;
    updateView();
  }

  function looksLikeUrl(value) {
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
      return false;
    }
  }

  async function loadFromUrl(url) {
    var response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error('HTTP ' + String(response.status) + ' while loading URL');
    }
    var text = await response.text();
    loadMarkdown(text, url, url);
  }

  function normalizeDroppedUri(uriText) {
    return uriText
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line && line[0] !== '#'; })[0] || '';
  }

  function canBeBaseUrl(value) {
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
    } catch (_error) {
      return false;
    }
  }

  function extractDroppedUrl(dt) {
    var uriList = normalizeDroppedUri(dt.getData('text/uri-list'));
    if (uriList) return uriList;

    var mozUrl = dt.getData('text/x-moz-url');
    if (mozUrl) {
      var firstMozLine = mozUrl.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)[0] || '';
      if (looksLikeUrl(firstMozLine)) return firstMozLine;
    }

    var plainText = dt.getData('text/plain').trim();
    if (!plainText) return '';
    var firstPlainLine = plainText.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)[0] || '';
    if (looksLikeUrl(firstPlainLine)) return firstPlainLine;

    return '';
  }

  function looksRelativePath(value) {
    if (!value) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
    if (value.startsWith('//')) return false;
    if (value.startsWith('#')) return false;
    if (value.startsWith('mailto:')) return false;
    if (value.startsWith('tel:')) return false;
    return true;
  }

  function resolveRelativeAssets(rootEl, baseUrl) {
    if (!baseUrl) return;

    rootEl.querySelectorAll('img[src]').forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (!looksRelativePath(src)) return;
      try {
        img.setAttribute('src', new URL(src, baseUrl).href);
      } catch (_error) {}
    });

    rootEl.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!looksRelativePath(href)) return;
      try {
        a.setAttribute('href', new URL(href, baseUrl).href);
      } catch (_error) {}
    });
  }

  function handleDragEnterOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    if (event.type === 'dragenter') {
      dragDepth += 1;
    }
    dropzone.classList.add('dragging');
  }

  function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      dropzone.classList.remove('dragging');
    }
  }

  window.addEventListener('dragenter', handleDragEnterOver, true);
  window.addEventListener('dragover', handleDragEnterOver, true);
  window.addEventListener('dragleave', handleDragLeave, true);

  async function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    dropzone.classList.remove('dragging');

    var dt = event.dataTransfer;
    if (!dt) return;

    try {
      if (dt.files && dt.files.length > 0) {
        var file = dt.files[0];
        var fileText = await file.text();
        var fileUri = normalizeDroppedUri(dt.getData('text/uri-list'));
        var baseForFile = '';
        if (fileUri && canBeBaseUrl(fileUri)) {
          try {
            baseForFile = new URL('.', fileUri).href;
          } catch (_error) {}
        }
        loadMarkdown(fileText, file.name || 'local file', baseForFile || window.location.href);
        return;
      }

      var plainText = dt.getData('text/plain').trim();
      var droppedUrl = extractDroppedUrl(dt);
      var droppedText = droppedUrl || plainText;

      if (!droppedText) return;

      if (droppedUrl || looksLikeUrl(droppedText)) {
        await loadFromUrl(droppedText);
      } else {
        loadMarkdown(droppedText, 'dropped text', window.location.href);
      }
    } catch (error) {
      var message = error instanceof Error ? error.message : String(error);
      loadMarkdown('# Load error\n\nCould not load dropped content.\n\n`' + message + '`', 'error', window.location.href);
    }
  }

  window.addEventListener('drop', handleDrop, true);

  window.addEventListener('keydown', function (event) {
    if (!slides.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      goNext();
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      goPrev();
    }
  }, { passive: false });

  app.addEventListener('touchstart', function (event) {
    var touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  app.addEventListener('touchend', function (event) {
    if (!slides.length) return;

    var touch = event.changedTouches[0];
    var dx = touch.clientX - touchStartX;
    var dy = touch.clientY - touchStartY;

    if (Math.abs(dx) < 35 && Math.abs(dy) < 35) return;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx < 0) goNext();
      else goPrev();
    } else {
      if (dy < 0) goNext();
      else goPrev();
    }
  }, { passive: true });

  loadMarkdown(
    '# clicker.page\n\nDrop a markdown file or URL onto this page.\n\n---\n\n## Navigation\n\n- Arrow right/down: next slide\n- Arrow left/up: previous slide\n- Swipe: next/previous on mobile',
    'welcome'
  );
})();
