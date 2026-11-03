// A small YAML subset: enough for the front matter this app writes, and for
// the usual hand edits (block and flow lists, quoted strings, `|` text blocks).
// Not a full YAML parser: no anchors, tags or multi-document streams.

const PLAIN_UNSAFE = /^[\s\-?:,\[\]{}#&*!|>'"%@`]|[:#]\s|\s#|:$|\s$|^(true|false|yes|no|on|off|null|~|[-+]?(\d[\d_]*)?\.?\d+([eE][-+]?\d+)?|0x[\da-fA-F]+|\.inf|\.nan)$/i;

function emitScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '' || PLAIN_UNSAFE.test(s) || /[\n\r\t"\\]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function isEmpty(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

// Keys with empty values are left out, so the files stay short.
export function stringify(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  let out = '';
  for (const [key, value] of Object.entries(obj)) {
    if (isEmpty(value)) continue;
    const k = /^[\w-]+$/.test(key) ? key : JSON.stringify(key);
    if (Array.isArray(value)) {
      out += `${pad}${k}:\n` + stringifyList(value, indent);
    } else if (typeof value === 'object') {
      out += `${pad}${k}:\n` + stringify(value, indent + 2);
    } else {
      out += `${pad}${k}: ${emitScalar(value)}\n`;
    }
  }
  return out;
}

function stringifyList(list, indent) {
  const pad = ' '.repeat(indent);
  let out = '';
  for (const item of list) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const body = stringify(item, indent + 2);
      out += body ? `${pad}- ${body.slice(indent + 2)}` : `${pad}- {}\n`;
    } else if (Array.isArray(item)) {
      out += `${pad}- [${item.map(emitScalar).join(', ')}]\n`;
    } else {
      out += `${pad}- ${emitScalar(item)}\n`;
    }
  }
  return out;
}

// --- parsing ---

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function stripComment(s) {
  // Only for plain (unquoted) scalars: a comment starts at ` #`.
  const i = s.search(/\s#/);
  return i === -1 ? s : s.slice(0, i);
}

function splitFlow(inner) {
  const parts = [];
  let depth = 0, quote = null, cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote === '"') { cur += inner[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts.map((p) => p.trim());
}

function parseDoubleQuoted(s) {
  try {
    return JSON.parse(s.replace(/\\'/g, "'").replace(/\t/g, '\\t'));
  } catch {
    return s.slice(1, -1);
  }
}

export function parseScalar(raw) {
  let s = raw.trim();
  if (s.startsWith('"')) {
    const end = findClosingQuote(s, '"');
    return parseDoubleQuoted(s.slice(0, end + 1));
  }
  if (s.startsWith("'")) {
    const end = findClosingQuote(s, "'");
    return s.slice(1, end).replace(/''/g, "'");
  }
  s = stripComment(s).trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    return splitFlow(s.slice(1, -1)).map(parseScalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const [k, v] = splitKey(part);
      obj[k] = v === undefined ? null : parseScalar(v);
    }
    return obj;
  }
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?\d+$/.test(s)) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

function findClosingQuote(s, q) {
  for (let i = 1; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') { i++; continue; }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") { i++; continue; }
      return i;
    }
  }
  return s.length - 1;
}

// Splits `key: value` into [key, value]; value is undefined when there is no `:`.
function splitKey(text) {
  let keyEnd = -1;
  if (text.startsWith('"') || text.startsWith("'")) {
    const end = findClosingQuote(text, text[0]);
    if (text[end + 1] === ':') keyEnd = end + 1;
  } else {
    const m = text.match(/:(\s|$)/);
    if (m) keyEnd = m.index;
  }
  if (keyEnd === -1) return [text, undefined];
  const k = text.slice(0, keyEnd).trim();
  const key = k.startsWith('"') || k.startsWith("'") ? parseScalar(k) : k;
  return [key, text.slice(keyEnd + 1)];
}

export function parse(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  function skip() {
    while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('#'))) i++;
  }

  function blockScalar(parentIndent, style) {
    const collected = [];
    let blockIndent = null;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') { collected.push(''); i++; continue; }
      const ind = indentOf(line);
      if (ind <= parentIndent) break;
      if (blockIndent === null) blockIndent = ind;
      collected.push(line.slice(Math.min(ind, blockIndent)));
      i++;
    }
    while (collected.length && collected[collected.length - 1] === '') collected.pop();
    const keep = style.includes('-') ? '' : '\n';
    if (style.startsWith('>')) {
      return collected.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ') + keep;
    }
    return collected.join('\n') + keep;
  }

  function value(rest, indent) {
    const v = rest.trim();
    if (/^[|>][-+]?$/.test(v)) { i++; return blockScalar(indent, v); }
    if (v === '' || v.startsWith('#')) {
      i++;
      skip();
      if (i >= lines.length) return null;
      const ind = indentOf(lines[i]);
      if (ind > indent) return block(ind);
      if (ind === indent && /^-(\s|$)/.test(lines[i].trimStart())) return sequence(ind);
      return null;
    }
    i++;
    return parseScalar(v);
  }

  function sequence(indent) {
    const list = [];
    while (true) {
      skip();
      if (i >= lines.length) break;
      const line = lines[i];
      if (indentOf(line) !== indent || !/^-(\s|$)/.test(line.trimStart())) break;
      const rest = line.trimStart().slice(1);
      const restTrim = rest.trim();
      const [, afterKey] = restTrim && !restTrim.startsWith('[') && !restTrim.startsWith('{') ? splitKey(restTrim) : [null, undefined];
      if (restTrim === '' || restTrim.startsWith('#')) {
        list.push(value('', indent));
      } else if (afterKey !== undefined) {
        // `- key: value` starts a mapping; re-read this line as that mapping's first line.
        const offset = indent + 1 + (rest.length - rest.trimStart().length);
        lines[i] = ' '.repeat(offset) + restTrim;
        list.push(mapping(offset));
      } else {
        i++;
        list.push(parseScalar(restTrim));
      }
    }
    return list;
  }

  function mapping(indent) {
    const obj = {};
    while (true) {
      skip();
      if (i >= lines.length) break;
      const line = lines[i];
      const ind = indentOf(line);
      if (ind !== indent || /^-(\s|$)/.test(line.trimStart())) break;
      const [key, rest] = splitKey(line.trim());
      if (rest === undefined) { i++; continue; } // not a key line: ignore it
      obj[key] = value(rest, indent);
    }
    return obj;
  }

  function block(indent) {
    skip();
    if (i >= lines.length) return null;
    return /^-(\s|$)/.test(lines[i].trimStart()) ? sequence(indent) : mapping(indent);
  }

  skip();
  if (i >= lines.length) return {};
  const result = block(indentOf(lines[i]));
  return result ?? {};
}

// --- Markdown files with a YAML header ---

export function parseFrontMatter(text) {
  const m = text.replace(/^\uFEFF/, '').match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  return { data: parse(m[1]) || {}, body: m[2].replace(/^\r?\n/, '') };
}

export function stringifyFrontMatter(data, body) {
  const text = (body || '').trim();
  return `---\n${stringify(data)}---\n${text ? '\n' + text + '\n' : ''}`;
}
