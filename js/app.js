(function () {
  'use strict';

  var app = document.getElementById('app');
  var dropzone = document.getElementById('dropzone');
  var slideWrap = document.getElementById('slideWrap');
  var slideEl = document.getElementById('slide');
  var printDeckEl = document.getElementById('printDeck');
  var pagerEl = document.getElementById('pager');
  var sourceLabelEl = document.getElementById('sourceLabel');
  var brandHomeLinkEl = document.getElementById('brandHomeLink');
  var fontDecreaseBtnEl = document.getElementById('fontDecreaseBtn');
  var fontResetBtnEl = document.getElementById('fontResetBtn');
  var fontIncreaseBtnEl = document.getElementById('fontIncreaseBtn');
  var lightModeBtnEl = document.getElementById('lightModeBtn');
  var darkModeBtnEl = document.getElementById('darkModeBtn');
  var devWatchGroupEl = document.getElementById('devWatchGroup');
  var watchSourceBtnEl = document.getElementById('watchSourceBtn');
  var themePresetGroupEl = document.getElementById('themePresetGroup');

  var slides = [];
  var currentIndex = 0;
  var touchStartX = 0;
  var touchStartY = 0;
  var pointerDownX = 0;
  var pointerDownY = 0;
  var dragDepth = 0;
  var currentBaseUrl = window.location.href;
  var currentSourceQuery = '';
  var currentSourceDisplay = '';
  var currentSourceIsExplicit = false;
  var mermaidReady = false;
  var markedReady = false;
  var mermaidRenderCount = 0;
  var viewRenderToken = 0;
  var printRenderToken = 0;
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
  var LOCAL_ASSET_DB_VERSION = 2;
  var LOCAL_ASSET_STORE = 'deck-contexts';
  var WATCHED_FILE_STORE = 'watched-files';
  var WATCHED_FILE_KEY = 'active';
  var UI_PREFS_STORAGE_KEY = 'clicker.page.ui-prefs:v1';
  var contentScale = 1;
  var currentTheme = 'light';
  var currentPreset = 'default';
  var themePresetButtons = [];
  var slideRevealProgress = {};
  var watchedFileHandle = null;
  var watchedFileText = '';
  var watchedSourceQuery = '';
  var watchPollTimer = 0;
  var watchPollBusy = false;
  var THEME_PRESETS = [
    { id: 'default', symbol: '○', name: 'Default' },
    { id: 'ledger', symbol: '▦', name: 'Ledger / Terminal' },
    { id: 'blueprint', symbol: '⌘', name: 'Blueprint / Midnight Ops' },
    { id: 'ivory', symbol: '◫', name: 'Ivory / Signal' }
  ];

  function debugLog(message, details) {
    var stamp = new Date().toISOString();
    if (typeof details === 'undefined') {
      console.log('[clicker.page]', stamp, message);
      return;
    }
    console.log('[clicker.page]', stamp, message, details);
  }

  function isLocalAppMode() {
    return window.location.protocol === 'file:';
  }

  function clamp(number, min, max) {
    return Math.max(min, Math.min(max, number));
  }

  function loadUiPreferences() {
    try {
      var raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (typeof parsed.contentScale === 'number' && Number.isFinite(parsed.contentScale)) {
        contentScale = clamp(parsed.contentScale, 0.75, 1.45);
      }
      if (parsed.theme === 'dark' || parsed.theme === 'light') {
        currentTheme = parsed.theme;
      }
      if (typeof parsed.preset === 'string' && THEME_PRESETS.some(function (preset) { return preset.id === parsed.preset; })) {
        currentPreset = parsed.preset;
      }
    } catch (_error) {}
  }

  function saveUiPreferences() {
    try {
      localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify({
        contentScale: contentScale,
        theme: currentTheme,
        preset: currentPreset
      }));
    } catch (_error) {}
  }

  function updateThemeButtons() {
    if (lightModeBtnEl) lightModeBtnEl.classList.toggle('is-active', currentTheme === 'light');
    if (darkModeBtnEl) darkModeBtnEl.classList.toggle('is-active', currentTheme === 'dark');
    if (watchSourceBtnEl) {
      var watchActive = Boolean(watchedFileHandle);
      watchSourceBtnEl.classList.toggle('is-active', watchActive);
      watchSourceBtnEl.setAttribute(
        'title',
        watchActive
          ? 'Watch local source file for changes (active)'
          : 'Watch local source file for changes'
      );
      watchSourceBtnEl.setAttribute(
        'aria-label',
        watchActive
          ? 'Watch local source file for changes, active'
          : 'Watch local source file for changes'
      );
    }
    themePresetButtons.forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.presetId === currentPreset);
    });
  }

  function applyUiPreferences() {
    document.documentElement.style.setProperty('--content-scale', String(contentScale));
    document.body.classList.toggle('theme-dark', currentTheme === 'dark');
    document.body.classList.toggle('theme-light', currentTheme !== 'dark');
    document.body.setAttribute('data-preset', currentPreset);
    updateThemeButtons();
  }

  function setTheme(theme) {
    if (theme !== 'dark' && theme !== 'light') return;
    if (currentTheme === theme) return;
    currentTheme = theme;
    applyUiPreferences();
    saveUiPreferences();
  }

  function stopWatchingSourceFile() {
    watchedFileHandle = null;
    watchedFileText = '';
    watchedSourceQuery = '';
    watchPollBusy = false;
    if (watchPollTimer) {
      window.clearInterval(watchPollTimer);
      watchPollTimer = 0;
    }
    updateThemeButtons();
  }

  async function activateWatchedSourceHandle(handle, preferredSourceQuery) {
    if (!handle) return false;

    var file = await handle.getFile();
    var text = await file.text();
    var preferred = String(preferredSourceQuery || '').trim();
    var preferredProtocol = getSourceProtocol(preferred);
    var sourceBase = preferredProtocol === LOCAL_DROP_SOURCE_PREFIX
      ? stripSourceAnchor(preferred)
      : createLocalDropSource(handle.name || file.name || 'local file');
    var preferredAnchor = getSourceAnchor(preferred);
    var sourceWithAnchor = preferredAnchor ? sourceBase + '#' + encodeURIComponent(preferredAnchor) : sourceBase;

    watchedFileHandle = handle;
    watchedFileText = text;
    watchedSourceQuery = sourceBase;

    cacheLocalDropContent(sourceBase, text);
    updateSourceQuery(sourceWithAnchor);
    loadMarkdown(text, file.name || handle.name || sourceBase, '', sourceWithAnchor, true);

    if (watchPollTimer) window.clearInterval(watchPollTimer);
    watchPollTimer = window.setInterval(pollWatchedSourceFile, 1500);
    updateThemeButtons();
    return true;
  }

  function setPreset(presetId) {
    if (!THEME_PRESETS.some(function (preset) { return preset.id === presetId; })) return;
    if (currentPreset === presetId) return;
    currentPreset = presetId;
    applyUiPreferences();
    saveUiPreferences();
    updateView();
    rebuildPrintDeck();
  }

  function adjustContentScale(delta) {
    var nextScale = clamp(Math.round((contentScale + delta) * 100) / 100, 0.75, 1.45);
    if (nextScale === contentScale) return;
    contentScale = nextScale;
    applyUiPreferences();
    saveUiPreferences();
    updateView();
    rebuildPrintDeck();
  }

  function resetContentScale() {
    if (contentScale === 1) return;
    contentScale = 1;
    applyUiPreferences();
    saveUiPreferences();
    updateView();
    rebuildPrintDeck();
  }

  function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('input, textarea, select')) return true;
    return Boolean(target.closest('[contenteditable], [contenteditable="true"], [contenteditable="plaintext-only"]'));
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

  function createThemePresetButtons() {
    if (!themePresetGroupEl) return;
    themePresetGroupEl.innerHTML = '';
    themePresetButtons = [];

    THEME_PRESETS.forEach(function (preset) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'header-btn header-btn--theme-preset';
      button.textContent = preset.symbol;
      button.title = preset.name;
      button.setAttribute('aria-label', preset.name);
      button.dataset.presetId = preset.id;
      button.addEventListener('click', function () {
        setPreset(preset.id);
      });
      themePresetGroupEl.appendChild(button);
      themePresetButtons.push(button);
    });
  }

  createThemePresetButtons();
  loadUiPreferences();
  applyUiPreferences();

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseMarkdownImageSource(rawHref) {
    var normalized = String(rawHref || '').trim();
    var match = /^(.*?)(?:\s+=\s*(\d*)x(\d*))$/.exec(normalized);
    if (!match) {
      return { href: normalized, style: '' };
    }

    var href = String(match[1] || '').trim();
    var width = String(match[2] || '').trim();
    var height = String(match[3] || '').trim();
    var styleParts = [];

    if (width) styleParts.push('width:' + width + 'px');
    if (height) styleParts.push('height:' + height + 'px');

    return {
      href: href,
      style: styleParts.join(';')
    };
  }

  function preprocessMarkdownImageSizing(markdown) {
    return String(markdown || '').replace(/!\[([^\]]*)\]\(([^)\n]+?)\s+=\s*(\d*)x(\d*)\)/g, function (_match, alt, rawHref, width, height) {
      var parsed = parseMarkdownImageSource(String(rawHref || '').trim() + ' =' + String(width || '') + 'x' + String(height || ''));
      var attributes = ' data-clicker-src="' + escapeHtml(parsed.href) + '" alt="' + escapeHtml(alt || '') + '"';
      if (parsed.style) {
        attributes += ' style="' + escapeHtml(parsed.style) + '"';
      }
      return '<img' + attributes + '>';
    });
  }

  function isPlainBlockquoteLine(content) {
    var normalized = String(content || '').trim();
    if (!normalized) return true;
    return !/^([>*-]\s|#{1,6}\s|\d+[.)]\s|`{3,}|~{3,}|<|!?\[|[|])/.test(normalized);
  }

  function preprocessBlockquoteLineBreaks(markdown) {
    var lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    var output = [];
    var quoteBuffer = [];

    function flushPlainQuoteRun(run) {
      if (run.length <= 1) {
        run.forEach(function (entry) {
          output.push(entry.raw);
        });
        return;
      }

      run.forEach(function (entry, index) {
        var suffix = index < run.length - 1 ? '<br>' : '';
        output.push(entry.prefix + entry.content.replace(/\s+$/, '') + suffix);
      });
    }

    function flushQuoteBuffer() {
      var plainRun = [];

      function flushPendingPlainRun() {
        if (!plainRun.length) return;
        flushPlainQuoteRun(plainRun);
        plainRun = [];
      }

      quoteBuffer.forEach(function (entry) {
        if (isPlainBlockquoteLine(entry.content)) {
          plainRun.push(entry);
          return;
        }
        flushPendingPlainRun();
        output.push(entry.raw);
      });

      flushPendingPlainRun();
      quoteBuffer = [];
    }

    lines.forEach(function (line) {
      var match = /^(\s*(?:>\s*)+)(.*)$/.exec(line);
      if (!match) {
        flushQuoteBuffer();
        output.push(line);
        return;
      }

      quoteBuffer.push({
        raw: line,
        prefix: match[1],
        content: match[2]
      });
    });

    flushQuoteBuffer();
    return output.join('\n');
  }

  function applyImageSizingAttributes(img, parsedImageSource) {
    if (!img || !parsedImageSource || !parsedImageSource.style) return;
    var existingStyle = img.getAttribute('style') || '';
    var nextStyle = existingStyle ? existingStyle.replace(/;?\s*$/, ';') + parsedImageSource.style : parsedImageSource.style;
    img.setAttribute('style', nextStyle);
  }

  function ensureMarked() {
    if (!(window.marked && typeof window.marked.parse === 'function')) return false;
    if (markedReady) return true;
    if (typeof window.marked.use !== 'function') return true;

    window.marked.use({
      renderer: {
        strong: function (text) {
          return '<strong class="md-strong-marker">' + text + '</strong>';
        },
        image: function (href, title, text) {
          var parsed = parseMarkdownImageSource(href);
          var attributes = ' data-clicker-src="' + escapeHtml(parsed.href) + '" alt="' + escapeHtml(text) + '"';
          if (title) {
            attributes += ' title="' + escapeHtml(title) + '"';
          }
          if (parsed.style) {
            attributes += ' style="' + escapeHtml(parsed.style) + '"';
          }
          return '<img' + attributes + '>';
        }
      }
    });

    markedReady = true;
    return true;
  }

  function renderMarkdown(markdown) {
    if (ensureMarked()) {
      return window.marked.parse(
        preprocessBlockquoteLineBreaks(preprocessMarkdownImageSizing(markdown || ''))
      ).replace(/<img\b([^>]*?)\ssrc=(["'])(.*?)\2([^>]*)>/gi, '<img$1 data-clicker-src=$2$3$2$4>');
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
        if (!db.objectStoreNames.contains(WATCHED_FILE_STORE)) {
          db.createObjectStore(WATCHED_FILE_STORE);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
    });
  }

  function withLocalAssetStore(mode, worker, storeName) {
    return openLocalAssetDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var targetStore = storeName || LOCAL_ASSET_STORE;
        var tx = db.transaction(targetStore, mode);
        var store = tx.objectStore(targetStore);
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

  function persistWatchedFileHandle(handle) {
    if (!handle || !window.indexedDB) return Promise.resolve();
    return withLocalAssetStore('readwrite', function (store) {
      return store.put(handle, WATCHED_FILE_KEY);
    }, WATCHED_FILE_STORE).then(function () {
      debugLog('watchedFileHandle:stored', { name: handle.name || '(unknown)' });
    }).catch(function (error) {
      debugLog('watchedFileHandle:store-failed', String(error));
    });
  }

  function loadPersistedWatchedFileHandle() {
    if (!window.indexedDB) return Promise.resolve(null);
    return withLocalAssetStore('readonly', function (store) {
      return store.get(WATCHED_FILE_KEY);
    }, WATCHED_FILE_STORE).then(function (handle) {
      debugLog('watchedFileHandle:lookup', { hit: Boolean(handle) });
      return handle || null;
    }).catch(function (error) {
      debugLog('watchedFileHandle:read-failed', String(error));
      return null;
    });
  }

  function deletePersistedWatchedFileHandle() {
    if (!window.indexedDB) return Promise.resolve();
    return withLocalAssetStore('readwrite', function (store) {
      return store.delete(WATCHED_FILE_KEY);
    }, WATCHED_FILE_STORE).then(function () {
      debugLog('watchedFileHandle:deleted');
    }).catch(function (error) {
      debugLog('watchedFileHandle:delete-failed', String(error));
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
    rebuildPrintDeck();
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
    rebuildPrintDeck();
  }

  async function createLocalAssetContext(entries, options) {
    var mapping = {};
    var urls = [];
    var normalizedEntries = Array.from(entries || []);
    var settings = options || {};
    var stripTopDirectory = Boolean(settings.stripTopDirectory);

    for (var entryIndex = 0; entryIndex < normalizedEntries.length; entryIndex += 1) {
      var entry = normalizedEntries[entryIndex];
      if (!entry || !entry.file) continue;
      var file = entry.file;
      var relativePath = String(entry.relativePath || file.webkitRelativePath || file.name || '').trim();
      if (!relativePath) continue;

      var normalizedPath = relativePath.replace(/\\/g, '/');
      var slashIndex = normalizedPath.indexOf('/');
      if (stripTopDirectory && slashIndex !== -1) {
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
    return createLocalAssetContext(collectedFiles, { stripTopDirectory: false });
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
        }), { stripTopDirectory: true }).then(function (context) {
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

  function isExternalLinkHref(href) {
    var normalized = String(href || '').trim();
    if (!normalized) return false;

    var parsed;
    try {
      parsed = new URL(normalized, window.location.href);
    } catch (_error) {
      return false;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return true;
    return parsed.origin !== window.location.origin;
  }

  function applyExternalLinkBehavior(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('a[href]').forEach(function (anchor) {
      var href = anchor.getAttribute('href') || '';
      if (isExternalLinkHref(href)) {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else {
        anchor.removeAttribute('target');
        anchor.removeAttribute('rel');
      }
    });
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

  function canUseLocalWatch() {
    return Boolean(isLocalAppMode() && window.showOpenFilePicker);
  }

  function renderBootstrapScreen(title, bodyHtml, actionsHtml) {
    slides = [];
    slideRevealProgress = {};
    currentIndex = 0;
    currentSourceQuery = '';
    currentSourceDisplay = '';
    currentSourceIsExplicit = false;
    currentBaseUrl = '';
    currentDeckContentHash = '';
    currentDeckHashPending = false;
    updateHeaderSourceLabel();
    slideEl.innerHTML =
      '<section class="bootstrap-screen">' +
        '<h2>' + String(title || '') + '</h2>' +
        '<div class="bootstrap-screen__body">' + String(bodyHtml || '') + '</div>' +
        (actionsHtml ? '<div class="bootstrap-screen__actions">' + actionsHtml + '</div>' : '') +
      '</section>';
    dropzone.style.display = 'none';
    slideWrap.style.display = 'block';
    pagerEl.textContent = '';
    pagerEl.style.display = 'none';
    if (printDeckEl) printDeckEl.innerHTML = '';
  }

  async function promptForDefaultReadmeAccess(readmeSource) {
    if (!window.showOpenFilePicker) return;

    try {
      var handles = await window.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: [{
          description: 'Markdown files',
          accept: {
            'text/markdown': ['.md', '.markdown', '.mdown', '.mkd']
          }
        }]
      });
      var handle = handles && handles[0];
      if (!handle) return;

      var file = await handle.getFile();
      var text = await file.text();
      var localDropSource = createLocalDropSource(file.name || 'README.md');
      cacheLocalDropContent(localDropSource, text);
      updateSourceQuery(localDropSource);
      loadMarkdown(text, file.name || 'README.md', '', localDropSource, true);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      debugLog('defaultReadme:pick-failed', String(error));
    }
  }

  function showDefaultReadmeBootstrap(readmeSource) {
    var buttonHtml = window.showOpenFilePicker
      ? '<button class="bootstrap-action-btn" id="openDefaultReadmeBtn" type="button">Open README.md</button>'
      : '';

    renderBootstrapScreen(
      'Open README.md',
      '<p>The default deck lives in <code>README.md</code>.</p>' +
      '<p>This browser blocks automatic local <code>file://</code> reads, so one explicit action is required.</p>',
      buttonHtml
    );

    var openBtn = document.getElementById('openDefaultReadmeBtn');
    if (openBtn) {
      openBtn.addEventListener('click', function () {
        promptForDefaultReadmeAccess(readmeSource);
      });
    }
  }

  function updateDevWatchAvailability() {
    if (!devWatchGroupEl) return;
    var enabled = canUseLocalWatch();
    devWatchGroupEl.hidden = !enabled;
    if (!enabled) {
      stopWatchingSourceFile();
    }
  }

  async function pollWatchedSourceFile() {
    if (!watchedFileHandle || watchPollBusy) return;
    watchPollBusy = true;

    try {
      var file = await watchedFileHandle.getFile();
      var nextText = await file.text();
      if (nextText === watchedFileText) return;

      watchedFileText = nextText;
      if (watchedSourceQuery) {
        var preservedSourceQuery = stripSourceAnchor(watchedSourceQuery) + '#' + encodeURIComponent(getCurrentSlideAnchor());
        if (getSourceProtocol(watchedSourceQuery) === 'file:') {
          cacheFileSourceContent(watchedSourceQuery, nextText);
          markVerifiedFileSource(watchedSourceQuery);
        } else if (getSourceProtocol(watchedSourceQuery) === LOCAL_DROP_SOURCE_PREFIX) {
          cacheLocalDropContent(watchedSourceQuery, nextText);
        }
        loadMarkdown(
          nextText,
          preservedSourceQuery + ' (watch)',
          getSourceProtocol(watchedSourceQuery) === 'file:' ? stripSourceAnchor(watchedSourceQuery) : '',
          preservedSourceQuery,
          true
        );
      } else {
        loadMarkdown(nextText, file.name || 'watched file', '', '', false);
      }
    } catch (error) {
      debugLog('watchSource:poll-failed', String(error));
      deletePersistedWatchedFileHandle();
      stopWatchingSourceFile();
    } finally {
      watchPollBusy = false;
    }
  }

  async function enableLocalSourceWatch() {
    if (!canUseLocalWatch()) return;

    try {
      var handles = await window.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: false,
        types: [{
          description: 'Markdown files',
          accept: {
            'text/markdown': ['.md', '.markdown', '.mdown', '.mkd']
          }
        }]
      });
      var handle = handles && handles[0];
      if (!handle) return;

      await persistWatchedFileHandle(handle);
      await activateWatchedSourceHandle(handle, currentSourceQuery);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      debugLog('watchSource:enable-failed', String(error));
      stopWatchingSourceFile();
    }
  }

  async function restorePersistedWatchedSourceOnStartup(preferredSourceQuery) {
    if (!canUseLocalWatch() || !window.indexedDB) return false;

    var handle = await loadPersistedWatchedFileHandle();
    if (!handle) return false;

    var permission = 'prompt';
    try {
      permission = await handle.queryPermission({ mode: 'read' });
    } catch (_error) {}
    if (permission !== 'granted') return false;

    try {
      await activateWatchedSourceHandle(handle, preferredSourceQuery);
      debugLog('watchSource:restored', { name: handle.name || '(unknown)' });
      return true;
    } catch (error) {
      debugLog('watchSource:restore-failed', String(error));
      await deletePersistedWatchedFileHandle();
      stopWatchingSourceFile();
      return false;
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
    button.textContent = '⧉';
    button.setAttribute('aria-label', 'Copy code to clipboard');
    button.setAttribute('title', 'Copy code');

    button.addEventListener('click', async function () {
      var originalLabel = button.textContent;
      button.disabled = true;
      try {
        await copyToClipboard(getText());
        button.textContent = '✓';
      } catch (_error) {
        button.textContent = '!';
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
      function normalizeMermaidSource(input) {
        return String(input || '')
          .replace(/→|⇒|⟶/g, '->')
          .replace(/\r\n/g, '\n');
      }

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

        function attemptRender(sourceText, allowRetry) {
          try {
            var maybeResult = window.mermaid.render(renderId, sourceText);

            if (maybeResult && typeof maybeResult.then === 'function') {
              maybeResult.then(function (result) {
                setRendered(result);
              }).catch(function () {
                if (allowRetry) {
                  attemptRender(normalizeMermaidSource(source), false);
                } else {
                  setRendered(null);
                }
              });
            } else if (typeof maybeResult !== 'undefined') {
              setRendered(maybeResult);
            } else {
              window.setTimeout(function () {
                if (!settled) setRendered(null);
              }, 800);
            }
          } catch (_error) {
            if (allowRetry) {
              attemptRender(normalizeMermaidSource(source), false);
            } else {
              setRendered(null);
            }
          }
        }

        attemptRender(source, true);
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
      var nextRenderId = 'mermaid-diagram-' + String(mermaidRenderCount);
      mermaidRenderCount += 1;
      queue = queue.then(function () {
        return renderMermaidDiagram(nextRenderId, entry.source, entry.graph);
      });
    });
    return queue;
  }

  function applyChainEffects(rootEl) {
    var chainPattern = /([A-Za-z0-9_./()[\]-]+(?:\s*(?:->|→|⇒|⟶)\s*[A-Za-z0-9_./()[\]-]+)+|^\s*(?:->|→|⇒|⟶)[^\n]+)/g;
    var candidates = rootEl.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th');

    candidates.forEach(function (element) {
      if (element.closest('pre, code, .mermaid-block')) return;
      if (element.querySelector('pre, code, .mermaid-block, img, svg')) return;
      if (element.querySelector('.chain-warp')) return;

      chainPattern.lastIndex = 0;
      if (!chainPattern.test(element.textContent || '')) {
        chainPattern.lastIndex = 0;
        return;
      }
      chainPattern.lastIndex = 0;

      var warp = document.createElement('span');
      warp.className = 'chain-warp chain-warp--line';

      var label = document.createElement('span');
      label.className = 'chain-warp__label';

      while (element.firstChild) {
        label.appendChild(element.firstChild);
      }

      warp.appendChild(label);
      element.appendChild(warp);
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

    var qrAttribution = document.createElement('p');
    qrAttribution.className = 'slide-qr-caption slide-qr-caption--attribution';
    qrAttribution.appendChild(document.createTextNode('Made with '));

    var qrAttributionLink = document.createElement('a');
    qrAttributionLink.href = 'https://clicker.page';
    qrAttributionLink.textContent = 'https://clicker.page';
    qrAttributionLink.target = '_blank';
    qrAttributionLink.rel = 'noopener noreferrer';
    qrAttribution.appendChild(qrAttributionLink);

    qrCard.appendChild(qrTitle);
    qrCard.appendChild(qrCode);
    qrCard.appendChild(qrCaption);
    qrCard.appendChild(qrAttribution);

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
      if (tagName === 'IMG' || tagName === 'SVG') return child;
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
      if (tagName === 'IMG' || tagName === 'SVG') return child;
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

  function getLeadSplitMedia(containerEl) {
    var imageEl = getLeadImageElement(containerEl);
    if (imageEl) {
      return {
        kind: 'image',
        element: imageEl,
        host: imageEl.parentElement === containerEl ? containerEl : imageEl
      };
    }

    if (!containerEl) return null;
    if (containerEl.classList && containerEl.classList.contains('mermaid-block')) {
      return {
        kind: 'mermaid',
        element: containerEl,
        host: containerEl
      };
    }

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

  function getRevealRoot(rootEl) {
    if (!rootEl) return null;
    return rootEl.querySelector('.slide-split-pane--content, .slide-split-pane--content-first') || rootEl;
  }

  function getDirectListItems(listEl) {
    return Array.from(listEl.children || []).filter(function (child) {
      return child.tagName && child.tagName.toUpperCase() === 'LI';
    });
  }

  function getEligibleRevealList(rootEl) {
    var revealRoot = getRevealRoot(rootEl);
    if (!revealRoot) return null;

    var lastMeaningful = getLastMeaningfulElement(revealRoot);
    if (!lastMeaningful) return null;
    if (!lastMeaningful.tagName || lastMeaningful.tagName.toUpperCase() !== 'UL') return null;
    if (lastMeaningful.parentElement !== revealRoot) return null;

    var items = getDirectListItems(lastMeaningful);
    if (items.length < 2) return null;

    return {
      listEl: lastMeaningful,
      items: items
    };
  }

  function clearBulletRevealState(rootEl) {
    if (!rootEl) return;
    rootEl.__revealListState = null;
    rootEl.querySelectorAll('.reveal-list').forEach(function (listEl) {
      listEl.classList.remove('reveal-list');
    });
    rootEl.querySelectorAll('.reveal-item--hidden').forEach(function (itemEl) {
      itemEl.classList.remove('reveal-item--hidden');
    });
    rootEl.querySelectorAll('.reveal-item--next-cue').forEach(function (itemEl) {
      itemEl.classList.remove('reveal-item--next-cue');
    });
  }

  function applyBulletReveal(rootEl, slideIndex, enabled) {
    clearBulletRevealState(rootEl);
    if (!enabled) return;

    var reveal = getEligibleRevealList(rootEl);
    if (!reveal) return;

    var total = reveal.items.length;
    var visibleCount = Number(slideRevealProgress[slideIndex]);
    if (!Number.isFinite(visibleCount)) visibleCount = 1;
    visibleCount = clamp(Math.floor(visibleCount), 1, total);
    slideRevealProgress[slideIndex] = visibleCount;

    reveal.listEl.classList.add('reveal-list');
    reveal.items.forEach(function (itemEl, index) {
      itemEl.classList.toggle('reveal-item--hidden', index >= visibleCount);
      itemEl.classList.toggle('reveal-item--next-cue', index === visibleCount - 1 && visibleCount < total);
    });

    rootEl.__revealListState = {
      slideIndex: slideIndex,
      visibleCount: visibleCount,
      total: total
    };
  }

  function stepBulletReveal(direction) {
    var state = slideEl && slideEl.__revealListState;
    if (!state || state.slideIndex !== currentIndex) return false;

    if (direction > 0) {
      if (state.visibleCount >= state.total) return false;
      slideRevealProgress[currentIndex] = state.visibleCount + 1;
    } else {
      if (state.visibleCount <= 1) return false;
      slideRevealProgress[currentIndex] = state.visibleCount - 1;
    }

    applyBulletReveal(slideEl, currentIndex, true);
    return true;
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

  async function applySlideLayout(rootEl, renderToken, slideIndex, options) {
    var settings = options || {};
    rootEl.classList.remove('slide--split');
    rootEl.classList.remove('slide--intro-qr');
    rootEl.classList.remove('slide--image-hero');

    if (slideIndex === 0 && settings.allowIntroQr !== false && !isLikelyMobileClient()) {
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
    var leadMedia = getLeadSplitMedia(leadingElement);
    var trailingElement = getLastMeaningfulElement(rootEl);
    var tailMedia = getLeadSplitMedia(trailingElement);
    var splitSide = '';
    var splitMedia = null;

    if (leadMedia) {
      splitSide = 'left';
      splitMedia = leadMedia;
    } else if (tailMedia) {
      splitSide = 'right';
      splitMedia = tailMedia;
    } else {
      return;
    }

    if (splitMedia.kind === 'image') {
      var loaded = await waitForImageLoad(splitMedia.element);
      if (!loaded || renderToken !== viewRenderToken) return;
    }

    var mediaHost = splitMedia.host;
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

    if (mediaHost && mediaHost.parentElement === rootEl) {
      rootEl.removeChild(mediaHost);
    }
    mediaPane.appendChild(mediaHost);

    while (rootEl.firstChild) {
      contentPane.appendChild(rootEl.firstChild);
    }

    rootEl.appendChild(splitLayout);
    rootEl.classList.add('slide--split');
  }

  function mountRenderedContent(targetEl, renderedRoot) {
    targetEl.innerHTML = '';
    while (renderedRoot.firstChild) {
      targetEl.appendChild(renderedRoot.firstChild);
    }
  }

  function renderSlideInto(targetEl, slideMarkdown, slideIndex, renderToken, options) {
    var settings = options || {};
    var revealSlideIndex = typeof settings.revealSlideIndex === 'number' ? settings.revealSlideIndex : slideIndex;
    var layoutSlideIndex = typeof settings.layoutSlideIndex === 'number' ? settings.layoutSlideIndex : slideIndex;
    var renderedTemplate = document.createElement('template');
    renderedTemplate.innerHTML = renderMarkdown(slideMarkdown);
    resolveRelativeAssets(renderedTemplate.content, settings.baseUrl);
    applyExternalLinkBehavior(renderedTemplate.content);
    mountRenderedContent(targetEl, renderedTemplate.content);
    var mermaidRender = renderMermaidBlocks(targetEl);
    enhanceCodeBlocks(targetEl);
    enhanceTables(targetEl);
    return Promise.resolve(mermaidRender).then(function () {
      applyChainEffects(targetEl);
      return applySlideLayout(targetEl, renderToken, layoutSlideIndex, settings);
    }).then(function () {
      applyBulletReveal(targetEl, revealSlideIndex, settings.enableReveal !== false);
      fitCodeBlocks(targetEl);
      if (settings.animateMarkers === false) return;
      animateMarkerHighlights(targetEl, renderToken);
    });
  }

  function enhanceCodeBlocks(rootEl) {
    rootEl.querySelectorAll('pre > code').forEach(function (codeEl) {
      var pre = codeEl.parentElement;
      if (!pre || pre.querySelector('.copy-code-btn')) return;

      var source = codeEl.textContent || '';
      var lines = source.replace(/\r\n/g, '\n').split('\n');
      if (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
      }
      if (!lines.length) lines = [''];

      var codeTable = document.createElement('div');
      codeTable.className = 'code-table';

      lines.forEach(function (lineText, index) {
        var row = document.createElement('div');
        row.className = 'code-row';

        var lineNo = document.createElement('span');
        lineNo.className = 'code-line-no';
        lineNo.textContent = String(index + 1);

        var lineCode = document.createElement('span');
        lineCode.className = 'code-line-text';
        lineCode.textContent = lineText || ' ';

        row.appendChild(lineNo);
        row.appendChild(lineCode);
        codeTable.appendChild(row);
      });

      codeEl.replaceWith(codeTable);
      pre.appendChild(createCopyButton(function () { return source; }));
    });
  }

  function isImageOnlyTableCell(cellEl) {
    if (!cellEl) return false;
    if (!cellEl.querySelector('img')) return false;

    var clone = cellEl.cloneNode(true);
    clone.querySelectorAll('img').forEach(function (img) { img.remove(); });
    return !clone.textContent.trim();
  }

  function enhanceTables(rootEl) {
    if (!rootEl) return;

    rootEl.querySelectorAll('table').forEach(function (tableEl) {
      tableEl.classList.add('table-card');

      var hasImages = false;
      var onlyImageCells = true;
      var nonEmptyCellCount = 0;

      Array.from(tableEl.rows || []).forEach(function (rowEl) {
        Array.from(rowEl.cells || []).forEach(function (cellEl) {
          var hasContent = Boolean(cellEl.textContent.trim()) || Boolean(cellEl.querySelector('img, svg'));
          if (!hasContent) return;

          nonEmptyCellCount += 1;
          var imageOnly = isImageOnlyTableCell(cellEl);
          if (imageOnly) hasImages = true;
          if (!imageOnly) onlyImageCells = false;
        });
      });

      if (hasImages && onlyImageCells && nonEmptyCellCount > 0) {
        tableEl.classList.add('table-card--image-grid');
        return;
      }

      var rows = Array.from(tableEl.rows || []);
      var columnCount = rows.reduce(function (max, rowEl) {
        return Math.max(max, (rowEl.cells || []).length);
      }, 0);

      for (var columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        var numericCells = 0;
        var textCells = 0;

        rows.forEach(function (rowEl, rowIndex) {
          var cellEl = rowEl.cells && rowEl.cells[columnIndex];
          if (!cellEl) return;
          if (rowIndex === 0 && rowEl.parentElement && rowEl.parentElement.tagName && rowEl.parentElement.tagName.toUpperCase() === 'THEAD') {
            return;
          }

          var value = cellEl.textContent.trim();
          if (!value) return;
          if (/^[+\-]?(?:\d{1,3}(?:[,\s]\d{3})*|\d+)(?:\.\d+)?%?$/.test(value)) {
            numericCells += 1;
          } else {
            textCells += 1;
          }
        });

        var align = numericCells > 0 && textCells === 0 ? 'right' : 'left';
        tableEl.querySelectorAll('tr').forEach(function (rowEl) {
          var cellEl = rowEl.cells && rowEl.cells[columnIndex];
          if (!cellEl) return;
          cellEl.classList.toggle('table-align-right', align === 'right');
          cellEl.classList.toggle('table-align-left', align !== 'right');
        });
      }
    });
  }

  function fitCodeBlocks(rootEl) {
    if (!rootEl) return;

    rootEl.querySelectorAll('pre').forEach(function (pre) {
      var codeTable = pre.querySelector('.code-table');
      if (!codeTable) return;
      if (!pre.clientWidth) return;

      codeTable.style.fontSize = '';

      var scale = 1;
      var availableWidth = Math.max(1, pre.clientWidth - 12);
      var requiredWidth = Math.max(1, codeTable.scrollWidth);
      if (requiredWidth > availableWidth) {
        scale = Math.min(scale, availableWidth / requiredWidth);
      }

      var heightContainer = pre.closest('.slide-split-pane--content, .slide-split-pane--media, .slide');
      if (heightContainer) {
        var preRect = pre.getBoundingClientRect();
        var containerRect = heightContainer.getBoundingClientRect();
        var availableHeight = Math.max(1, containerRect.bottom - preRect.top - 8);
        var requiredHeight = Math.max(1, preRect.height);
        if (requiredHeight > availableHeight) {
          scale = Math.min(scale, availableHeight / requiredHeight);
        }
      }

      if (scale >= 0.999) return;
      codeTable.style.fontSize = String(clamp(scale, 0.42, 1) * 100) + '%';
    });
  }

  function splitSlides(markdown) {
    var lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    var chunks = [];
    var current = [];
    var activeFence = null;

    function pushCurrent() {
      var text = current.join('\n').trim();
      if (text) chunks.push(text);
      current = [];
    }

    lines.forEach(function (line, index) {
      var fenceMatch = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
      if (fenceMatch) {
        var fenceRun = fenceMatch[2];
        var fenceChar = fenceRun.charAt(0);
        if (!activeFence) {
          activeFence = {
            char: fenceChar,
            size: fenceRun.length
          };
        } else if (activeFence.char === fenceChar && fenceRun.length >= activeFence.size) {
          activeFence = null;
        }
        current.push(line);
        return;
      }

      if (activeFence) {
        current.push(line);
        return;
      }

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
    var totalSlides = slideList.length ? slideList.length + 1 : 0;

    var pageMatch = /^(?:page|slide)-?(\d+)$/.exec(anchor) || /^(\d+)$/.exec(anchor);
    if (pageMatch) {
      var oneBasedIndex = Number(pageMatch[1]);
      if (Number.isFinite(oneBasedIndex) && oneBasedIndex >= 1 && oneBasedIndex <= totalSlides) {
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

  function getVisibleSourceText(source) {
    var normalized = String(source || '').trim();
    if (!normalized) return '';
    if (getSourceProtocol(normalized) === LOCAL_DROP_SOURCE_PREFIX) {
      var withoutAnchor = stripLocalDropAnchor(normalized);
      var slashIndex = withoutAnchor.lastIndexOf('/');
      var encodedName = slashIndex === -1 ? withoutAnchor : withoutAnchor.slice(slashIndex + 1);
      return 'local:' + decodeURIComponent(encodedName || 'file.md');
    }
    return stripSourceAnchor(normalized);
  }

  function getVisibleSourceHref(source) {
    var normalized = String(source || '').trim();
    if (!normalized) return '';
    if (getSourceProtocol(normalized) === LOCAL_DROP_SOURCE_PREFIX) return '';
    return stripSourceAnchor(normalized);
  }

  function sanitizeSourceLabel(label) {
    return String(label || '')
      .replace(/\s+\(cached(?:, unresolved path)?\)$/i, '')
      .replace(/\s+\(watch\)$/i, '')
      .trim();
  }

  function deriveVisibleSourceDisplay(sourceLabel, sourceQueryValue) {
    var queryValue = String(sourceQueryValue || '').trim();
    if (!queryValue) return '';

    if (getSourceProtocol(queryValue) === LOCAL_DROP_SOURCE_PREFIX) {
      var cleanedLabel = sanitizeSourceLabel(sourceLabel);
      if (cleanedLabel && getSourceProtocol(cleanedLabel) !== LOCAL_DROP_SOURCE_PREFIX) {
        return 'local:' + cleanedLabel;
      }
    }

    return getVisibleSourceText(queryValue);
  }

  function getCurrentSlideAnchor() {
    if (slides.length && currentIndex === slides.length) {
      return 'slide-' + String(currentIndex + 1);
    }
    var headingAnchor = getSlideHeadingAnchor(slides[currentIndex] || '');
    if (headingAnchor) return headingAnchor;
    return 'slide-' + String(currentIndex + 1);
  }

  function getDisplaySlideCount() {
    if (!slides.length) return 0;
    return slides.length + 1;
  }

  function isVirtualRepeatSlide(index) {
    return Boolean(slides.length) && index === slides.length;
  }

  function getSlideMarkdownForDisplayIndex(index) {
    if (isVirtualRepeatSlide(index)) return slides[0] || '';
    return slides[index] || '';
  }

  function getLayoutSlideIndexForDisplayIndex(index) {
    if (isVirtualRepeatSlide(index)) return 0;
    return index;
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

  function updateHeaderSourceLabel() {
    var effectiveSource = currentSourceQuery || getSourceFromQuery() || '';
    var visibleSource = currentSourceDisplay || getVisibleSourceText(effectiveSource);
    var visibleHref = getVisibleSourceHref(effectiveSource);
    sourceLabelEl.textContent = visibleSource ? '?source=' + visibleSource : '';
    sourceLabelEl.setAttribute('href', visibleHref || '');
    if (visibleSource) {
      sourceLabelEl.removeAttribute('aria-hidden');
    } else {
      sourceLabelEl.setAttribute('aria-hidden', 'true');
    }
    applyExternalLinkBehavior(document.querySelector('.brand'));
    updateDevWatchAvailability();
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

    updateHeaderSourceLabel();
  }

  function updateView() {
    var total = getDisplaySlideCount();

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
    renderSlideInto(slideEl, getSlideMarkdownForDisplayIndex(currentIndex), currentIndex, renderToken, {
      allowIntroQr: true,
      animateMarkers: true,
      baseUrl: currentBaseUrl,
      enableReveal: true,
      layoutSlideIndex: getLayoutSlideIndexForDisplayIndex(currentIndex),
      revealSlideIndex: currentIndex
    }).then(function () {
      if (renderToken !== viewRenderToken) return;
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
    if (stepBulletReveal(1)) return;
    if (currentIndex < getDisplaySlideCount() - 1) {
      currentIndex += 1;
      updateView();
    }
  }

  function goPrev() {
    if (stepBulletReveal(-1)) return;
    if (currentIndex > 0) {
      currentIndex -= 1;
      updateView();
    }
  }

  function rebuildPrintDeck() {
    if (!printDeckEl) return Promise.resolve();

    var renderToken = printRenderToken + 1;
    printRenderToken = renderToken;
    printDeckEl.innerHTML = '';

    if (!slides.length) return Promise.resolve();

    var fragment = document.createDocumentFragment();
    var renderTasks = slides.map(function (slideMarkdown, slideIndex) {
      var printSlide = document.createElement('article');
      printSlide.className = 'slide print-slide';
      fragment.appendChild(printSlide);
      return renderSlideInto(printSlide, slideMarkdown, slideIndex, renderToken, {
        allowIntroQr: false,
        animateMarkers: false,
        baseUrl: currentBaseUrl,
        enableReveal: false
      });
    });

    printDeckEl.appendChild(fragment);
    return Promise.all(renderTasks).catch(function (error) {
      debugLog('rebuildPrintDeck:failed', String(error));
    });
  }

  function loadMarkdown(markdown, sourceLabel, baseUrl, sourceQueryValue, sourceIsExplicit) {
    var trimmed = String(markdown || '').trim();
    if (!trimmed) return;

    var hashToken = deckHashToken + 1;
    deckHashToken = hashToken;
    currentDeckContentHash = '';
    currentDeckHashPending = true;

    slides = splitSlides(trimmed);
    slideRevealProgress = {};
    currentSourceQuery = String(sourceQueryValue || '').trim();
    currentSourceDisplay = deriveVisibleSourceDisplay(sourceLabel, currentSourceQuery);
    currentSourceIsExplicit = Boolean(
      currentSourceQuery &&
      sourceIsExplicit &&
      getSourceProtocol(currentSourceQuery) !== LOCAL_DROP_SOURCE_PREFIX
    );
    if (currentSourceIsExplicit) rememberSourceForFileName(currentSourceQuery);
    if (!canUseLocalWatch()) stopWatchingSourceFile();
    currentIndex = resolveInitialSlideIndex(currentSourceQuery, slides);
    currentBaseUrl = typeof baseUrl === 'string' ? baseUrl : window.location.href;
    updateHeaderSourceLabel();
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
    rebuildPrintDeck();
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

  async function loadDefaultDeck() {
    var readmeSource = new URL('./README.md', window.location.href).href;
    debugLog('loadDefaultDeck:start', { source: readmeSource });

    if (window.location.protocol === 'file:') {
      showDefaultReadmeBootstrap(readmeSource);
      return;
    }

    await loadFromSource(readmeSource);
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
    rootEl.querySelectorAll('img[data-clicker-src], img[src]').forEach(function (img) {
      var rawSource = img.getAttribute('data-clicker-src') || img.getAttribute('src') || '';
      var parsedImageSource = parseMarkdownImageSource(rawSource);
      var src = parsedImageSource.href;
      applyImageSizingAttributes(img, parsedImageSource);
      img.removeAttribute('data-clicker-src');

      if (!looksRelativePath(src)) {
        img.setAttribute('src', src);
        return;
      }

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

        if (fileSource && looksLikeLoadableSource(fileSource) && droppedSourceInfo.explicit) {
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
        if (fileSource && canBeBaseUrl(fileSource) && (droppedSourceInfo.explicit || droppedSourceInfo.strong)) {
          try {
            baseForFile = new URL('.', fileSource).href;
          } catch (_error) {}
        }

        if (fileSource && looksLikeLoadableSource(fileSource) && droppedSourceInfo.strong) {
          var inferredLocalDropSource = createLocalDropSource(file.name || 'local file');
          cacheLocalDropContent(inferredLocalDropSource, fileText);
          updateSourceQuery(inferredLocalDropSource);
          loadMarkdown(fileText, file.name || fileSource, baseForFile || '', inferredLocalDropSource, true);
          debugLog('handleDrop:file-loaded-with-inferred-context', {
            name: file.name,
            chars: fileText.length,
            source: fileSource,
            localSource: inferredLocalDropSource
          });
          return;
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

  document.addEventListener('drop', handleDrop, true);
  window.addEventListener('drop', handleDrop, true);

  window.addEventListener('keydown', function (event) {
    if (!slides.length) return;
    if (isEditableTarget(event.target)) return;

    var isPlusShortcut =
      event.key === '+' ||
      event.code === 'NumpadAdd' ||
      (event.code === 'Equal' && event.shiftKey);

    var isMinusShortcut =
      event.key === '-' ||
      event.key === '_' ||
      event.code === 'NumpadSubtract' ||
      event.code === 'Minus';

    if (isPlusShortcut) {
      event.preventDefault();
      adjustContentScale(0.08);
      return;
    }

    if (isMinusShortcut) {
      event.preventDefault();
      adjustContentScale(-0.08);
      return;
    }

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

  app.addEventListener('mousedown', function (event) {
    if (event.button !== 0) return;
    pointerDownX = event.clientX;
    pointerDownY = event.clientY;
  });

  app.addEventListener('mouseup', function (event) {
    if (!slides.length) return;
    if (event.button !== 0) return;

    var target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('a, button, input, textarea, select, label')) return;
    if (Math.abs(event.clientX - pointerDownX) > 6 || Math.abs(event.clientY - pointerDownY) > 6) return;

    var selection = window.getSelection ? window.getSelection() : null;
    if (selection && String(selection).trim()) return;

    goNext();
  });

  if (fontDecreaseBtnEl) {
    fontDecreaseBtnEl.addEventListener('click', function () {
      adjustContentScale(-0.08);
    });
  }

  if (fontIncreaseBtnEl) {
    fontIncreaseBtnEl.addEventListener('click', function () {
      adjustContentScale(0.08);
    });
  }

  if (fontResetBtnEl) {
    fontResetBtnEl.addEventListener('click', function () {
      resetContentScale();
    });
  }

  if (lightModeBtnEl) {
    lightModeBtnEl.addEventListener('click', function () {
      setTheme('light');
    });
  }

  if (darkModeBtnEl) {
    darkModeBtnEl.addEventListener('click', function () {
      setTheme('dark');
    });
  }

  if (watchSourceBtnEl) {
    watchSourceBtnEl.addEventListener('click', function () {
      enableLocalSourceWatch();
    });
  }

  async function startApp() {
    var sourceFromQuery = getSourceFromQuery();
    debugLog('startup', {
      href: window.location.href,
      sourceFromQuery: sourceFromQuery || '(none)'
    });

    if (isLocalAppMode()) {
      var startupProtocol = getSourceProtocol(sourceFromQuery);
      if (!sourceFromQuery || startupProtocol === LOCAL_DROP_SOURCE_PREFIX || startupProtocol === 'file:') {
        var restoredWatch = await restorePersistedWatchedSourceOnStartup(sourceFromQuery);
        if (restoredWatch) return;
      }
    }

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
        loadMarkdown(
          '# Load error\n\nBrowsers do not allow automatic startup loading of `file://` sources from the URL.\n\nOpen that file explicitly again with **Watch local source** or by dropping it onto the page.',
          'error',
          window.location.href,
          '',
          false
        );
      } else {
        loadFromSource(sourceFromQuery).catch(function (error) {
          var message = error instanceof Error ? error.message : String(error);
          loadMarkdown('# Load error\n\nCould not load source from URL query.\n\n`' + message + '`', 'error', window.location.href, '', false);
        });
      }
    } else {
      loadDefaultDeck().catch(function (error) {
        var message = error instanceof Error ? error.message : String(error);
        loadMarkdown('# Load error\n\nCould not load `README.md` as the default deck.\n\n`' + message + '`', 'error', window.location.href, '', false);
      });
    }
  }

  startApp().catch(function (error) {
    var message = error instanceof Error ? error.message : String(error);
    loadMarkdown('# Load error\n\nCould not initialize clicker.page.\n\n`' + message + '`', 'error', window.location.href, '', false);
  });
})();
