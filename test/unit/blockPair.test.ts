import { describe, expect, it } from 'vitest';
import { findBlockPair, matchBlockTokens, scanBlockTokens } from '../../src/core/block/pair';

const SRC = [
  'module t;',                              // 0
  '    always @(posedge clk) begin',        // 1  begin L1
  '        if (!rst_n) begin',              // 2  begin L2
  '            q <= 1\'b0;',                // 3
  '        end else begin',                 // 4  end(L2) begin(L2)
  '            q <= ~q;',                   // 5
  '        end',                            // 6  end L2
  '    end',                                // 7  end L1
  'endmodule',                              // 8
].join('\n');

describe('scanBlockTokens', () => {
  it('只扫出真正的 begin/end 关键字', () => {
    const tokens = scanBlockTokens(SRC);
    expect(tokens.map((t) => t.kind)).toEqual([
      'begin', 'begin', 'end', 'begin', 'end', 'end',
    ]);
  });

  it('注释里的 begin 不参与', () => {
    const tokens = scanBlockTokens('// begin\nend');
    expect(tokens.map((t) => t.kind)).toEqual(['end']);
  });

  it('块注释与字符串里的 begin 不参与', () => {
    const tokens = scanBlockTokens('/* begin */ $display("begin");\nbegin\nend');
    expect(tokens.map((t) => t.kind)).toEqual(['begin', 'end']);
  });

  it('endcase / endmodule / begin_keywords / $begin 都不算', () => {
    const tokens = scanBlockTokens(
      'endcase endmodule begin_keywords `$begin $begin end'
    );
    expect(tokens.map((t) => t.kind)).toEqual(['end']);
  });

  it('记录正确的行号与列', () => {
    const tokens = scanBlockTokens('begin\n    end');
    expect(tokens[0]).toEqual({ kind: 'begin', line: 0, startChar: 0, endChar: 5 });
    expect(tokens[1]).toEqual({ kind: 'end', line: 1, startChar: 4, endChar: 7 });
  });
});

describe('matchBlockTokens', () => {
  it('按栈配对，嵌套各归各', () => {
    const tokens = scanBlockTokens(SRC);
    const partner = matchBlockTokens(tokens);
    // tokens: 0=begin(L1) 1=begin(L2) 2=end(L2) 3=begin(L2') 4=end(L2') 5=end(L1)
    expect(partner).toEqual([5, 2, 1, 4, 3, 0]);
  });

  it('多余的 end 不配对（返回 -1），也不影响后面的配对', () => {
    const tokens = scanBlockTokens('end begin end');
    const partner = matchBlockTokens(tokens);
    expect(partner).toEqual([-1, 2, 1]);
  });
});

describe('findBlockPair', () => {
  it('光标在最外层 begin 上 → 返回最外层一对', () => {
    const p = findBlockPair(SRC, 1, 28); // 行 1 的 begin 内
    expect(p?.begin.line).toBe(1);
    expect(p?.end.line).toBe(7);
  });

  it('光标在内层 end 上 → 返回内层一对', () => {
    const p = findBlockPair(SRC, 4, 9); // 行 4 的 end 内
    expect(p?.begin.line).toBe(2);
    expect(p?.end.line).toBe(4);
  });

  it('光标在行 4 的 begin 上 → 返回另一对内层', () => {
    const p = findBlockPair(SRC, 4, 20); // else 后面的 begin
    expect(p?.begin.line).toBe(4);
    expect(p?.end.line).toBe(6);
  });

  it('光标不在 begin/end 上 → null', () => {
    expect(findBlockPair(SRC, 3, 13)).toBeNull();
    expect(findBlockPair(SRC, 0, 2)).toBeNull();
  });

  it('注释里的位置 → null（注释不参与配对）', () => {
    const src = '// begin\nendmodule';
    expect(findBlockPair(src, 0, 4)).toBeNull();
  });

  it('没有配对对象的 begin → null', () => {
    expect(findBlockPair('begin', 0, 2)).toBeNull();
  });
});
