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
  var VERIFIED_FILE_SOURCE_PREFIX = 'clicker.page.verified-file-source:v2:';
  var FILE_NAME_SOURCE_CACHE_PREFIX = 'clicker.page.file-name-source-cache:v3:';
  var LOCAL_DROP_CACHE_PREFIX = 'clicker.page.local-drop:v1:';
  var LOCAL_DROP_SOURCE_PREFIX = 'localdrop:';
  var localAssetContexts = {};
  var currentDeckContentHash = '';
  var currentDeckHashPending = false;
  var deckHashToken = 0;
  var LOCAL_ASSET_DB_NAME = 'clicker.page.local-assets';
  var LOCAL_ASSET_DB_VERSION = 1;
  var LOCAL_ASSET_STORE = 'deck-contexts';

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
    var normalized = String(source || '').trim();
    if (normalized.indexOf(LOCAL_DROP_SOURCE_PREFIX) === 0) return LOCAL_DROP_SOURCE_PREFIX;
    try {
      return new URL(normalized).protocol;
    } catch (_error) {
      return '';
    }
  }

  function createLocalDropSource(fileName) {
    var normalizedName = String(fileName || '').trim() || 'local.md';
    var randomPart = Math.random().toString(36).slice(2, 10);
    var stampPart = Date.now().toString(36);
    return LOCAL_DROP_SOURCE_PREFIX + stampPart + '-' + randomPart + '/' + encodeURIComponent(normalizedName);
  }

  function stripLocalDropAnchor(source) {
    return String(source || '').trim().replace(/#.*$/, '');
  }

  function cacheLocalDropContent(source, markdown) {
    var normalizedSource = stripLocalDropAnchor(source);
    if (!normalizedSource) return;
    if (getSourceProtocol(normalizedSource) !== LOCAL_DROP_SOURCE_PREFIX) return;
    try {
      localStorage.setItem(LOCAL_DROP_CACHE_PREFIX + normalizedSource, String(markdown || ''));
      debugLog('localDrop:stored', { source: normalizedSource, bytes: String(markdown || '').length });
    } catch (_error) {
      debugLog('localDrop:store-failed', { source: normalizedSource });
    }
  }

  function getCachedLocalDropContent(source) {
    var normalizedSource = stripLocalDropAnchor(source);
    if (!normalizedSource) return '';
    if (getSourceProtocol(normalizedSource) !== LOCAL_DROP_SOURCE_PREFIX) return '';
    try {
      var cached = localStorage.getItem(LOCAL_DROP_CACHE_PREFIX + normalizedSource) || '';
      debugLog('localDrop:lookup', { source: normalizedSource, hit: Boolean(cached) });
      return cached;
    } catch (_error) {
      debugLog('localDrop:read-failed', { source: normalizedSource });
      return '';
    }
  }

  function getCurrentDeckContextKey() {
    return stripSourceAnchor(String(currentSourceQuery || '').trim());
  }

  function canPersistDirectoryHandles() {
    return Boolean(window.isSecureContext && window.indexedDB && window.showDirectoryPicker);
  }

  function openLocalAssetDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }

      var request = window.indexedDB.open(LOCAL_ASSET_DB_NAME, LOCAL_ASSET_DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(LOCAL_ASSET_STORE)) {
          db.createObjectStore(LOCAL_ASSET_STORE);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  function withLocalAssetStore(mode, worker) {
    return openLocalAssetDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(LOCAL_ASSET_STORE, mode);
        var store = tx.objectStore(LOCAL_ASSET_STORE);
        var request;

        try {
          request = worker(store);
        } catch (error) {
          db.close();
          reject(error);
          return;
        }

        tx.oncomplete = function () {
          db.close();
          resolve(request && typeof request.result !== 'undefined' ? request.result : undefined);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error || new Error('IndexedDB transaction failed'));
        };
        tx.onabort = function () {
          db.close();
          reject(tx.error || new Error('IndexedDB transaction aborted'));
        };
      });
    });
  }

  function persistDirectoryHandleForDeckHash(hash, handle) {
    if (!hash || !handle || !canPersistDirectoryHandles()) return Promise.resolve();
    return withLocalAssetStore('readwrite', function (store) {
      return store.put(handle, hash);
    }).then(function () {
      debugLog('localAssetHandle:stored', { hash: hash });
    }).catch(function (error) {
      debugLog('localAssetHandle:store-failed', String(error));
    });
  }

  function loadPersistedDirectoryHandle(hash) {
    if (!hash || !canPersistDirectoryHandles()) return Promise.resolve(null);
    return withLocalAssetStore('readonly', function (store) {
      return store.get(hash);
    }).then(function (handle) {
      debugLog('localAssetHandle:lookup', { hash: hash, hit: Boolean(handle) });
      return handle || null;
    }).catch(function (error) {
      debugLog('localAssetHandle:read-failed', String(error));
      return null;
    });
  }

  function deletePersistedDirectoryHandle(hash) {
    if (!hash || !canPersistDirectoryHandles()) return Promise.resolve();
    return withLocalAssetStore('readwrite', function (store) {
      return store.delete(hash);
    }).then(function () {
      debugLog('localAssetHandle:deleted', { hash: hash });
    }).catch(function (error) {
      debugLog('localAssetHandle:delete-failed', String(error));
    });
  }

  function hashMarkdownContent(markdown) {
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) {
      return Promise.resolve('');
    }

    var bytes = new window.TextEncoder().encode(String(markdown || ''));
    return window.crypto.subtle.digest('SHA-256', bytes).then(function (digest) {
      return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }).catch(function () {
      return '';
    });
  }

  function normalizeRelativeAssetPath(path) {
    return String(path || '')
      .trim()
      .replace(/[?#].*$/, '')
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '');
  }

  function getLocalAssetContext(deckKey) {
    return localAssetContexts[String(deckKey || '').trim()] || null;
  }

  function setLocalAssetContext(deckKey, context) {
    var normalizedDeckKey = String(deckKey || '').trim();
    if (!normalizedDeckKey) return;

    var previous = localAssetContexts[normalizedDeckKey];
    if (previous && Array.isArray(previous.urls)) {
      previous.urls.forEach(function (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_error) {}
      });
    }

    localAssetContexts[normalizedDeckKey] = context;
  }

  function clearLocalAssetContext(deckKey) {
    var normalizedDeckKey = String(deckKey || '').trim();
    if (!normalizedDeckKey) return;
    var previous = localAssetContexts[normalizedDeckKey];
    if (previous && Array.isArray(previous.urls)) {
      previous.urls.forEach(function (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_error) {}
      });
    }
    delete localAssetContexts[normalizedDeckKey];
  }

  async function createLocalAssetContext(entries) {
    var mapping = {};
    var urls = [];
    var normalizedEntries = Array.from(entries || []);

    for (var entryIndex = 0; entryIndex < normalizedEntries.length; entryIndex += 1) {
      var entry = normalizedEntries[entryIndex];
      if (!entry || !entry.file) continue;
      var file = entry.file;
      var relativePath = String(entry.relativePath || file.webkitRelativePath || file.name || '').trim();
      if (!relativePath) continue;

      var normalizedPath = relativePath.replace(/\\/g, '/');
      var slashIndex = normalizedPath.indexOf('/');
      if (slashIndex !== -1) {
        normalizedPath = normalizedPath.slice(slashIndex + 1);
      }

      normalizedPath = normalizeRelativeAssetPath(normalizedPath);
      if (!normalizedPath || mapping[normalizedPath]) continue;

      var objectUrl = URL.createObjectURL(file);
      mapping[normalizedPath] = {
        url: objectUrl,
        tone: await guessAssetTone(file)
      };
      urls.push(objectUrl);
    }

    return { files: mapping, urls: urls };
  }

  function parseHexColor(value) {
    var normalized = String(value || '').trim();
    if (!normalized) return null;
    var hex = normalized.replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex.split('').map(function (char) { return char + char; }).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function toneFromRgb(rgb) {
    if (!rgb) return '';
    var luminance = (0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b);
    return luminance < 145 ? 'dark' : 'light';
  }

  function extractSvgToneFromMarkup(markup) {
    var svgText = String(markup || '');
    if (!svgText) return '';

    var rectMatch = svgText.match(/<rect[^>]*\bwidth=["'](?:100%|1600|1920|1280)["'][^>]*\bheight=["'](?:100%|900|1080|720)["'][^>]*\bfill=["']([^"']+)["']/i) ||
      svgText.match(/<rect[^>]*\bfill=["']([^"']+)["'][^>]*\bwidth=["'](?:100%|1600|1920|1280)["'][^>]*\bheight=["'](?:100%|900|1080|720)["']/i) ||
      svgText.match(/<rect[^>]*\bfill=["']([^"']+)["']/i);

    if (!rectMatch) return '';
    return toneFromRgb(parseHexColor(rectMatch[1]));
  }

  async function guessAssetTone(file) {
    if (!file) return '';
    if (!/\.svg$/i.test(file.name || '')) return '';
    try {
      return extractSvgToneFromMarkup(await file.text());
    } catch (_error) {
      return '';
    }
  }

  async function createLocalAssetContextFromDirectoryHandle(directoryHandle) {
    var collectedFiles = [];

    async function walkDirectory(handle, prefix) {
      for await (var entry of handle.values()) {
        if (entry.kind === 'file') {
          var file = await entry.getFile();
          collectedFiles.push({
            file: file,
            relativePath: prefix ? prefix + '/' + entry.name : entry.name
          });
        } else if (entry.kind === 'directory') {
          await walkDirectory(entry, prefix ? prefix + '/' + entry.name : entry.name);
        }
      }
    }

    await walkDirectory(directoryHandle, '');
    return createLocalAssetContext(collectedFiles);
  }

  function invalidatePersistedLocalAssetContext(deckKey, hash) {
    clearLocalAssetContext(deckKey);
    if (hash) {
      deletePersistedDirectoryHandle(hash);
    }
  }

  function resolveLocalAssetUrl(relativePath) {
    var deckKey = getCurrentDeckContextKey();
    if (!deckKey) return '';
    var context = getLocalAssetContext(deckKey);
    if (!context || !context.files) return '';
    var entry = context.files[normalizeRelativeAssetPath(relativePath)] || null;
    if (!entry && context.persistent && context.hash) {
      invalidatePersistedLocalAssetContext(deckKey, context.hash);
    }
    return entry && entry.url ? entry.url : '';
  }

  function resolveLocalAssetTone(relativePath) {
    var deckKey = getCurrentDeckContextKey();
    if (!deckKey) return '';
    var context = getLocalAssetContext(deckKey);
    if (!context || !context.files) return '';
    var entry = context.files[normalizeRelativeAssetPath(relativePath)] || null;
    return entry && entry.tone ? entry.tone : '';
  }

  function createMissingAssetPlaceholder(originalPath) {
    var placeholder = document.createElement('button');
    placeholder.type = 'button';
    placeholder.className = 'missing-asset-marker';
    placeholder.textContent = '!';
    placeholder.setAttribute('aria-label', 'Select local asset folder');
    placeholder.title = 'Relative image path cannot be resolved from this dropped deck. Click to choose the deck folder so clicker.page can load local sibling files.';
    placeholder.dataset.relativeAssetPath = String(originalPath || '');
    placeholder.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      promptForLocalAssetContext();
    });
    return placeholder;
  }

  async function restorePersistedLocalAssetContext(markdownHash, deckKey, renderToken) {
    if (!markdownHash || !deckKey || !canPersistDirectoryHandles()) return false;

    var existing = getLocalAssetContext(deckKey);
    if (existing && existing.hash === markdownHash) return true;

    var handle = await loadPersistedDirectoryHandle(markdownHash);
    if (!handle) return false;

    var permission = 'prompt';
    try {
      permission = await handle.queryPermission({ mode: 'read' });
    } catch (_error) {}
    if (permission !== 'granted') return false;

    try {
      var context = await createLocalAssetContextFromDirectoryHandle(handle);
      context.hash = markdownHash;
      context.handle = handle;
      context.persistent = true;
      if (renderToken !== deckHashToken) return false;
      setLocalAssetContext(deckKey, context);
      updateView();
      return true;
    } catch (_error) {
      invalidatePersistedLocalAssetContext(deckKey, markdownHash);
      return false;
    }
  }

  async function promptForLocalAssetContext() {
    var deckKey = getCurrentDeckContextKey();
    if (!deckKey) return;

    if (window.showDirectoryPicker && window.isSecureContext) {
      try {
        var directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
        var contextFromHandle = await createLocalAssetContextFromDirectoryHandle(directoryHandle);
        contextFromHandle.handle = directoryHandle;
        contextFromHandle.hash = currentDeckContentHash;
        contextFromHandle.persistent = Boolean(currentDeckContentHash);
        setLocalAssetContext(deckKey, contextFromHandle);
        if (currentDeckContentHash) {
          persistDirectoryHandleForDeckHash(currentDeckContentHash, directoryHandle);
        }
        updateView();
        return;
      } catch (_error) {}
    }

    var picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.setAttribute('webkitdirectory', '');
    picker.setAttribute('directory', '');
    picker.style.position = 'fixed';
    picker.style.left = '-9999px';
    picker.style.top = '0';

    picker.addEventListener('change', function () {
      var files = picker.files;
      if (files && files.length) {
        createLocalAssetContext(Array.from(files).map(function (file) {
          return { file: file, relativePath: file.webkitRelativePath || file.name };
        })).then(function (context) {
          setLocalAssetContext(deckKey, context);
          updateView();
        });
      }
      if (picker.parentNode) picker.parentNode.removeChild(picker);
    }, { once: true });

    document.body.appendChild(picker);
    picker.click();
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

  function markVerifiedFileSource(source) {
    var normalizedSource = stripSourceAnchor(String(source || '').trim());
    if (!normalizedSource) return;
    if (getSourceProtocol(normalizedSource) !== 'file:') return;
    try {
      localStorage.setItem(VERIFIED_FILE_SOURCE_PREFIX + normalizedSource, '1');
      debugLog('verifiedFileSource:stored', { source: normalizedSource });
    } catch (_error) {
      debugLog('verifiedFileSource:store-failed', { source: normalizedSource });
    }
  }

  function isVerifiedFileSource(source) {
    var normalizedSource = stripSourceAnchor(String(source || '').trim());
    if (!normalizedSource) return false;
    if (getSourceProtocol(normalizedSource) !== 'file:') return false;
    try {
      var verified = localStorage.getItem(VERIFIED_FILE_SOURCE_PREFIX + normalizedSource) === '1';
      debugLog('verifiedFileSource:lookup', { source: normalizedSource, hit: verified });
      return verified;
    } catch (_error) {
      debugLog('verifiedFileSource:read-failed', { source: normalizedSource });
      return false;
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
    if (getSourceProtocol(normalizedSource) === LOCAL_DROP_SOURCE_PREFIX) return;
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

  function isLikelyMobileClient() {
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      return navigator.userAgentData.mobile;
    }

    var ua = String(navigator.userAgent || '');
    if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
      return true;
    }

    if (/iPad/i.test(ua)) return false;

    var coarsePointer = false;
    var narrowViewport = false;
    try {
      coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      narrowViewport = window.matchMedia('(max-width: 820px)').matches;
    } catch (_error) {}

    return coarsePointer && narrowViewport;
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
    if (!resolvedTone && parts.imageEl && parts.imageEl.dataset) {
      resolvedTone = parts.imageEl.dataset.localAssetTone || '';
    }
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

    if (currentIndex === 0 && !isLikelyMobileClient()) {
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
    var renderedTemplate = document.createElement('template');
    renderedTemplate.innerHTML = renderMarkdown(slides[currentIndex]);
    resolveRelativeAssets(renderedTemplate.content, currentBaseUrl);
    slideEl.innerHTML = '';
    while (renderedTemplate.content.firstChild) {
      slideEl.appendChild(renderedTemplate.content.firstChild);
    }
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

    var hashToken = deckHashToken + 1;
    deckHashToken = hashToken;
    currentDeckContentHash = '';
    currentDeckHashPending = true;

    slides = splitSlides(trimmed);
    currentSourceQuery = String(sourceQueryValue || '').trim();
    currentSourceIsExplicit = Boolean(
      currentSourceQuery &&
      sourceIsExplicit &&
      getSourceProtocol(currentSourceQuery) !== LOCAL_DROP_SOURCE_PREFIX
    );
    if (currentSourceIsExplicit) rememberSourceForFileName(currentSourceQuery);
    currentIndex = resolveInitialSlideIndex(currentSourceQuery, slides);
    sourceLabelEl.textContent = sourceLabel || '';
    currentBaseUrl = typeof baseUrl === 'string' ? baseUrl : window.location.href;
    hashMarkdownContent(trimmed).then(function (hash) {
      if (hashToken !== deckHashToken) return;
      currentDeckContentHash = hash;
      return restorePersistedLocalAssetContext(hash, getCurrentDeckContextKey(), hashToken).then(function (restored) {
        if (hashToken !== deckHashToken) return;
        currentDeckHashPending = false;
        if (!restored) updateView();
      });
    });
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
    var normalized = String(value || '').trim();
    if (normalized.indexOf(LOCAL_DROP_SOURCE_PREFIX) === 0) return true;
    try {
      var parsed = new URL(normalized);
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
    if (!normalizedName) return { source: '', strong: false };

    var candidates = [];
    var rememberedSource = getRememberedSourceForFileName(normalizedName);
    if (rememberedSource) {
      pushUniqueCandidate(candidates, JSON.stringify({ source: rememberedSource, strong: true }));
    }

    var querySource = stripSourceAnchor(getSourceFromQuery());
    var knownSources = [];
    if (querySource && looksLikeLoadableSource(querySource) && getSourceProtocol(querySource) !== LOCAL_DROP_SOURCE_PREFIX) {
      pushUniqueCandidate(knownSources, JSON.stringify({ source: querySource, strong: true }));
    }
    if (currentSourceIsExplicit) {
      pushUniqueCandidate(knownSources, JSON.stringify({ source: stripSourceAnchor(currentSourceQuery), strong: true }));
      pushUniqueCandidate(knownSources, JSON.stringify({ source: currentBaseUrl, strong: true }));
    }
    if (window.location.protocol === 'file:') {
      pushUniqueCandidate(knownSources, JSON.stringify({ source: window.location.href, strong: false }));
    }

    knownSources.forEach(function (entryText) {
      if (!entryText) return;
      var entry;
      try {
        entry = JSON.parse(entryText);
      } catch (_parseError) {
        return;
      }
      try {
        pushUniqueCandidate(candidates, JSON.stringify({
          source: new URL(normalizedName, entry.source).href,
          strong: Boolean(entry.strong)
        }));
      } catch (_error) {}
    });

    for (var index = 0; index < candidates.length; index += 1) {
      var candidate;
      try {
        candidate = JSON.parse(candidates[index]);
      } catch (_error) {
        continue;
      }
      if (looksLikeLoadableSource(candidate.source)) {
        debugLog('getDroppedFileSource:inferred-from-context', candidate);
        return candidate;
      }
    }

    return { source: '', strong: false };
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
      if (inferredFromContext.source) {
        return { source: inferredFromContext.source, explicit: false, strong: Boolean(inferredFromContext.strong) };
      }
    }

    return { source: '', explicit: false, strong: false };
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

    if (protocol === LOCAL_DROP_SOURCE_PREFIX) {
      var cachedLocalDrop = getCachedLocalDropContent(fetchSource);
      if (!cachedLocalDrop) {
        throw new Error('Local dropped file is no longer cached in this browser.');
      }
      loadMarkdown(cachedLocalDrop, normalizedSource + ' (cached)', '', normalizedSource, true);
      return;
    }

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
    rootEl.querySelectorAll('img[src]').forEach(function (img) {
      var src = img.getAttribute('src') || '';
      if (!looksRelativePath(src)) return;

      var resolvedLocalAsset = resolveLocalAssetUrl(src);
      if (resolvedLocalAsset) {
        img.setAttribute('src', resolvedLocalAsset);
        var assetTone = resolveLocalAssetTone(src);
        if (assetTone) {
          img.dataset.localAssetTone = assetTone;
        } else {
          delete img.dataset.localAssetTone;
        }
        return;
      }

      if (baseUrl) {
        try {
          img.setAttribute('src', new URL(src, baseUrl).href);
          return;
        } catch (_error) {}
      }

      if (currentDeckHashPending && canPersistDirectoryHandles()) {
        img.remove();
        return;
      }

      img.replaceWith(createMissingAssetPlaceholder(src));
    });

    if (!baseUrl) return;

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
          explicit: Boolean(droppedSourceInfo.explicit),
          strong: Boolean(droppedSourceInfo.strong)
        });

        if (fileSource && looksLikeLoadableSource(fileSource) && (droppedSourceInfo.explicit || droppedSourceInfo.strong)) {
          debugLog('handleDrop:file-loadable-source', fileSource);
          updateSourceQuery(fileSource);
          var droppedProtocol = '';
          try {
            droppedProtocol = new URL(fileSource).protocol;
          } catch (_protocolError) {}

          if (droppedProtocol === 'file:') {
            var droppedFileText = await file.text();
            cacheFileSourceContent(fileSource, droppedFileText);
            if (droppedSourceInfo.explicit) {
              markVerifiedFileSource(fileSource);
            }
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
        var localDropSource = createLocalDropSource(file.name || 'local file');
        cacheLocalDropContent(localDropSource, fileText);
        updateSourceQuery(localDropSource);
        loadMarkdown(fileText, file.name || 'local file', baseForFile || '', localDropSource, true);
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
    if (queryProtocol === LOCAL_DROP_SOURCE_PREFIX) {
      var cachedLocalDropContent = getCachedLocalDropContent(sourceFromQuery);
      if (cachedLocalDropContent) {
        loadMarkdown(cachedLocalDropContent, sourceFromQuery + ' (cached)', '', sourceFromQuery, true);
      } else {
        loadMarkdown(
          '# Load error\n\nCould not load cached local drop from URL query.\n\nDrop that file again in this browser.',
          'error',
          window.location.href,
          '',
          false
        );
      }
    } else if (queryProtocol === 'file:') {
      var cachedFileContent = getCachedFileSourceContent(sourceFromQuery);
      if (cachedFileContent) {
        var verifiedFileSource = isVerifiedFileSource(sourceFromQuery);
        loadMarkdown(
          cachedFileContent,
          sourceFromQuery + (verifiedFileSource ? ' (cached)' : ' (cached, unresolved path)'),
          verifiedFileSource ? sourceFromQuery : '',
          sourceFromQuery,
          verifiedFileSource
        );
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
