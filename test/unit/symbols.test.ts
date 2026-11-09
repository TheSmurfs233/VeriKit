import { describe, expect, it } from 'vitest';
import { buildSymbolTree } from '../../src/core/parse/symbols';

const SRC = [
  'module top #(',
  '    parameter W = 8',
  ') (',
  '    input  wire      clk,',
  '    output reg [3:0] q',
  ');',
  '',
  '    wire [7:0] bus;',
  '',
  '    counter u_a (',
  '        .clk (clk),',
  '        .cnt (bus[3:0])',
  '    );',
  '',
  'endmodule',
].join('\n');

describe('buildSymbolTree（文档大纲）', () => {
  const tree = buildSymbolTree(SRC);

  it('顶层是一个模块符号', () => {
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('top');
    expect(tree[0].kind).toBe('module');
  });

  it('子符号：端口 2 + 参数 1 + 例化 1', () => {
    const kinds = tree[0].children.map((c) => `${c.kind}:${c.name}`);
    expect(kinds).toEqual([
      'port:clk',
      'port:q',
      'parameter:W',
      'instance:u_a : counter',
    ]);
  });

  it('端口 detail 带方向与位宽', () => {
    const q = tree[0].children.find((c) => c.name === 'q')!;
    expect(q.detail).toBe('output reg [3:0]');
  });

  it('参数 detail 带值', () => {
    const w = tree[0].children.find((c) => c.name === 'W')!;
    expect(w.detail).toBe('= 8');
  });

  it('模块符号带 nameStart 与 endLine（vscode range 用）', () => {
    expect(tree[0].nameStart).toBe(7);
    expect(tree[0].endLine).toBe(14);
  });

  it('非 ANSI 模块同样覆盖（体内端口声明）', () => {
    const legacy = ['module legacy (a);', '    input a;', 'endmodule'].join('\n');
    const t = buildSymbolTree(legacy);
    expect(t[0].children.filter((c) => c.kind === 'port').map((c) => c.name)).toEqual(['a']);
  });

  it('无模块文件 → 空大纲', () => {
    expect(buildSymbolTree('assign x = 1;')).toEqual([]);
  });
});
