import { describe, expect, it } from 'vitest';
import { parseModuleHeaders } from '../../src/core/parse/moduleHeader';
import { parseInstances } from '../../src/core/parse/instance';
import { computePortDirectionHints } from '../../src/core/parse/inlay';
import type { PortInfo } from '../../src/core/parse/moduleHeader';

const HEADER = [
  'module riscv (',
  '    input clk,',
  '    input rst_n,',
  '    output led',
  ');',
  'endmodule',
].join('\n');

const INSTANCE = [
  'riscv riscv_inst (',
  '    .clk(clk_25m),',
  '    .rst_n(rst_n),',
  '    .led(led)',
  ');',
].join('\n');

describe('parseModuleHeaders', () => {
  it('解析 ANSI 端口方向', () => {
    const headers = parseModuleHeaders(HEADER);
    expect(headers).toHaveLength(1);
    expect(headers[0].name).toBe('riscv');
    expect(headers[0].ansi).toBe(true);
    expect(headers[0].ports).toEqual([
      { name: 'clk', direction: 'input', line: 1 },
      { name: 'rst_n', direction: 'input', line: 2 },
      { name: 'led', direction: 'output', line: 3 },
    ]);
  });

  it('方向继承：input a, b → b 也是 input', () => {
    const headers = parseModuleHeaders('module m (input a, b, output c);');
    expect(headers[0].ports).toEqual([
      { name: 'a', direction: 'input', line: 0 },
      { name: 'b', direction: 'input', line: 0 },
      { name: 'c', direction: 'output', line: 0 },
    ]);
  });

  it('位宽与 reg/wire 不干扰端口名', () => {
    const headers = parseModuleHeaders('module m (output reg [3:0] q, input wire clk);');
    expect(headers[0].ports).toEqual([
      { name: 'q', direction: 'output', line: 0, range: '[3:0]', typeWord: 'reg' },
      { name: 'clk', direction: 'input', line: 0, typeWord: 'wire' },
    ]);
  });

  it('参数表被跳过，位宽里可以用参数', () => {
    const headers = parseModuleHeaders(
      'module m #(parameter W = 8, parameter N = 2) (input [W-1:0] a, output [W*N-1:0] b);'
    );
    // 字段映射断言（避免显式 undefined 键与 toEqual 的语义纠缠）
    expect(
      headers[0].ports.map((p) => ({ name: p.name, direction: p.direction, range: p.range }))
    ).toEqual([
      { name: 'a', direction: 'input', range: '[W-1:0]' },
      { name: 'b', direction: 'output', range: '[W*N-1:0]' },
    ]);
  });

  it('非 ANSI（端口表为空）→ ansi=false，方向未知', () => {
    const headers = parseModuleHeaders('module legacy (a, b);\n input a;\nendmodule');
    expect(headers[0].ansi).toBe(false);
    expect(headers[0].ports).toEqual([]);
  });

  it('一个文件里多个模块', () => {
    const headers = parseModuleHeaders('module a (input x); endmodule\nmodule b (output y); endmodule');
    expect(headers.map((h) => h.name)).toEqual(['a', 'b']);
  });
});

describe('parseInstances', () => {
  it('解析命名连接与插入点（在连接项右括号之后）', () => {
    const insts = parseInstances(INSTANCE);
    expect(insts).toHaveLength(1);
    expect(insts[0].moduleName).toBe('riscv');
    expect(insts[0].instanceName).toBe('riscv_inst');
    expect(insts[0].connections.map((c) => c.port)).toEqual(['clk', 'rst_n', 'led']);
    // 第 2 行 ".clk(clk_25m)," → ")" 之后是第 2 行第 17 列（0 基）
    expect(insts[0].connections[0].endLine).toBe(1);
    expect(insts[0].connections[0].endChar).toBe(17);
  });

  it('带参数的例化', () => {
    const insts = parseInstances('riscv #(.W(8)) u1 (.clk(clk), .led(led));');
    expect(insts[0].moduleName).toBe('riscv');
    expect(insts[0].connections.map((c) => c.port)).toEqual(['clk', 'led']);
  });

  it('module 声明不会被误判为例化', () => {
    expect(parseInstances(HEADER)).toEqual([]);
  });

  it('控制流不会被误判', () => {
    const src = 'always @(posedge clk) begin\n  if (en) q <= 1\'b1;\nend';
    expect(parseInstances(src)).toEqual([]);
  });

  it('位置连接 → connections 为空（v1 不处理）', () => {
    const insts = parseInstances('adder u_add (a, b, sum);');
    expect(insts).toHaveLength(1);
    expect(insts[0].connections).toEqual([]);
  });

  it('连接项里允许拼接 {}', () => {
    const insts = parseInstances('adder u_add (.a({x, y}), .sum(s));');
    expect(insts[0].connections.map((c) => c.port)).toEqual(['a', 'sum']);
  });

  it('连接表达式提取：普通/拼接/悬空', () => {
    const src = [
      'adder u1 (',
      '    .a  (a_sig),',
      '    .b  ({x, y}),',
      '    .sum  (),',
      ');',
    ].join('\n');
    const conns = parseInstances(src)[0].connections;
    expect(conns.map((c) => [c.port, c.signal])).toEqual([
      ['a', 'a_sig'],
      ['b', '{x, y}'],
      ['sum', ''],
    ]);
  });

  it('多个例化', () => {
    const src = 'adder u1 (.a(a));\nadder u2 (.b(b));';
    expect(parseInstances(src).map((i) => i.instanceName)).toEqual(['u1', 'u2']);
  });
});

describe('computePortDirectionHints', () => {
  const lookup = (name: string): PortInfo[] | undefined => {
    if (name === 'riscv') {
      return [
        { name: 'clk', direction: 'input' },
        { name: 'rst_n', direction: 'input' },
        { name: 'led', direction: 'output' },
      ];
    }
    return undefined;
  };

  it('每个连接项产出一条方向提示', () => {
    const hints = computePortDirectionHints(INSTANCE, lookup);
    expect(hints).toEqual([
      { line: 1, char: 17, port: 'clk', direction: 'input', moduleName: 'riscv' },
      { line: 2, char: 17, port: 'rst_n', direction: 'input', moduleName: 'riscv' },
      { line: 3, char: 13, port: 'led', direction: 'output', moduleName: 'riscv' },
    ]);
  });

  it('模块查不到 → 无提示', () => {
    expect(computePortDirectionHints(INSTANCE, () => undefined)).toEqual([]);
  });

  it('连接的端口在模块里不存在 → 未知端口提示（不再静默跳过）', () => {
    const src = 'riscv u1 (.clk(c), .not_exist(x));';
    const hints = computePortDirectionHints(src, lookup);
    expect(hints).toHaveLength(2);
    expect(hints.find((h) => h.port === 'not_exist')?.direction).toBe('未知端口');
    expect(hints.find((h) => h.port === 'clk')?.direction).toBe('input');
  });
});

describe('注释干扰回归（counter.v 实测 bug：ovf 曾被丢弃）', () => {
  const COUNTER = [
    'module counter #(',
    '    parameter WIDTH = 8',
    ') (',
    '    input                  clk,',
    '    input                  rst_n,',
    '    input                  en,          // 计数使能',
    '    output reg [WIDTH-1:0] cnt,         // 当前计数值',
    '    output                 ovf          // 溢出脉冲',
    ');',
  ].join('\n');

  it('行尾注释不吞掉端口（ovf 曾被解析成注释词而丢弃）', () => {
    const h = parseModuleHeaders(COUNTER)[0];
    expect(h.ports.map((p) => p.name)).toEqual(['clk', 'rst_n', 'en', 'cnt', 'ovf']);
    expect(h.ports.find((p) => p.name === 'ovf')?.direction).toBe('output');
  });

  it('独立成行的注释不破坏后续端口', () => {
    const src = [
      'module m (',
      '    // 时钟',
      '    input clk,',
      '    // 输出',
      '    output led',
      ');',
    ].join('\n');
    const h = parseModuleHeaders(src)[0];
    expect(h.ports).toEqual([
      { name: 'clk', direction: 'input', line: 2 },
      { name: 'led', direction: 'output', line: 4 },
    ]);
  });

  it('例化连接表里的注释也不影响连接项与插入点', () => {
    const src = [
      'adder u1 (',
      '    // 加数',
      '    .a(a),',
      '    .b(b) // 和',
      ');',
    ].join('\n');
    const insts = parseInstances(src);
    expect(insts[0].connections.map((c) => c.port)).toEqual(['a', 'b']);
    // ".b(b) // 和" → ) 在第 9 列（0 基），插入点在其后
    expect(insts[0].connections[1].endLine).toBe(3);
    expect(insts[0].connections[1].endChar).toBe(9);
  });
});
