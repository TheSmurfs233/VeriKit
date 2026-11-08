/**
 * Verilog 带基数数字字面量的解析与换算（参考 TerosHDL 的 Number Conversion 悬停）。
 *
 * 纯函数，不 import vscode。
 *
 * 语义按 Verilog 标准：
 *   - 位宽给定时，超出位宽的高位被**截断**（硬件真实行为）：4'hFF == 4'hF == 15
 *   - 有符号解释按位宽做补码：1'b1 -> -1，16'hFFFF -> -1，8'd200 -> -56
 *   - 位宽缺省（如 'b1）按 32 位解释
 *   - 含 x/z/? 的字面量无法换算出确定的十进制值
 */

export type LiteralBase = 'b' | 'o' | 'd' | 'h';

export interface BasedLiteral {
  /** 位宽；undefined 表示无位宽（'b1 这种），按 32 位解释 */
  width: number | undefined;
  /** 's 标记（有符号声明） */
  signedFlag: boolean;
  base: LiteralBase;
  /** 去掉下划线后的数字串 */
  digits: string;
  /** 悬停标题，如 "b1"、"h22"（与 TerosHDL 一致） */
  title: string;
  /** 字面量在行内的列范围（0-based，含头不含尾） */
  rangeStart: number;
  rangeEnd: number;
}

export interface NumberConversion {
  unsigned: string | undefined;
  signed: string | undefined;
  hasUnknown: boolean;
  error: string | undefined;
}

const LITERAL_RE = /(\d[\d_]*)?'([sS]?)([bBoOdDhH])([0-9a-fA-FxXzZ?_]+)/g;
const PREFIX: Record<LiteralBase, string> = { b: '0b', o: '0o', h: '0x', d: '' };

/** 光标所在列是否处于行注释或字符串里（悬停不应在这两种位置触发） */
function insideCommentOrString(line: string, index: number): boolean {
  let inString = false;
  for (let i = 0; i < index; i += 1) {
    const c = line[i];
    if (inString) {
      if (c === '\\') {
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
    } else if (c === '/' && line[i + 1] === '/') {
      return true;
    }
  }
  return inString;
}

/** 在一行里找出包含 char 列的带基数数字字面量；不在注释/字符串里才算 */
export function parseBasedLiteralFromLine(
  line: string,
  char: number
): BasedLiteral | null {
  if (insideCommentOrString(line, char)) {
    return null;
  }
  LITERAL_RE.lastIndex = 0;
  for (let m = LITERAL_RE.exec(line); m !== null; m = LITERAL_RE.exec(line)) {
    const start = m.index;
    const end = start + m[0].length;
    if (char < start || char > end) {
      continue;
    }
    const widthPart = m[1];
    const base = m[3].toLowerCase() as LiteralBase;
    const digits = m[4].replace(/_/g, '');
    if (digits.length === 0) {
      continue;
    }
    if (base === 'd' && /[xXzZ?]/.test(digits)) {
      continue; // 十进制里不允许 x/z
    }
    const width = widthPart !== undefined ? Number.parseInt(widthPart.replace(/_/g, ''), 10) : undefined;
    if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
      continue;
    }
    return {
      width,
      signedFlag: m[2] !== '',
      base,
      digits,
      title: base + digits.toLowerCase(),
      rangeStart: start,
      rangeEnd: end,
    };
  }
  return null;
}

export function convertLiteral(lit: BasedLiteral): NumberConversion {
  const width = lit.width ?? 32;
  const cleaned = lit.digits;
  const hasUnknown = /[xXzZ?]/i.test(cleaned);

  if (hasUnknown) {
    return { unsigned: undefined, signed: undefined, hasUnknown: true, error: undefined };
  }

  let value: bigint;
  try {
    value = BigInt(PREFIX[lit.base] + cleaned);
  } catch {
    return {
      unsigned: undefined,
      signed: undefined,
      hasUnknown: false,
      error: `数字 ${cleaned} 对 ${lit.base} 进制非法`,
    };
  }

  // 位宽截断：4'hFF 在硬件里就是 4'hF
  if (lit.width !== undefined) {
    const mask = (1n << BigInt(width)) - 1n;
    value &= mask;
  }

  // 补码有符号解释：最高位为 1 则减 2^width
  const signBit = 1n << BigInt(width - 1);
  const signed = value >= signBit ? value - (1n << BigInt(width)) : value;

  return {
    unsigned: value.toString(10),
    signed: signed.toString(10),
    hasUnknown: false,
    error: undefined,
  };
}

/** 生成悬停 Markdown（与 TerosHDL 的呈现保持一致） */
export function formatNumberConversion(lit: BasedLiteral, conv: NumberConversion): string {
  const lines: string[] = [`**Number conversion of ${lit.title}:**`];
  if (conv.error !== undefined) {
    lines.push(`- ${conv.error}`);
    return lines.join('\n');
  }
  if (conv.hasUnknown) {
    lines.push('- contains X/Z — cannot convert to decimal');
    return lines.join('\n');
  }
  lines.push(`- Unsigned \`${conv.unsigned}\``);
  lines.push(`- Signed \`${conv.signed}\``);
  if (lit.width === undefined) {
    lines.push('');
    lines.push('*unsized literal, interpreted as 32-bit*');
  }
  return lines.join('\n');
}
