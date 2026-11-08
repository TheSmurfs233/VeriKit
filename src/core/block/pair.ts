/**
 * begin/end 配对扫描。
 *
 * 纯函数，不 import vscode。
 *
 * 必须跳过注释与字符串：
 *   // begin        ← 注释里的 begin 不能参与配对
 *   "begin"         ← 字符串里的同理
 * 否则一对 begin/end 会被错配到注释里的词，红线/高亮全错位。
 *
 * 同时跳过：
 *   - `endcase` / `endmodule` / `begin_keywords`（\b 保证是完整单词）
 *   - `$begin` 这类以 $ 开头的系统名（Verilog 里 $ 后面跟的不是普通标识符）
 */

export interface BlockToken {
  kind: 'begin' | 'end';
  line: number;      // 0-based
  startChar: number; // 行内列，0-based
  endChar: number;
}

export interface BlockPair {
  begin: BlockToken;
  end: BlockToken;
}

const WORD_START = /[A-Za-z_]/;
const WORD_BODY = /[A-Za-z0-9_$]/;

/** 扫出全文里所有真正的 begin/end 关键字（跳过注释、字符串、系统名） */
export function scanBlockTokens(text: string): BlockToken[] {
  const tokens: BlockToken[] = [];
  const n = text.length;
  let i = 0;
  let line = 0;
  let lineStart = 0;

  while (i < n) {
    const c = text[i];

    if (c === '\n') {
      line += 1;
      lineStart = i + 1;
      i += 1;
      continue;
    }

    // 行注释
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    // 块注释
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      i += 2;
      continue;
    }

    // 字符串（支持 \" 转义）
    if (c === '"') {
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') {
          i += 1;
        }
        if (text[i] === '\n') {
          line += 1;
          lineStart = i + 1;
        }
        i += 1;
      }
      i += 1;
      continue;
    }

    // 系统名 $xxx —— 整体吞掉，防止 $begin 里的 begin 被误认
    if (c === '$') {
      i += 1;
      while (i < n && WORD_BODY.test(text[i])) {
        i += 1;
      }
      continue;
    }

    // 普通标识符
    if (WORD_START.test(c)) {
      let j = i;
      while (j < n && WORD_BODY.test(text[j])) {
        j += 1;
      }
      const word = text.slice(i, j);
      if (word === 'begin' || word === 'end') {
        tokens.push({
          kind: word,
          line,
          startChar: i - lineStart,
          endChar: j - lineStart,
        });
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return tokens;
}

/** 栈配对：返回与每个 token 下标配对的另一个 token 下标，未配对为 -1 */
export function matchBlockTokens(tokens: BlockToken[]): number[] {
  const partner = new Array<number>(tokens.length).fill(-1);
  const stack: number[] = [];
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.kind === 'begin') {
      stack.push(k);
    } else {
      const open = stack.pop();
      if (open !== undefined) {
        partner[k] = open;
        partner[open] = k;
      }
      // 栈空的多余 end：不配对，也不报错（由调用方决定如何提示）
    }
  }
  return partner;
}

/** 光标/选区落在 begin 或 end 上时，返回配对的那一对；否则返回 null */
export function findBlockPair(
  text: string,
  line: number,
  char: number
): BlockPair | null {
  const tokens = scanBlockTokens(text);
  const partner = matchBlockTokens(tokens);
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t.line !== line) {
      continue;
    }
    if (char < t.startChar || char > t.endChar) {
      continue;
    }
    const p = partner[k];
    if (p < 0) {
      return null;
    }
    const other = tokens[p];
    return t.kind === 'begin' ? { begin: t, end: other } : { begin: other, end: t };
  }
  return null;
}
