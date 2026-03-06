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
  var currentSourceQuery = '';
  var currentSourceIsExplicit = false;
  var mermaidReady = false;
  var markedReady = false;
  var mermaidRenderCount = 0;
  var viewRenderToken = 0;
  var FILE_SOURCE_CACHE_PREFIX = 'clicker.page.file-source-cache:v2:';
  var FILE_NAME_SOURCE_CACHE_PREFIX = 'clicker.page.file-name-source-cache:v2:';

  function debugLog(message, details) {
    var stamp = new Date().toISOString();
    if (typeof details === 'undefined') {
      console.log('[clicker.page]', stamp, message);
      return;
    }
    console.log('[clicker.page]', stamp, message, details);
  }

  window.addEventListener('error', function (event) {
    debugLog('window.error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && typeof event.reason !== 'undefined' ? event.reason : '(no reason)';
    debugLog('window.unhandledrejection', reason);
  });

  function ensureMarked() {
    if (!(window.marked && typeof window.marked.parse === 'function')) return false;
    if (markedReady) return true;
    if (typeof window.marked.use !== 'function') return true;

    window.marked.use({
      renderer: {
        strong: function (text) {
          return '<strong class="md-strong-marker">' + text + '</strong>';
        }
      }
    });

    markedReady = true;
    return true;
  }

  function renderMarkdown(markdown) {
    if (ensureMarked()) {
      return window.marked.parse(markdown || '');
    }
    return '<pre><code>Markdown renderer missing.</code></pre>';
  }

  function getSourceProtocol(source) {
    try {
      return new URL(String(source || '').trim()).protocol;
    } catch (_error) {
      return '';
    }
  }

  function rewriteGitHubBlobToRaw(source) {
    var normalized = String(source || '').trim();
    if (!normalized) return normalized;

    var parsed;
    try {
      parsed = new URL(normalized);
    } catch (_error) {
      return normalized;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return normalized;
    if (parsed.hostname !== 'github.com') return normalized;

    var parts = parsed.pathname.split('/').filter(Boolean);
    // Expected: /<owner>/<repo>/blob/<ref>/<path...>
    if (parts.length < 5) return normalized;
    if (parts[2] !== 'blob') return normalized;

    var owner = parts[0];
    var repo = parts[1];
    var ref = parts[3];
    var filePath = parts.slice(4).join('/');
    if (!owner || !repo || !ref || !filePath) return normalized;

    var rawPath = '/' + [owner, repo, 'refs', 'heads', ref, filePath].join('/');
    var rawUrl = new URL('https://raw.githubusercontent.com' + rawPath);
    debugLog('rewriteGitHubBlobToRaw', { from: normalized, to: rawUrl.href });
    return rawUrl.href;
  }

  function cacheFileSourceContent(source, markdown) {
    var normalizedSource = stripSourceAnchor(String(source || '').trim());
    if (!normalizedSource) return;
    if (getSourceProtocol(normalizedSource) !== 'file:') return;
    try {
      localStorage.setItem(FILE_SOURCE_CACHE_PREFIX + normalizedSource, String(markdown || ''));
      debugLog('fileCache:stored', { source: normalizedSource, bytes: String(markdown || '').length });
    } catch (_error) {
      debugLog('fileCache:store-failed', { source: normalizedSource });
    }
  }

  function getSourceBasename(source) {
    try {
      var pathname = new URL(stripSourceAnchor(String(source || '').trim())).pathname || '';
      var parts = pathname.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : '';
    } catch (_error) {
      return '';
    }
  }

  function rememberSourceForFileName(source) {
    var normalizedSource = stripSourceAnchor(String(source || '').trim());
    if (!normalizedSource) return;
    var basename = getSourceBasename(normalizedSource);
    if (!basename) return;
    try {
      localStorage.setItem(FILE_NAME_SOURCE_CACHE_PREFIX + basename, normalizedSource);
      debugLog('fileNameSource:stored', { basename: basename, source: normalizedSource });
    } catch (_error) {
      debugLog('fileNameSource:store-failed', { basename: basename, source: normalizedSource });
    }
  }

  function getRememberedSourceForFileName(fileName) {
    var basename = String(fileName || '').trim();
    if (!basename) return '';
    try {
      var remembered = localStorage.getItem(FILE_NAME_SOURCE_CACHE_PREFIX + basename) || '';
      debugLog('fileNameSource:lookup', { basename: basename, hit: Boolean(remembered) });
      return remembered;
    } catch (_error) {
      debugLog('fileNameSource:read-failed', { basename: basename });
      return '';
    }
  }

  function getCachedFileSourceContent(source) {
    var normalizedSource = stripSourceAnchor(String(source || '').trim());
    if (!normalizedSource) return '';
    if (getSourceProtocol(normalizedSource) !== 'file:') return '';
    try {
      var cached = localStorage.getItem(FILE_SOURCE_CACHE_PREFIX + normalizedSource) || '';
      debugLog('fileCache:lookup', { source: normalizedSource, hit: Boolean(cached) });
      return cached;
    } catch (_error) {
      debugLog('fileCache:read-failed', { source: normalizedSource });
      return '';
    }
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
    if (!ensureMermaid()) return Promise.resolve();

    function normalizeMermaidSvg(containerEl) {
      var svg = containerEl && containerEl.querySelector('svg');
      if (!svg) return;
      svg.removeAttribute('width');
      svg.style.width = 'auto';
      svg.style.maxWidth = '100%';
      svg.style.height = 'auto';
      svg.style.margin = '0 auto';
    }

    function renderMermaidDiagram(renderId, source, graph) {
      return new Promise(function (resolve) {
        var settled = false;
        function setRendered(result) {
          if (settled) return;
          settled = true;
          if (result && typeof result.svg === 'string') {
            graph.innerHTML = result.svg;
            normalizeMermaidSvg(graph);
            resolve();
            return;
          }
          if (typeof result === 'string') {
            graph.innerHTML = result;
            normalizeMermaidSvg(graph);
            resolve();
            return;
          }
          graph.innerHTML = '<pre><code>' + escapeHtml(source) + '</code></pre>';
          resolve();
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
            }, 800);
          }
        } catch (_error) {
          setRendered(null);
        }
      });
    }

    var diagramsToRender = [];
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
      diagramsToRender.push({ graph: graph, source: source });
    });

    if (!diagramsToRender.length) return Promise.resolve();

    var queue = Promise.resolve();
    diagramsToRender.forEach(function (entry) {
      var renderId = 'mermaid-diagram-' + String(mermaidRenderCount);
      mermaidRenderCount += 1;
      queue = queue.then(function () {
        return renderMermaidDiagram(renderId, entry.source, entry.graph);
      });
    });
    return queue;
  }

  function applyChainEffects(rootEl) {
    var chainPattern = /([A-Za-z0-9_./()[\]-]+(?:\s*(?:->|→|⇒|⟶)\s*[A-Za-z0-9_./()[\]-]+)+)/g;
    var candidates = rootEl.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th');

    candidates.forEach(function (element) {
      if (element.closest('pre, code, .mermaid-block')) return;
      if (element.querySelector('pre, code, .mermaid-block, img, svg')) return;

      var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          if (!node.nodeValue || !chainPattern.test(node.nodeValue)) {
            chainPattern.lastIndex = 0;
            return NodeFilter.FILTER_REJECT;
          }
          chainPattern.lastIndex = 0;

          var parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('pre, code, .mermaid-block, .chain-warp')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      var matchingNodes = [];
      while (walker.nextNode()) {
        matchingNodes.push(walker.currentNode);
      }

      matchingNodes.forEach(function (textNode) {
        var text = textNode.nodeValue || '';
        chainPattern.lastIndex = 0;
        if (!chainPattern.test(text)) {
          chainPattern.lastIndex = 0;
          return;
        }
        chainPattern.lastIndex = 0;

        var fragment = document.createDocumentFragment();
        var lastIndex = 0;
        var match;

        while ((match = chainPattern.exec(text))) {
          var start = match.index;
          var end = chainPattern.lastIndex;

          if (start > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
          }

          var warp = document.createElement('span');
          warp.className = 'chain-warp';

          var label = document.createElement('span');
          label.className = 'chain-warp__label';
          label.textContent = match[0];

          warp.appendChild(label);
          fragment.appendChild(warp);
          lastIndex = end;
        }

        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        textNode.parentNode.replaceChild(fragment, textNode);
      });
    });
  }

  function animateMarkerHighlights(rootEl, renderToken) {
    var markers = Array.from(rootEl.querySelectorAll('.md-strong-marker'));
    if (!markers.length) return;

    markers.forEach(function (marker, index) {
      marker.classList.remove('md-strong-marker--drawn');
      marker.style.setProperty('--marker-delay', String(index * 180) + 'ms');
    });

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        if (renderToken !== viewRenderToken) return;
        markers.forEach(function (marker) {
          marker.classList.add('md-strong-marker--drawn');
        });
      });
    });
  }

  function renderQrCode(containerEl, text) {
    if (!containerEl) return;
    containerEl.innerHTML = '';

    if (!(window.QRCode && typeof window.QRCode === 'function')) {
      var fallback = document.createElement('div');
      fallback.className = 'slide-qr-fallback';
      fallback.textContent = text;
      containerEl.appendChild(fallback);
      return;
    }

    new window.QRCode(containerEl, {
      text: text,
      width: 420,
      height: 420,
      colorDark: '#0d0d0d',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : undefined
    });
  }

  function applyFirstSlideQrLayout(rootEl) {
    rootEl.classList.remove('slide--split');
    rootEl.classList.add('slide--split', 'slide--intro-qr');

    var splitLayout = document.createElement('div');
    splitLayout.className = 'slide-split-layout';

    var contentPane = document.createElement('section');
    contentPane.className = 'slide-split-pane slide-split-pane--content slide-split-pane--content-first';

    var qrPane = document.createElement('aside');
    qrPane.className = 'slide-split-pane slide-split-pane--qr';

    var qrCard = document.createElement('div');
    qrCard.className = 'slide-qr-card';

    var qrTitle = document.createElement('h2');
    qrTitle.className = 'slide-qr-title';
    qrTitle.textContent = 'Open This Deck';

    var qrCode = document.createElement('div');
    qrCode.className = 'slide-qr-code';

    var qrCaption = document.createElement('p');
    qrCaption.className = 'slide-qr-caption';
    qrCaption.textContent = 'Scan to open the current page with its source URL.';

    qrCard.appendChild(qrTitle);
    qrCard.appendChild(qrCode);
    qrCard.appendChild(qrCaption);

    qrPane.appendChild(qrCard);
    renderQrCode(qrCode, window.location.href);

    while (rootEl.firstChild) {
      contentPane.appendChild(rootEl.firstChild);
    }

    splitLayout.appendChild(contentPane);
    splitLayout.appendChild(qrPane);
    rootEl.appendChild(splitLayout);
  }

  function getFirstMeaningfulElement(rootEl) {
    var children = Array.from(rootEl.children || []);
    var seenLeadDivider = false;

    for (var index = 0; index < children.length; index += 1) {
      var child = children[index];
      var tagName = child.tagName ? child.tagName.toUpperCase() : '';

      if (!seenLeadDivider && (tagName === 'H1' || tagName === 'H2' || tagName === 'HR')) {
        seenLeadDivider = true;
        continue;
      }

      if (tagName === 'SCRIPT' || tagName === 'STYLE') continue;
      if (!child.textContent && !child.querySelector('img, svg, pre, table, ul, ol, blockquote')) continue;
      return child;
    }

    return null;
  }

  function getLastMeaningfulElement(rootEl) {
    var children = Array.from(rootEl.children || []);

    for (var index = children.length - 1; index >= 0; index -= 1) {
      var child = children[index];
      var tagName = child.tagName ? child.tagName.toUpperCase() : '';

      if (tagName === 'SCRIPT' || tagName === 'STYLE') continue;
      if (!child.textContent && !child.querySelector('img, svg, pre, table, ul, ol, blockquote')) continue;
      return child;
    }

    return null;
  }

  function getLeadImageElement(containerEl) {
    if (!containerEl) return null;
    if (containerEl.tagName && containerEl.tagName.toUpperCase() === 'IMG') return containerEl;
    if (!containerEl.matches || !containerEl.matches('p, div, figure')) return null;

    var elementChildren = Array.from(containerEl.children || []);
    if (elementChildren.length !== 1) return null;
    if (containerEl.textContent.trim() !== '') return null;

    var onlyChild = elementChildren[0];
    if (onlyChild.tagName && onlyChild.tagName.toUpperCase() === 'IMG') return onlyChild;
    return null;
  }

  function waitForImageLoad(img) {
    return new Promise(function (resolve) {
      if (!img) {
        resolve(false);
        return;
      }

      if (img.complete) {
        resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
        return;
      }

      function cleanup(result) {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        resolve(result);
      }

      function onLoad() {
        cleanup(img.naturalWidth > 0 && img.naturalHeight > 0);
      }

      function onError() {
        cleanup(false);
      }

      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    });
  }

  function getMeaningfulSlideChildren(rootEl) {
    return Array.from(rootEl.children || []).filter(function (child) {
      var tagName = child.tagName ? child.tagName.toUpperCase() : '';
      if (tagName === 'SCRIPT' || tagName === 'STYLE') return false;
      if (!child.textContent && !child.querySelector('img, svg, pre, table, ul, ol, blockquote')) return false;
      return true;
    });
  }

  function getOnlyImageSlideParts(rootEl) {
    var children = getMeaningfulSlideChildren(rootEl);
    var headline = null;
    var imageHost = null;
    var imageEl = null;

    for (var index = 0; index < children.length; index += 1) {
      var child = children[index];
      var tagName = child.tagName ? child.tagName.toUpperCase() : '';

      if (!headline && (tagName === 'H2' || tagName === 'H1')) {
        headline = child;
        continue;
      }

      if (!imageHost) {
        var maybeImage = getLeadImageElement(child);
        if (maybeImage) {
          imageHost = child;
          imageEl = maybeImage;
          continue;
        }
      }

      return null;
    }

    if (!imageHost || !imageEl) return null;
    return {
      headline: headline,
      imageHost: imageHost,
      imageEl: imageEl
    };
  }

  function getImageBrightness(img, region) {
    try {
      var naturalWidth = Math.max(1, img.naturalWidth || 64);
      var naturalHeight = Math.max(1, img.naturalHeight || 64);
      var sampleX = 0;
      var sampleY = 0;
      var sampleWidth = naturalWidth;
      var sampleHeight = naturalHeight;

      if (region) {
        sampleX = Math.max(0, Math.floor(naturalWidth * Math.max(0, Math.min(1, region.x || 0))));
        sampleY = Math.max(0, Math.floor(naturalHeight * Math.max(0, Math.min(1, region.y || 0))));
        sampleWidth = Math.max(1, Math.floor(naturalWidth * Math.max(0.01, Math.min(1, region.width || 1))));
        sampleHeight = Math.max(1, Math.floor(naturalHeight * Math.max(0.01, Math.min(1, region.height || 1))));

        if (sampleX + sampleWidth > naturalWidth) sampleWidth = naturalWidth - sampleX;
        if (sampleY + sampleHeight > naturalHeight) sampleHeight = naturalHeight - sampleY;
      }

      var width = Math.max(1, Math.min(64, sampleWidth));
      var height = Math.max(1, Math.min(64, sampleHeight));
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext('2d');
      if (!context) return null;

      context.drawImage(img, sampleX, sampleY, sampleWidth, sampleHeight, 0, 0, width, height);
      var pixels = context.getImageData(0, 0, width, height).data;
      var weightedSum = 0;
      var sampleCount = 0;

      for (var offset = 0; offset < pixels.length; offset += 4) {
        var alpha = pixels[offset + 3] / 255;
        if (alpha <= 0.02) continue;
        var red = pixels[offset];
        var green = pixels[offset + 1];
        var blue = pixels[offset + 2];
        weightedSum += ((0.2126 * red) + (0.7152 * green) + (0.0722 * blue)) * alpha;
        sampleCount += alpha;
      }

      if (!sampleCount) return null;
      return weightedSum / sampleCount;
    } catch (_error) {
      return null;
    }
  }

  function getImageTone(img, region) {
    try {
      var naturalWidth = Math.max(1, img.naturalWidth || 64);
      var naturalHeight = Math.max(1, img.naturalHeight || 64);
      var sampleX = 0;
      var sampleY = 0;
      var sampleWidth = naturalWidth;
      var sampleHeight = naturalHeight;

      if (region) {
        sampleX = Math.max(0, Math.floor(naturalWidth * Math.max(0, Math.min(1, region.x || 0))));
        sampleY = Math.max(0, Math.floor(naturalHeight * Math.max(0, Math.min(1, region.y || 0))));
        sampleWidth = Math.max(1, Math.floor(naturalWidth * Math.max(0.01, Math.min(1, region.width || 1))));
        sampleHeight = Math.max(1, Math.floor(naturalHeight * Math.max(0.01, Math.min(1, region.height || 1))));

        if (sampleX + sampleWidth > naturalWidth) sampleWidth = naturalWidth - sampleX;
        if (sampleY + sampleHeight > naturalHeight) sampleHeight = naturalHeight - sampleY;
      }

      var width = Math.max(1, Math.min(64, sampleWidth));
      var height = Math.max(1, Math.min(64, sampleHeight));
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var context = canvas.getContext('2d');
      if (!context) return null;

      context.drawImage(img, sampleX, sampleY, sampleWidth, sampleHeight, 0, 0, width, height);
      var pixels = context.getImageData(0, 0, width, height).data;
      var luminances = [];

      for (var offset = 0; offset < pixels.length; offset += 4) {
        var alpha = pixels[offset + 3] / 255;
        if (alpha <= 0.02) continue;
        var red = pixels[offset];
        var green = pixels[offset + 1];
        var blue = pixels[offset + 2];
        luminances.push((0.2126 * red) + (0.7152 * green) + (0.0722 * blue));
      }

      if (!luminances.length) return null;
      luminances.sort(function (a, b) { return a - b; });
      var median = luminances[Math.floor(luminances.length / 2)];
      return median < 145 ? 'dark' : 'light';
    } catch (_error) {
      return null;
    }
  }

  function getCoverRegionBrightness(img, frameWidth, frameHeight, region) {
    var naturalWidth = Math.max(1, img.naturalWidth || 0);
    var naturalHeight = Math.max(1, img.naturalHeight || 0);
    var viewportWidth = Math.max(1, Math.floor(frameWidth || 1));
    var viewportHeight = Math.max(1, Math.floor(frameHeight || 1));
    if (!naturalWidth || !naturalHeight) return null;

    var coverScale = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    var renderedWidth = naturalWidth * coverScale;
    var renderedHeight = naturalHeight * coverScale;
    var offsetX = (viewportWidth - renderedWidth) / 2;
    var offsetY = (viewportHeight - renderedHeight) / 2;

    var regionX = Math.max(0, Math.min(viewportWidth, viewportWidth * (region.x || 0)));
    var regionY = Math.max(0, Math.min(viewportHeight, viewportHeight * (region.y || 0)));
    var regionWidth = Math.max(1, Math.min(viewportWidth - regionX, viewportWidth * (region.width || 1)));
    var regionHeight = Math.max(1, Math.min(viewportHeight - regionY, viewportHeight * (region.height || 1)));

    var sourceX = Math.max(0, (regionX - offsetX) / coverScale);
    var sourceY = Math.max(0, (regionY - offsetY) / coverScale);
    var sourceWidth = Math.min(naturalWidth - sourceX, regionWidth / coverScale);
    var sourceHeight = Math.min(naturalHeight - sourceY, regionHeight / coverScale);

    if (sourceWidth <= 0 || sourceHeight <= 0) return getImageBrightness(img, null);

    return getImageBrightness(img, {
      x: sourceX / naturalWidth,
      y: sourceY / naturalHeight,
      width: sourceWidth / naturalWidth,
      height: sourceHeight / naturalHeight
    });
  }

  function getCoverRegionTone(img, frameWidth, frameHeight, region) {
    var naturalWidth = Math.max(1, img.naturalWidth || 0);
    var naturalHeight = Math.max(1, img.naturalHeight || 0);
    var viewportWidth = Math.max(1, Math.floor(frameWidth || 1));
    var viewportHeight = Math.max(1, Math.floor(frameHeight || 1));
    if (!naturalWidth || !naturalHeight) return null;

    var coverScale = Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    var renderedWidth = naturalWidth * coverScale;
    var renderedHeight = naturalHeight * coverScale;
    var offsetX = (viewportWidth - renderedWidth) / 2;
    var offsetY = (viewportHeight - renderedHeight) / 2;

    var regionX = Math.max(0, Math.min(viewportWidth, viewportWidth * (region.x || 0)));
    var regionY = Math.max(0, Math.min(viewportHeight, viewportHeight * (region.y || 0)));
    var regionWidth = Math.max(1, Math.min(viewportWidth - regionX, viewportWidth * (region.width || 1)));
    var regionHeight = Math.max(1, Math.min(viewportHeight - regionY, viewportHeight * (region.height || 1)));

    var sourceX = Math.max(0, (regionX - offsetX) / coverScale);
    var sourceY = Math.max(0, (regionY - offsetY) / coverScale);
    var sourceWidth = Math.min(naturalWidth - sourceX, regionWidth / coverScale);
    var sourceHeight = Math.min(naturalHeight - sourceY, regionHeight / coverScale);

    if (sourceWidth <= 0 || sourceHeight <= 0) return getImageTone(img, null);

    return getImageTone(img, {
      x: sourceX / naturalWidth,
      y: sourceY / naturalHeight,
      width: sourceWidth / naturalWidth,
      height: sourceHeight / naturalHeight
    });
  }

  function getHeroTitleTone(rootEl, img, titleEl) {
    if (!rootEl || !img || !titleEl) return null;

    var slideRect = rootEl.getBoundingClientRect();
    var titleRect = titleEl.getBoundingClientRect();
    if (!slideRect.width || !slideRect.height || !titleRect.width || !titleRect.height) return null;

    return getCoverRegionTone(
      img,
      rootEl.clientWidth,
      rootEl.clientHeight,
      {
        x: Math.max(0, (titleRect.left - slideRect.left) / slideRect.width),
        y: Math.max(0, (titleRect.top - slideRect.top) / slideRect.height),
        width: Math.min(1, titleRect.width / slideRect.width),
        height: Math.min(1, titleRect.height / slideRect.height)
      }
    );
  }

  function applyFullImageSlide(rootEl, parts, brightness) {
    var hero = document.createElement('div');
    hero.className = 'slide-image-hero';

    var media = document.createElement('div');
    media.className = 'slide-image-hero__media';

    var overlay = document.createElement('div');
    overlay.className = 'slide-image-hero__overlay';

    if (parts.headline) {
      var title = document.createElement('div');
      title.className = 'slide-image-hero__title';
      title.appendChild(parts.headline.cloneNode(true));
      overlay.appendChild(title);
    }

    media.appendChild(parts.imageHost);
    hero.appendChild(media);
    hero.appendChild(overlay);

    rootEl.innerHTML = '';
    rootEl.appendChild(hero);
    rootEl.classList.add('slide--image-hero');

    var resolvedTone = title ? getHeroTitleTone(rootEl, parts.imageEl, title) : null;
    if (resolvedTone === 'dark') {
      overlay.classList.add('slide-image-hero__overlay--light-text');
    } else if (resolvedTone === 'light') {
      overlay.classList.add('slide-image-hero__overlay--dark-text');
    } else {
      overlay.classList.add('slide-image-hero__overlay--auto-contrast');
    }
  }

  async function applySlideLayout(rootEl, renderToken) {
    rootEl.classList.remove('slide--split');
    rootEl.classList.remove('slide--intro-qr');
    rootEl.classList.remove('slide--image-hero');

    if (currentIndex === 0) {
      applyFirstSlideQrLayout(rootEl);
      return;
    }

    var onlyImageParts = getOnlyImageSlideParts(rootEl);
    if (onlyImageParts) {
      var heroLoaded = await waitForImageLoad(onlyImageParts.imageEl);
      if (!heroLoaded || renderToken !== viewRenderToken) return;

      if (onlyImageParts.imageEl.naturalWidth > onlyImageParts.imageEl.naturalHeight) {
        applyFullImageSlide(rootEl, onlyImageParts, null);
        return;
      }
    }

    var leadingElement = getFirstMeaningfulElement(rootEl);
    var leadImage = getLeadImageElement(leadingElement);
    var trailingElement = getLastMeaningfulElement(rootEl);
    var tailImage = getLeadImageElement(trailingElement);
    var splitSide = '';
    var splitImage = null;

    if (leadImage) {
      splitSide = 'left';
      splitImage = leadImage;
    } else if (tailImage) {
      splitSide = 'right';
      splitImage = tailImage;
    } else {
      return;
    }

    var loaded = await waitForImageLoad(splitImage);
    if (!loaded || renderToken !== viewRenderToken) return;
    if (splitImage.naturalHeight <= splitImage.naturalWidth) return;

    var mediaHost = splitImage.parentElement;
    var splitLayout = document.createElement('div');
    splitLayout.className = 'slide-split-layout';

    var mediaPane = document.createElement('section');
    mediaPane.className = 'slide-split-pane slide-split-pane--media';

    var contentPane = document.createElement('section');
    contentPane.className = 'slide-split-pane slide-split-pane--content';

    if (splitSide === 'left') {
      splitLayout.appendChild(mediaPane);
      splitLayout.appendChild(contentPane);
    } else {
      splitLayout.appendChild(contentPane);
      splitLayout.appendChild(mediaPane);
    }

    mediaPane.appendChild(mediaHost);

    while (rootEl.firstChild) {
      contentPane.appendChild(rootEl.firstChild);
    }

    rootEl.appendChild(splitLayout);
    rootEl.classList.add('slide--split');
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

  function getSourceAnchor(source) {
    try {
      var hash = new URL(String(source || '').trim()).hash || '';
      return hash ? decodeURIComponent(hash.slice(1)).trim() : '';
    } catch (_error) {
      return '';
    }
  }

  function slugifySlideAnchor(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z0-9#]+;/gi, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getSlideHeadingAnchor(slideMarkdown) {
    var lines = String(slideMarkdown || '').replace(/\r\n/g, '\n').split('\n');

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index].trim();
      if (!line) continue;

      var atxMatch = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
      if (atxMatch) {
        var headingText = atxMatch[2].replace(/\s+#+\s*$/, '').trim();
        return slugifySlideAnchor(headingText);
      }
    }

    return '';
  }

  function resolveInitialSlideIndex(source, slideList) {
    var anchor = slugifySlideAnchor(getSourceAnchor(source));
    if (!anchor) return 0;

    var pageMatch = /^(?:page|slide)-?(\d+)$/.exec(anchor) || /^(\d+)$/.exec(anchor);
    if (pageMatch) {
      var oneBasedIndex = Number(pageMatch[1]);
      if (Number.isFinite(oneBasedIndex) && oneBasedIndex >= 1 && oneBasedIndex <= slideList.length) {
        return oneBasedIndex - 1;
      }
    }

    for (var index = 0; index < slideList.length; index += 1) {
      if (getSlideHeadingAnchor(slideList[index]) === anchor) {
        return index;
      }
    }

    return 0;
  }

  function stripSourceAnchor(source) {
    try {
      var parsed = new URL(String(source || '').trim());
      parsed.hash = '';
      return parsed.toString();
    } catch (_error) {
      return String(source || '').trim().replace(/#.*$/, '');
    }
  }

  function getCurrentSlideAnchor() {
    var headingAnchor = getSlideHeadingAnchor(slides[currentIndex] || '');
    if (headingAnchor) return headingAnchor;
    return 'slide-' + String(currentIndex + 1);
  }

  function syncCurrentSlideSourceQuery() {
    if (!currentSourceQuery) return;
    var baseSource = stripSourceAnchor(currentSourceQuery);
    if (!baseSource) return;
    updateSourceQuery(baseSource + '#' + encodeURIComponent(getCurrentSlideAnchor()));
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
    var normalized = String(source || '').trim();
    if (!normalized) return;
    currentSourceQuery = normalized;
    debugLog('updateSourceQuery:start', { source: normalized, hrefBefore: window.location.href });
    var nextHref = '';
    var nextRelativeUrl = '';
    try {
      var parsed = new URL(window.location.href);
      parsed.searchParams.set('source', normalized);
      nextHref = parsed.toString();
      nextRelativeUrl = parsed.pathname + parsed.search + parsed.hash;
    } catch (_prepError) {
      debugLog('updateSourceQuery:parse-failed');
      return;
    }

    try {
      window.history.replaceState({ source: normalized }, '', nextRelativeUrl || nextHref);
      debugLog('updateSourceQuery:replaceState-applied', { hrefAfterReplace: window.location.href });
    } catch (_error) {
      // Ignore and fall through to hard navigation fallback.
      debugLog('updateSourceQuery:replaceState-failed');
    }

    var applied = false;
    try {
      applied = new URL(window.location.href).searchParams.get('source') === normalized;
    } catch (_verifyError) {}
    debugLog('updateSourceQuery:verify', { applied: applied, hrefNow: window.location.href });

    if (!applied) {
      try {
        debugLog('updateSourceQuery:fallback-location-replace', { nextHref: nextHref });
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

    var renderToken = viewRenderToken + 1;
    viewRenderToken = renderToken;
    currentIndex = Math.max(0, Math.min(currentIndex, total - 1));
    syncCurrentSlideSourceQuery();
    slideEl.innerHTML = renderMarkdown(slides[currentIndex]);
    resolveRelativeAssets(slideEl, currentBaseUrl);
    var mermaidRender = renderMermaidBlocks(slideEl);
    enhanceCodeBlocks(slideEl);
    Promise.resolve(mermaidRender).then(function () {
      if (renderToken !== viewRenderToken) return;
      applyChainEffects(slideEl);
      return applySlideLayout(slideEl, renderToken);
    }).then(function () {
      if (renderToken !== viewRenderToken) return;
      animateMarkerHighlights(slideEl, renderToken);
    }).catch(function (error) {
      debugLog('updateView:slide-layout-failed', String(error));
    });
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

  function loadMarkdown(markdown, sourceLabel, baseUrl, sourceQueryValue, sourceIsExplicit) {
    var trimmed = String(markdown || '').trim();
    if (!trimmed) return;

    slides = splitSlides(trimmed);
    currentSourceQuery = String(sourceQueryValue || '').trim();
    currentSourceIsExplicit = Boolean(currentSourceQuery && sourceIsExplicit);
    if (currentSourceIsExplicit) rememberSourceForFileName(currentSourceQuery);
    currentIndex = resolveInitialSlideIndex(currentSourceQuery, slides);
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

  function pushUniqueCandidate(list, value) {
    if (!value) return;
    if (list.indexOf(value) !== -1) return;
    list.push(value);
  }

  function inferDroppedFileSourceFromContext(fileName) {
    var normalizedName = String(fileName || '').trim();
    if (!normalizedName) return '';

    var candidates = [];
    var rememberedSource = getRememberedSourceForFileName(normalizedName);
    if (rememberedSource) {
      pushUniqueCandidate(candidates, rememberedSource);
    }

    var querySource = stripSourceAnchor(getSourceFromQuery());
    var knownSources = [];
    if (querySource && looksLikeLoadableSource(querySource)) {
      pushUniqueCandidate(knownSources, querySource);
    }
    if (currentSourceIsExplicit) {
      pushUniqueCandidate(knownSources, stripSourceAnchor(currentSourceQuery));
      pushUniqueCandidate(knownSources, currentBaseUrl);
    }

    knownSources.forEach(function (base) {
      if (!base) return;
      try {
        pushUniqueCandidate(candidates, new URL(normalizedName, base).href);
      } catch (_error) {}
    });

    for (var index = 0; index < candidates.length; index += 1) {
      if (looksLikeLoadableSource(candidates[index])) {
        debugLog('getDroppedFileSource:inferred-from-context', candidates[index]);
        return candidates[index];
      }
    }

    return '';
  }

  function getDroppedFileSource(file, dt) {
    var uriList = normalizeDroppedUri(dt.getData('text/uri-list'));
    if (uriList && looksLikeLoadableSource(uriList)) {
      return { source: uriList, explicit: true };
    }

    var mozUrl = dt.getData('text/x-moz-url');
    if (mozUrl) {
      var mozLine = mozUrl.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)[0] || '';
      if (mozLine && looksLikeLoadableSource(mozLine)) {
        return { source: mozLine, explicit: true };
      }
    }

    var downloadUrl = dt.getData('DownloadURL');
    if (downloadUrl) {
      var parts = downloadUrl.split(':');
      if (parts.length >= 3) {
        var candidate = parts.slice(2).join(':').trim();
        if (candidate && looksLikeLoadableSource(candidate)) {
          return { source: candidate, explicit: true };
        }
      }
    }

    var plainText = dt.getData('text/plain').trim();
    if (plainText) {
      var firstLine = plainText.split('\n').map(function (line) { return line.trim(); }).filter(Boolean)[0] || '';
      if (firstLine && looksLikeLoadableSource(firstLine)) {
        return { source: firstLine, explicit: true };
      }
      if (looksLikeAbsolutePath(firstLine)) {
        var fromPlainPath = toFileUrl(firstLine);
        if (looksLikeLoadableSource(fromPlainPath)) {
          return { source: fromPlainPath, explicit: true };
        }
      }
    }

    if (file && typeof file.path === 'string' && file.path.trim()) {
      var derived = toFileUrl(file.path);
      if (looksLikeLoadableSource(derived)) {
        return { source: derived, explicit: true };
      }
    }

    // Browser security often hides absolute paths for dropped local files.
    // Fall back to the currently loaded deck/base context instead of assuming
    // the file lives next to index.html.
    if (file && typeof file.name === 'string' && file.name.trim()) {
      var inferredFromContext = inferDroppedFileSourceFromContext(file.name);
      if (inferredFromContext) {
        return { source: inferredFromContext, explicit: false };
      }
    }

    return { source: '', explicit: false };
  }

  async function loadFromSource(source) {
    var normalizedSource = String(source || '').trim();
    debugLog('loadFromSource:start', { source: normalizedSource });
    if (!normalizedSource) {
      throw new Error('Missing source URL');
    }
    if (!looksLikeLoadableSource(normalizedSource)) {
      throw new Error('Unsupported source URL protocol');
    }

    // Persist source in query immediately, even when fetch later fails.
    updateSourceQuery(normalizedSource);

    var fetchSource = rewriteGitHubBlobToRaw(normalizedSource);

    var protocol = getSourceProtocol(fetchSource);

    // Browsers block programmatic reads of file:// URLs on reload for security.
    if (protocol === 'file:') {
      throw new Error('Browser security blocks loading file:// URLs from query on reload. Use an http(s) URL or run clicker.page through a local web server.');
    }

    var fetchOptions = protocol === 'http:' || protocol === 'https:' ? { mode: 'cors' } : {};
    var response;
    try {
      response = await fetch(fetchSource, fetchOptions);
    } catch (error) {
      debugLog('loadFromSource:fetch-throw', { source: fetchSource, error: String(error) });
      throw error;
    }
    if ((protocol === 'http:' || protocol === 'https:') && !response.ok) {
      debugLog('loadFromSource:fetch-not-ok', { status: response.status, source: fetchSource });
      throw new Error('HTTP ' + String(response.status) + ' while loading source');
    }
    var text = await response.text();
    debugLog('loadFromSource:success', { source: fetchSource, bytes: text.length });
    loadMarkdown(text, normalizedSource, fetchSource, normalizedSource, true);
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
    debugLog('handleDrop:start', {
      types: dt.types ? Array.from(dt.types) : [],
      files: dt.files ? dt.files.length : 0
    });

    try {
      if (dt.files && dt.files.length > 0) {
        var file = dt.files[0];
        var droppedSourceInfo = getDroppedFileSource(file, dt);
        var fileSource = droppedSourceInfo.source;
        debugLog('handleDrop:file-detected', {
          name: file.name,
          size: file.size,
          fileSource: fileSource || '(none)',
          explicit: Boolean(droppedSourceInfo.explicit)
        });

        if (fileSource && looksLikeLoadableSource(fileSource)) {
          debugLog('handleDrop:file-loadable-source', fileSource);
          updateSourceQuery(fileSource);
          var droppedProtocol = '';
          try {
            droppedProtocol = new URL(fileSource).protocol;
          } catch (_protocolError) {}

          if (droppedProtocol === 'file:') {
            var droppedFileText = await file.text();
            cacheFileSourceContent(fileSource, droppedFileText);
            loadMarkdown(droppedFileText, fileSource, fileSource, fileSource, droppedSourceInfo.explicit);
          } else {
            await loadFromSource(fileSource);
          }
          return;
        }

        var fileText = await file.text();
        var baseForFile = '';
        if (fileSource && canBeBaseUrl(fileSource)) {
          try {
            baseForFile = new URL('.', fileSource).href;
          } catch (_error) {}
        }
        loadMarkdown(fileText, file.name || 'local file', baseForFile || window.location.href, fileSource || '', false);
        debugLog('handleDrop:file-loaded-as-text', { name: file.name, chars: fileText.length });
        return;
      }

      var plainText = dt.getData('text/plain').trim();
      var droppedUrl = extractDroppedUrl(dt);
      var droppedText = droppedUrl || plainText;
      debugLog('handleDrop:text-path', {
        droppedUrl: droppedUrl || '(none)',
        plainPreview: plainText.slice(0, 120)
      });

      if (!droppedText) return;

      if (droppedUrl || looksLikeLoadableSource(droppedText)) {
        debugLog('handleDrop:text-loadable-source', droppedText);
        updateSourceQuery(droppedText);
        await loadFromSource(droppedText);
      } else {
        debugLog('handleDrop:text-inline-markdown');
        loadMarkdown(droppedText, 'dropped text', window.location.href, '', false);
      }
    } catch (error) {
      var message = error instanceof Error ? error.message : String(error);
      debugLog('handleDrop:error', message);
      loadMarkdown('# Load error\n\nCould not load dropped content.\n\n`' + message + '`', 'error', window.location.href, '', false);
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

  app.addEventListener('click', function (event) {
    if (!slides.length) return;

    var target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, textarea, select, label')) return;

    goNext();
  });

  var sourceFromQuery = getSourceFromQuery();
  debugLog('startup', {
    href: window.location.href,
    sourceFromQuery: sourceFromQuery || '(none)'
  });
  if (sourceFromQuery && looksLikeLoadableSource(sourceFromQuery)) {
    var queryProtocol = getSourceProtocol(sourceFromQuery);
    if (queryProtocol === 'file:') {
      var cachedFileContent = getCachedFileSourceContent(sourceFromQuery);
      if (cachedFileContent) {
        loadMarkdown(cachedFileContent, sourceFromQuery + ' (cached)', sourceFromQuery, sourceFromQuery, true);
      } else {
        loadMarkdown(
          '# Load error\n\nCould not load local file source from URL query.\n\nDrop that file once in this browser session to authorize and cache its content.',
          'error',
          window.location.href,
          '',
          false
        );
      }
    } else {
      loadFromSource(sourceFromQuery).catch(function (error) {
        var message = error instanceof Error ? error.message : String(error);
        loadMarkdown('# Load error\n\nCould not load source from URL query.\n\n`' + message + '`', 'error', window.location.href, '', false);
      });
    }
  } else {
    loadMarkdown(
      '# clicker.page\n\nDrop a markdown file or URL onto this page.\n\n---\n\n## Navigation\n\n- Arrow right/down: next slide\n- Arrow left/up: previous slide\n- Swipe: next/previous on mobile',
      'welcome',
      window.location.href,
      '',
      false
    );
  }
})();
