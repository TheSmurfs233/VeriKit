/**
 * 模块头解析（S3a 的第一部分）：从文本里解析出所有 module 声明的端口方向。
 *
 * 纯函数，不 import vscode。
 *
 * 范围声明（与 docs/40 的 S3a 计划一致）：
 *   - 支持 ANSI 风格端口（方向写在端口表里）
 *   - 支持方向继承：input a, b  → b 也是 input
 *   - 不支持非 ANSI（端口表为空、方向在模块体里声明）→ ansi=false，ports 为空，
 *     调用方按"没有方向信息"降级，不报错
 */

export type PortDirection = 'input' | 'output' | 'inout';

export interface PortInfo {
  name: string;
  direction: PortDirection;
  /** 端口项所在行（0 基）；解析自带行号后始终有值，旧调用方构造的对象可缺省 */
  line?: number;
  /** 位宽原文（如 [WIDTH-1:0]；无则缺省） */
  range?: string;
  /** 类型词（reg/wire/logic…；无则缺省） */
  typeWord?: string;
}

export interface HeaderParam {
  name: string;
  /** 默认值原文（可能为空） */
  value?: string;
  /** 参数项所在行（0 基） */
  line?: number;
}

export interface ModuleHeader {
  name: string;
  ports: PortInfo[];
  /** 头参数表（声明侧 #( parameter ... )），实例化侧的 #(.W(8)) 不在此列 */
  params: HeaderParam[];
  /** 端口表里是否写了方向（ANSI 风格） */
  ansi: boolean;
  /** module 关键字所在行（0 基） */
  line?: number;
}

const DIRECTIONS: Record<string, PortDirection> = {
  input: 'input',
  output: 'output',
  inout: 'inout',
};

const TYPE_WORDS = new Set([
  'wire', 'reg', 'logic', 'bit', 'byte', 'int', 'integer', 'real', 'time',
  'signed', 'unsigned', 'automatic', 'static', 'tri', 'tri0', 'tri1',
  'wand', 'wor', 'supply0', 'supply1', 'genvar',
]);

/** 跳过空白与注释，返回新的下标 */
export function skipWsComments(text: string, i: number): number {
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }
    return i;
  }
  return i;
}

/** i 指向 '('，返回与之配对的 ')' 下标；找不到返回 -1。跳过字符串与注释。 */
export function findClose(text: string, i: number): number {
  if (text[i] !== '(') {
    return -1;
  }
  const n = text.length;
  let depth = 0;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') {
          i += 1;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    i += 1;
  }
  return -1;
}

/** 按顶层逗号切分（忽略括号/方括号/花括号里的逗号），保留相对位置 */
export function splitTopRanges(
  inner: string
): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      out.push({ start, end: i, text: inner.slice(start, i) });
      start = i + 1;
    }
  }
  out.push({ start, end: inner.length, text: inner.slice(start) });
  return out;
}

/** 把注释内容替换成等长空格（保留换行与总长度）：
 *  后续解析不再受注释干扰，同时所有下标保持不变（连接项插入点依赖这一点） */
export function blankComments(text: string): string {
  const chars = text.split('');
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        chars[i] = ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') {
          chars[i] = ' ';
        }
        i += 1;
      }
      if (i < n) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') {
          i += 1;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

/** 计算绝对下标所在的行（0 基） */
export function lineOf(text: string, abs: number): number {
  let l = 0;
  const n = Math.min(abs, text.length);
  for (let i = 0; i < n; i += 1) {
    if (text[i] === '\n') {
      l += 1;
    }
  }
  return l;
}

function parsePortList(text: string, inner: string, base: number): PortInfo[] {
  const ports: PortInfo[] = [];
  let dir: PortDirection | null = null;
  for (const range of splitTopRanges(inner)) {
    let item = range.text.trim();
    if (!item) {
      continue;
    }
    const firstWord = item.split(/\s+/)[0];
    if (DIRECTIONS[firstWord] !== undefined) {
      dir = DIRECTIONS[firstWord];
      item = item.slice(firstWord.length).trim();
    } else if (/^(parameter|localparam)\b/.test(item)) {
      continue;
    }
    if (dir === null) {
      continue; // 还没有任何方向可继承
    }
    const rangeMatch = /\[[^\]]*\]/.exec(item);
    const typeInItem = (
      /\b(reg|wire|logic|integer|bit|byte|int|shortint|longint|real|time|tri\d?|wand|wor|supply0|supply1)\b/.exec(item) ?? []
    )[0];
    // 去掉位宽 [..] 与类型关键字，剩下的最后一个标识符就是端口名
    const cleaned = item
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[A-Za-z_][A-Za-z0-9_$]*/g, (w) => (TYPE_WORDS.has(w) ? ' ' : w));
    const names = cleaned.trim().split(/\s+/).filter(Boolean);
    const name = names[names.length - 1];
    if (!name || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
      continue;
    }
    // range.start 可能落在上一行尾的换行/空白上，行号要按 trim 后的首字符算
    const lead = range.text.length - range.text.trimStart().length;
    ports.push({
      name,
      direction: dir,
      line: lineOf(text, base + range.start + lead),
      range: rangeMatch ? rangeMatch[0] : undefined,
      typeWord: typeInItem,
    });
  }
  return ports;
}

/** 解析文本里所有 module 声明的端口（ANSI 风格） */
export function parseModuleHeaders(text: string): ModuleHeader[] {
  const headers: ModuleHeader[] = [];
  let params: HeaderParam[] = [];
  const re = /\bmodule\s+([A-Za-z_][A-Za-z0-9_$]*)/g;
  for (const m of text.matchAll(re)) {
    const name = m[1];
    let i = skipWsComments(text, m.index + m[0].length);

    // 可选的参数表 #(...) —— 顺便解析出参数名/默认值/行号（供悬停与 S3b 使用）
    if (text[i] === '#') {
      const j = skipWsComments(text, i + 1);
      if (text[j] === '(') {
        const close = findClose(text, j);
        if (close < 0) {
          continue;
        }
        // 头参数表（声明侧）：parameter X = v, Y = v（Y 继承 parameter 关键字）
        const pInner = blankComments(text.slice(j + 1, close));
        for (const range of splitTopRanges(pInner)) {
          let item = range.text.trim();
          if (!item) {
            continue;
          }
          item = item.replace(/^(?:parameter|localparam)\b\s*/, '');
          const pm = /^([A-Za-z_][A-Za-z0-9_$]*)(?:\s*=\s*([^,]+))?$/.exec(item);
          if (!pm) {
            continue;
          }
          const lead = range.text.length - range.text.trimStart().length;
          params.push({
            name: pm[1],
            value: pm[2] !== undefined ? pm[2].trim() : undefined,
            line: lineOf(text, j + 1 + range.start + lead),
          });
        }
        i = skipWsComments(text, close + 1);
      }
    }

    if (text[i] !== '(') {
      headers.push({ name, ports: [], params, ansi: false, line: lineOf(text, m.index) });
      params = [];
      continue;
    }
    const close = findClose(text, i);
    if (close < 0) {
      continue;
    }
    const inner = blankComments(text.slice(i + 1, close));
    const ports = parsePortList(text, inner, i + 1);
    // 有方向可解析才算 ANSI：module legacy (a, b) 这种非 ANSI 也可能端口表非空
    headers.push({ name, ports, params, ansi: ports.length > 0, line: lineOf(text, m.index) });
    params = [];
  }
  return headers;
}
