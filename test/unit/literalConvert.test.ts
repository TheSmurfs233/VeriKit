import { describe, expect, it } from 'vitest';
import { convertLiteral, formatNumberConversion, parseBasedLiteralFromLine } from '../../src/core/literal/convert';

describe('parseBasedLiteralFromLine', () => {
  it('在基数字母上悬停能找到整个字面量', () => {
    const line = "    cnt <= 16'h22;";
    const lit = parseBasedLiteralFromLine(line, 14); // h22 的 h（列号 0 基）
    expect(lit?.width).toBe(16);
    expect(lit?.base).toBe('h');
    expect(lit?.digits).toBe('22');
    expect(lit?.title).toBe('h22');
    expect(lit?.rangeStart).toBe(11);
    expect(lit?.rangeEnd).toBe(17);
  });

  it('在位宽部分悬停也能找到', () => {
    const lit = parseBasedLiteralFromLine("    q <= 1'b1;", 10); // 位宽 1
    expect(lit?.width).toBe(1);
    expect(lit?.title).toBe('b1');
  });

  it("识别 's 有符号标记", () => {
    const lit = parseBasedLiteralFromLine("    x = 8'sd200;", 12);
    expect(lit?.signedFlag).toBe(true);
    expect(lit?.base).toBe('d');
  });

  it("无位宽字面量 'b1 也支持", () => {
    const lit = parseBasedLiteralFromLine("    y = 'b101;", 10);
    expect(lit?.width).toBeUndefined();
    expect(lit?.title).toBe('b101');
  });

  it('行注释与字符串里不触发', () => {
    expect(parseBasedLiteralFromLine("    // 1'b1", 8)).toBeNull();
    expect(parseBasedLiteralFromLine('    $display("8\'hFF");', 16)).toBeNull();
  });

  it('普通十进制数（无撇号）不触发', () => {
    expect(parseBasedLiteralFromLine('    a = 200;', 9)).toBeNull();
  });
});

describe('convertLiteral', () => {
  it("1'b1：无符号 1，补码有符号 -1", () => {
    const c = convertLiteral(parseBasedLiteralFromLine("1'b1", 0)!);
    expect(c.unsigned).toBe('1');
    expect(c.signed).toBe('-1');
    expect(c.hasUnknown).toBe(false);
  });

  it("16'h22：无符号 34，有符号 34", () => {
    const c = convertLiteral(parseBasedLiteralFromLine("16'h22", 0)!);
    expect(c.unsigned).toBe('34');
    expect(c.signed).toBe('34');
  });

  it("16'hFFFF：无符号 65535，有符号 -1", () => {
    const c = convertLiteral(parseBasedLiteralFromLine("16'hFFFF", 0)!);
    expect(c.unsigned).toBe('65535');
    expect(c.signed).toBe('-1');
  });

  it("8'd200：无符号 200，有符号 -56", () => {
    const c = convertLiteral(parseBasedLiteralFromLine("8'd200", 0)!);
    expect(c.unsigned).toBe('200');
    expect(c.signed).toBe('-56');
  });

  it("4'b1010：无符号 10，有符号 -6", () => {
    const c = convertLiteral(parseBasedLiteralFromLine("4'b1010", 0)!);
    expect(c.unsigned).toBe('10');
    expect(c.signed).toBe('-6');
  });

  it('下划线分隔符被忽略', () => {
    const c = convertLiteral(parseBasedLiteralFromLine("8'b1010_1010", 0)!);
    expect(c.unsigned).toBe('170');
  });

  it('超出位宽的高位被截断（硬件语义）', () => {
    const c = convertLiteral(parseBasedLiteralFromLine("4'hFF", 0)!);
    expect(c.unsigned).toBe('15');
    expect(c.signed).toBe('-1');
  });

  it('无位宽按 32 位解释', () => {
    const c = convertLiteral(parseBasedLiteralFromLine("'hFFFFFFFF", 0)!);
    expect(c.unsigned).toBe('4294967295');
    expect(c.signed).toBe('-1');
  });

  it('含 x/z 无法换算', () => {
    const c = convertLiteral(parseBasedLiteralFromLine("4'b10xz", 0)!);
    expect(c.hasUnknown).toBe(true);
    expect(c.unsigned).toBeUndefined();
  });

  it('八进制也支持', () => {
    const c = convertLiteral(parseBasedLiteralFromLine("6'o17", 0)!);
    expect(c.unsigned).toBe('15');
  });
});

describe('formatNumberConversion', () => {
  it('输出与 TerosHDL 一致的标题与两行解释', () => {
    const lit = parseBasedLiteralFromLine("1'b1", 0)!;
    const md = formatNumberConversion(lit, convertLiteral(lit));
    expect(md).toContain('**Number conversion of b1:**');
    expect(md).toContain('- Unsigned `1`');
    expect(md).toContain('- Signed `-1`');
  });

  it('含 x/z 时给出说明', () => {
    const lit = parseBasedLiteralFromLine("4'b10xz", 0)!;
    const md = formatNumberConversion(lit, convertLiteral(lit));
    expect(md).toContain('contains X/Z');
  });
});
