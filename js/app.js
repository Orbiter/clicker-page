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
  var mermaidReady = false;
  var mermaidRenderCount = 0;

  function renderMarkdown(markdown) {
    if (window.marked && typeof window.marked.parse === 'function') {
      return window.marked.parse(markdown || '');
    }
    return '<pre><code>Markdown renderer missing.</code></pre>';
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }

    var helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    document.execCommand('copy');
    document.body.removeChild(helper);
  }

  function createCopyButton(getText) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code-btn';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code to clipboard');

    button.addEventListener('click', async function () {
      var originalLabel = button.textContent;
      button.disabled = true;
      try {
        await copyToClipboard(getText());
        button.textContent = 'Copied';
      } catch (_error) {
        button.textContent = 'Error';
      }
      window.setTimeout(function () {
        button.textContent = originalLabel;
        button.disabled = false;
      }, 1200);
    });

    return button;
  }

  function looksLikeMermaid(text) {
    var firstLine = String(text || '').trim().split('\n')[0] || '';
    return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|xychart-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/.test(firstLine);
  }

  function isMermaidBlock(codeEl) {
    if (!codeEl) return false;
    var className = codeEl.className || '';
    if (/\blanguage-mermaid\b/.test(className)) return true;
    return looksLikeMermaid(codeEl.textContent || '');
  }

  function ensureMermaid() {
    if (!(window.mermaid && typeof window.mermaid.render === 'function')) return false;
    if (!mermaidReady) {
      window.mermaid.initialize({ startOnLoad: false });
      mermaidReady = true;
    }
    return true;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderMermaidBlocks(rootEl) {
    if (!ensureMermaid()) return;

    rootEl.querySelectorAll('pre > code').forEach(function (codeEl) {
      if (!isMermaidBlock(codeEl)) return;

      var pre = codeEl.parentElement;
      if (!pre || pre.dataset.mermaidEnhanced === '1') return;
      pre.dataset.mermaidEnhanced = '1';

      var source = codeEl.textContent || '';
      var wrapper = document.createElement('div');
      wrapper.className = 'mermaid-block';

      var graph = document.createElement('div');
      graph.className = 'mermaid-graph';
      wrapper.appendChild(graph);

      wrapper.appendChild(createCopyButton(function () { return source; }));
      pre.replaceWith(wrapper);

      var renderId = 'mermaid-diagram-' + String(mermaidRenderCount);
      mermaidRenderCount += 1;
      var settled = false;
      function setRendered(result) {
        if (settled) return;
        settled = true;
        if (result && typeof result.svg === 'string') {
          graph.innerHTML = result.svg;
          return;
        }
        if (typeof result === 'string') {
          graph.innerHTML = result;
          return;
        }
        graph.innerHTML = '<pre><code>' + escapeHtml(source) + '</code></pre>';
      }

      try {
        var maybeResult = window.mermaid.render(renderId, source, function (svg) {
          setRendered(svg);
        });

        if (maybeResult && typeof maybeResult.then === 'function') {
          maybeResult.then(function (result) {
            setRendered(result);
          }).catch(function () {
            setRendered(null);
          });
        } else if (typeof maybeResult !== 'undefined') {
          setRendered(maybeResult);
        } else {
          window.setTimeout(function () {
            if (!settled) setRendered(null);
          }, 300);
        }
      } catch (_error) {
        setRendered(null);
      }
    });
  }

  function enhanceCodeBlocks(rootEl) {
    rootEl.querySelectorAll('pre > code').forEach(function (codeEl) {
      var pre = codeEl.parentElement;
      if (!pre || pre.querySelector('.copy-code-btn')) return;
      pre.appendChild(createCopyButton(function () { return codeEl.textContent || ''; }));
    });
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

  function getSourceFromQuery() {
    try {
      var parsed = new URL(window.location.href);
      return (parsed.searchParams.get('source') || '').trim();
    } catch (_error) {
      return '';
    }
  }

  function updateSourceQuery(source) {
    if (!source) return;
    var nextHref = '';
    try {
      var parsed = new URL(window.location.href);
      parsed.searchParams.set('source', source);
      nextHref = parsed.toString();
    } catch (_prepError) {
      return;
    }

    try {
      window.history.replaceState({ source: source }, '', nextHref);
    } catch (_error) {
      // Ignore and fall through to hard navigation fallback.
    }

    var applied = false;
    try {
      applied = new URL(window.location.href).searchParams.get('source') === source;
    } catch (_verifyError) {}

    if (!applied) {
      try {
        window.location.replace(nextHref);
      } catch (_replaceError) {}
    }
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
    renderMermaidBlocks(slideEl);
    enhanceCodeBlocks(slideEl);
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

  function looksLikeLoadableSource(value) {
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
    } catch (_error) {
      return false;
    }
  }

  function toFileUrl(path) {
    var cleaned = String(path || '').trim();
    if (!cleaned) return '';
    if (/^file:\/\//i.test(cleaned)) return cleaned;
    var normalized = cleaned.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return 'file://' + encodeURI(normalized);
  }

  function looksLikeAbsolutePath(value) {
    var cleaned = String(value || '').trim();
    if (!cleaned) return false;
    if (cleaned.startsWith('/')) return true;
    return /^[A-Za-z]:[\\/]/.test(cleaned);
  }

  function getDroppedFileSource(file, dt) {
    var uriList = normalizeDroppedUri(dt.getData('text/uri-list'));
    if (uriList && looksLikeLoadableSource(uriList)) return uriList;

    var mozUrl = dt.getData('text/x-moz-url');
    if (mozUrl) {
      var mozLine = mozUrl.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)[0] || '';
      if (mozLine && looksLikeLoadableSource(mozLine)) return mozLine;
    }

    var downloadUrl = dt.getData('DownloadURL');
    if (downloadUrl) {
      var parts = downloadUrl.split(':');
      if (parts.length >= 3) {
        var candidate = parts.slice(2).join(':').trim();
        if (candidate && looksLikeLoadableSource(candidate)) return candidate;
      }
    }

    var plainText = dt.getData('text/plain').trim();
    if (plainText) {
      var firstLine = plainText.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)[0] || '';
      if (firstLine && looksLikeLoadableSource(firstLine)) return firstLine;
      if (looksLikeAbsolutePath(firstLine)) {
        var fromPlainPath = toFileUrl(firstLine);
        if (looksLikeLoadableSource(fromPlainPath)) return fromPlainPath;
      }
    }

    if (file && typeof file.path === 'string' && file.path.trim()) {
      var derived = toFileUrl(file.path);
      if (looksLikeLoadableSource(derived)) return derived;
    }
    return '';
  }

  async function loadFromSource(source) {
    var protocol = '';
    try {
      protocol = new URL(source).protocol;
    } catch (_error) {}

    var fetchOptions = protocol === 'http:' || protocol === 'https:' ? { mode: 'cors' } : {};
    var response;
    try {
      response = await fetch(source, fetchOptions);
    } catch (error) {
      if (protocol === 'file:') {
        throw new Error('This browser blocks loading local files via file:// on reload. Use an http(s) source to enable persistent reload.');
      }
      throw error;
    }
    if ((protocol === 'http:' || protocol === 'https:') && !response.ok) {
      throw new Error('HTTP ' + String(response.status) + ' while loading source');
    }
    var text = await response.text();
    loadMarkdown(text, source, source);
    updateSourceQuery(source);
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
        var fileSource = getDroppedFileSource(file, dt);
        var baseForFile = '';
        if (fileSource && canBeBaseUrl(fileSource)) {
          try {
            baseForFile = new URL('.', fileSource).href;
          } catch (_error) {}
        }
        loadMarkdown(fileText, file.name || 'local file', baseForFile || window.location.href);
        if (fileSource) {
          updateSourceQuery(fileSource);
        }
        return;
      }

      var plainText = dt.getData('text/plain').trim();
      var droppedUrl = extractDroppedUrl(dt);
      var droppedText = droppedUrl || plainText;

      if (!droppedText) return;

      if (droppedUrl || looksLikeLoadableSource(droppedText)) {
        await loadFromSource(droppedText);
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

  var sourceFromQuery = getSourceFromQuery();
  if (sourceFromQuery && looksLikeLoadableSource(sourceFromQuery)) {
    loadFromSource(sourceFromQuery).catch(function (error) {
      var message = error instanceof Error ? error.message : String(error);
      loadMarkdown('# Load error\n\nCould not load source from URL query.\n\n`' + message + '`', 'error', window.location.href);
    });
  } else {
    loadMarkdown(
      '# clicker.page\n\nDrop a markdown file or URL onto this page.\n\n---\n\n## Navigation\n\n- Arrow right/down: next slide\n- Arrow left/up: previous slide\n- Swipe: next/previous on mobile',
      'welcome'
    );
  }
})();
