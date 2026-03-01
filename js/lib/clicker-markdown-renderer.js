(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function parseInline(text) {
    var out = escapeHtml(text);

    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, '<img src="$2" alt="$1">');
    out = out.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return out;
  }

  function isTableStart(lines, index) {
    if (index + 1 >= lines.length) return false;
    if (!/\|/.test(lines[index])) return false;
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
  }

  function parseTableRow(line) {
    var cleaned = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return cleaned.split('|').map(function (cell) {
      return parseInline(cell.trim());
    });
  }

  function render(markdown) {
    var lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    var html = [];

    var inCode = false;
    var codeBuffer = [];
    var inUl = false;
    var inOl = false;
    var paragraph = [];

    function closeParagraph() {
      if (!paragraph.length) return;
      html.push('<p>' + parseInline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    function closeLists() {
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
    }

    function closeCode() {
      if (!inCode) return;
      html.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
      inCode = false;
      codeBuffer = [];
    }

    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];

      if (inCode) {
        if (/^```/.test(line)) {
          closeCode();
        } else {
          codeBuffer.push(line);
        }
        continue;
      }

      if (/^```/.test(line)) {
        closeParagraph();
        closeLists();
        inCode = true;
        codeBuffer = [];
        continue;
      }

      if (/^\s*$/.test(line)) {
        closeParagraph();
        closeLists();
        continue;
      }

      if (isTableStart(lines, i)) {
        closeParagraph();
        closeLists();

        var headCells = parseTableRow(lines[i]);
        html.push('<table><thead><tr>');
        for (var h = 0; h < headCells.length; h += 1) {
          html.push('<th>' + headCells[h] + '</th>');
        }
        html.push('</tr></thead><tbody>');

        i += 2;
        while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          var rowCells = parseTableRow(lines[i]);
          html.push('<tr>');
          for (var r = 0; r < rowCells.length; r += 1) {
            html.push('<td>' + rowCells[r] + '</td>');
          }
          html.push('</tr>');
          i += 1;
        }

        html.push('</tbody></table>');
        i -= 1;
        continue;
      }

      var headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        closeParagraph();
        closeLists();
        var level = headingMatch[1].length;
        html.push('<h' + level + '>' + parseInline(headingMatch[2].trim()) + '</h' + level + '>');
        continue;
      }

      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        closeParagraph();
        closeLists();
        html.push('<hr>');
        continue;
      }

      var bqMatch = line.match(/^\s*>\s?(.*)$/);
      if (bqMatch) {
        closeParagraph();
        closeLists();
        html.push('<blockquote>' + parseInline(bqMatch[1]) + '</blockquote>');
        continue;
      }

      var ulMatch = line.match(/^\s*[-*+]\s+(.+)$/);
      if (ulMatch) {
        closeParagraph();
        if (inOl) {
          html.push('</ol>');
          inOl = false;
        }
        if (!inUl) {
          html.push('<ul>');
          inUl = true;
        }
        html.push('<li>' + parseInline(ulMatch[1].trim()) + '</li>');
        continue;
      }

      var olMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (olMatch) {
        closeParagraph();
        if (inUl) {
          html.push('</ul>');
          inUl = false;
        }
        if (!inOl) {
          html.push('<ol>');
          inOl = true;
        }
        html.push('<li>' + parseInline(olMatch[1].trim()) + '</li>');
        continue;
      }

      paragraph.push(line.trim());
    }

    closeCode();
    closeParagraph();
    closeLists();

    return html.join('\n');
  }

  window.ClickerMarkdownRenderer = {
    render: render
  };
})();
