// Renders the notes body: paragraphs, headings, lists, **bold**, *italic*,
// `code` and links. Everything is escaped first, so notes cannot inject HTML.

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(s) {
  return escape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

export function renderMarkdown(text) {
  const out = [];
  let para = [];
  let listItems = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (listItems) out.push(`<ul>${listItems.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    listItems = null;
  };
  for (const line of text.split('\n')) {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^\s*[-*+]\s+(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); }
    else if (heading) { flushPara(); flushList(); out.push(`<h4>${inline(heading[2])}</h4>`); }
    else if (item) { flushPara(); (listItems ??= []).push(item[1]); }
    else { flushList(); para.push(line); }
  }
  flushPara();
  flushList();
  return out.join('');
}
