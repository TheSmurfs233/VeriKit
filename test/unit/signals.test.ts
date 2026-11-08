import { describe, expect, it } from 'vitest';
import { formatSignalHover, parseSignalDeclarations } from '../../src/core/parse/signals';

// 用户给出的目标场景（参考截图）：
//   reg [CNT_W-1:0] sh_period, sh_duty, sh_phase;
//   ...
//   sh_phase <= i_phase;
// 悬停 sh_phase 应给出：变量 / reg / [CNT_W-1:0] / 所属模块 / 声明行
const USER_CASE = [
  'module tb_demo #(',
  '    parameter CNT_W = 8',
  ') (',
  '    input             clk,',
  '    input             rst_n,',
  '    input  [CNT_W-1:0] i_phase,',
  '    output [CNT_W-1:0] o_phase',
  ');',
  '',
  '    reg [CNT_W-1:0] sh_period, sh_duty, sh_phase;',
  '',
  '    always @(posedge clk) begin',
  '        sh_phase <= i_phase;',
  '    end',
  '',
  'endmodule',
].join('\n');

describe('parseSignalDeclarations', () => {
  it('ANSI 端口带方向与行号', () => {
    const decls = parseSignalDeclarations(USER_CASE).filter((d) => d.name === 'clk');
    expect(decls).toEqual([
      { name: 'clk', kind: 'port', direction: 'input', module: 'tb_demo', line: 3, text: 'input             clk,' },
    ]);
  });

  it('一行多名：reg [CNT_W-1:0] sh_period, sh_duty, sh_phase 各自成条', () => {
    const decls = parseSignalDeclarations(USER_CASE).filter((d) =>
      ['sh_period', 'sh_duty', 'sh_phase'].includes(d.name)
    );
    expect(decls).toHaveLength(3);
    for (const d of decls) {
      expect(d.kind).toBe('variable');
      expect(d.range).toBe('[CNT_W-1:0]');
      expect(d.typeWord).toBe('reg');
      expect(d.module).toBe('tb_demo');
    }
    expect(decls.map((d) => d.name)).toEqual(['sh_period', 'sh_duty', 'sh_phase']);
    expect(decls[0].line).toBe(9);
  });

  it('参数带值', () => {
    const decls = parseSignalDeclarations(USER_CASE).filter((d) => d.name === 'CNT_W');
    expect(decls[0].kind).toBe('parameter');
    expect(decls[0].value).toBe('8');
  });

  it('非 ANSI 体声明：input a; 也是端口', () => {
    const src = ['module legacy (a, b);', '    input a;', '    output b;', 'endmodule'].join('\n');
    const decls = parseSignalDeclarations(src);
    expect(decls.find((d) => d.name === 'a')).toMatchObject({ kind: 'port', direction: 'input' });
    expect(decls.find((d) => d.name === 'b')).toMatchObject({ kind: 'port', direction: 'output' });
  });

  it('wire 归为线网', () => {
    const src = 'module m ();\n    wire [8:0] sum_ext;\nendmodule';
    const decls = parseSignalDeclarations(src).filter((d) => d.name === 'sum_ext');
    expect(decls[0].kind).toBe('net');
    expect(decls[0].range).toBe('[8:0]');
  });

  it('同名信号分属不同模块 → 各自成条（悬停可列出）', () => {
    const src = [
      'module a ();',
      '    reg clk;',
      'endmodule',
      'module b ();',
      '    wire clk;',
      'endmodule',
    ].join('\n');
    const decls = parseSignalDeclarations(src).filter((d) => d.name === 'clk');
    expect(decls.map((d) => d.module)).toEqual(['a', 'b']);
    expect(decls.map((d) => d.kind)).toEqual(['variable', 'net']);
  });

  it('语句（assign/always/例化）不会被误判为声明', () => {
    const src = [
      'module m ();',
      '    wire x;',
      '    assign x = 1;',
      '    always @(posedge clk) x <= 0;',
      'endmodule',
    ].join('\n');
    const decls = parseSignalDeclarations(src).filter((d) => d.name === 'x');
    expect(decls).toHaveLength(1);
  });
});

describe('formatSignalHover', () => {
  it('输出中文详情与声明原文代码块', () => {
    const decls = parseSignalDeclarations(USER_CASE).filter((d) => d.name === 'sh_phase');
    const md = formatSignalHover('sh_phase', decls);
    expect(md).toContain('**sh_phase** — 变量');
    expect(md).toContain('类型 `reg`');
    expect(md).toContain('位宽 `[CNT_W-1:0]`');
    expect(md).toContain('所属模块：`tb_demo`（第 10 行声明）');
    expect(md).toContain('```verilog');
    expect(md).toContain('reg [CNT_W-1:0] sh_period, sh_duty, sh_phase;');
  });

  it('多处声明时列出清单', () => {
    const src = ['module a ();', '    reg clk;', 'endmodule', 'module b ();', '    wire clk;', 'endmodule'].join('\n');
    const decls = parseSignalDeclarations(src).filter((d) => d.name === 'clk');
    const md = formatSignalHover('clk', decls);
    expect(md).toContain('匹配到 2 处声明');
    expect(md).toContain('`a` 第 2 行');
    expect(md).toContain('`b` 第 5 行');
  });
});
