/**
 * 例化语句解析：找出文本里所有"模块名 实例名 ( ... .port(conn) ... )"的例化，
 * 并记录每个命名连接项右括号之后的位置 —— 那是端口方向 inlay 提示的插入点。
 *
 * 纯函数，不 import vscode。
 *
 * 降级策略：
 *   - 位置连接（无 .port 前缀）→ connections 为空，不给提示（v1 范围外）
 *   - 关键字（module/always/if...）不会被误判为例化
 *   - 找不到配对括号 → 跳过
 */

import { blankComments, findClose, skipWsComments } from './moduleHeader';

export interface InstanceConnection {
  port: string;
  /** 连接项 `)` 之后的绝对位置（0 基），换算成行列后是 inlay 插入点 */
  endLine: number;
  endChar: number;
}

export interface InstanceInfo {
  moduleName: string;
  instanceName: string;
  connections: InstanceConnection[];
}

const KEYWORDS = new Set([
  'module', 'macromodule', 'primitive', 'endmodule', 'endprimitive',
  'begin', 'end', 'if', 'else', 'case', 'casex', 'casez', 'endcase', 'default',
  'for', 'while', 'repeat', 'forever', 'fork', 'join', 'join_any', 'join_none',
  'generate', 'endgenerate', 'assign', 'deassign', 'force', 'release', 'wait',
  'disable', 'return', 'break', 'continue', 'always', 'always_comb',
  'always_ff', 'always_latch', 'initial', 'function', 'endfunction',
  'task', 'endtask', 'specify', 'endspecify', 'input', 'output', 'inout',
  'wire', 'reg', 'logic', 'parameter', 'localparam', 'defparam', 'genvar',
  'integer', 'real', 'realtime', 'time', 'signed', 'unsigned',
  'posedge', 'negedge', 'edge', 'or', 'and', 'nand', 'nor', 'not', 'buf',
  'xor', 'xnor', 'define', 'include', 'timescale',
]);

function readWord(
  text: string,
  i: number
): { word: string; start: number; end: number } | null {
  if (!/[A-Za-z_]/.test(text[i] ?? '')) {
    return null;
  }
  let j = i;
  while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) {
    j += 1;
  }
  return { word: text.slice(i, j), start: i, end: j };
}

function lineChar(text: string, abs: number): { line: number; char: number } {
  let line = 0;
  let lastNl = -1;
  for (let i = 0; i < abs && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      lastNl = i;
    }
  }
  return { line, char: abs - lastNl - 1 };
}

/** 解析连接表（括号内文本），返回每个命名连接项的插入点 */
function parseConnections(
  text: string,
  innerStart: number,
  innerEnd: number
): InstanceConnection[] {
  const connections: InstanceConnection[] = [];
  // 注释替换为等长空格：项的起点与连接项右括号的绝对下标都保持不变
  const inner = blankComments(text.slice(innerStart, innerEnd));

  // 按顶层逗号切分，记录每项的绝对起点
  const items: { absStart: number; text: string }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
    } else if (c === ',' && depth === 0) {
      items.push({ absStart: innerStart + start, text: inner.slice(start, i) });
      start = i + 1;
    }
  }
  items.push({ absStart: innerStart + start, text: inner.slice(start) });

  for (const item of items) {
    const m = /^\s*\.\s*([A-Za-z_][A-Za-z0-9_$]*)\s*\(/.exec(item.text);
    if (!m) {
      continue; // 位置连接等，v1 不处理
    }
    const openRel = item.text.indexOf('(', m.index);
    if (openRel < 0) {
      continue;
    }
    const absOpen = item.absStart + openRel;
    const close = findClose(text, absOpen);
    if (close < 0) {
      continue;
    }
    const pos = lineChar(text, close + 1);
    connections.push({ port: m[1], endLine: pos.line, endChar: pos.char });
  }
  return connections;
}

export function parseInstances(text: string): InstanceInfo[] {
  const out: InstanceInfo[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    i = skipWsComments(text, i);
    const w1 = readWord(text, i);
    if (!w1) {
      i += 1;
      continue;
    }

    let j = skipWsComments(text, w1.end);
    if (text[j] === '#') {
      const k = skipWsComments(text, j + 1);
      if (text[k] === '(') {
        const close = findClose(text, k);
        if (close < 0) {
          i = w1.end;
          continue;
        }
        j = skipWsComments(text, close + 1);
      }
    }

    const w2 = readWord(text, j);
    if (!w2) {
      i = w1.end;
      continue;
    }
    const k2 = skipWsComments(text, w2.end);
    if (text[k2] !== '(') {
      i = w1.end;
      continue;
    }
    if (KEYWORDS.has(w1.word) || KEYWORDS.has(w2.word)) {
      i = w1.end;
      continue;
    }

    const close = findClose(text, k2);
    if (close < 0) {
      i = w1.end;
      continue;
    }

    out.push({
      moduleName: w1.word,
      instanceName: w2.word,
      connections: parseConnections(text, k2 + 1, close),
    });
    i = close + 1; // 跳过整个例化体，避免内部再被当作例化
  }
  return out;
}
