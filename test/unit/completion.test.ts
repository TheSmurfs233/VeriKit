import { describe, expect, it } from 'vitest';
import {
  findEnclosingInstance,
  portCompletions,
  signalCompletions,
  moduleCompletions,
} from '../../src/core/parse/completion';
import { parseInstances } from '../../src/core/parse/instance';
import type { PortInfo } from '../../src/core/parse/moduleHeader';

// 用户目标场景：例化连接区里输入 .c → 补全该模块的端口名
const INSTANCE_SRC = [
  'counter #(',
  '    .WIDTH (8)',
  ') u_counter_a (',
  '    .clk   (clk),',
  '    .ovf   (ovf)',
  ');',
].join('\n');

describe('findEnclosingInstance', () => {
  const insts = parseInstances(INSTANCE_SRC);

  it('连接区内（连接表括号后）→ 命中', () => {
    expect(findEnclosingInstance(insts, 2, 16)?.instanceName).toBe('u_counter_a');
  });

  it('参数表位置（.WIDTH 行）→ 不命中（参数不是端口连接）', () => {
    expect(findEnclosingInstance(insts, 1, 10)).toBeNull();
  });

  it('连接区内（末行 .ovf 处）→ 命中', () => {
    expect(findEnclosingInstance(insts, 4, 10)?.moduleName).toBe('counter');
  });

  it('例化开始前的模块名处 → 不命中', () => {
    expect(findEnclosingInstance(insts, 0, 6)).toBeNull();
  });

  it('连接区结束之后 → 不命中', () => {
    expect(findEnclosingInstance(insts, 5, 2)).toBeNull();
  });

  it('两个例化时各归各', () => {
    const src = 'adder u1 (.a(a));\nadder u2 (.b(b));';
    const two = parseInstances(src);
    expect(findEnclosingInstance(two, 0, 10)?.instanceName).toBe('u1');
    expect(findEnclosingInstance(two, 1, 10)?.instanceName).toBe('u2');
  });
});

describe('portCompletions', () => {
  it('端口名 + 方向 detail', () => {
    const ports: PortInfo[] = [
      { name: 'clk', direction: 'input', line: 0 },
      { name: 'ovf', direction: 'output', line: 1 },
    ];
    expect(portCompletions(ports)).toEqual([
      { label: 'clk', kind: 'port', detail: 'input' },
      { label: 'ovf', kind: 'port', detail: 'output' },
    ]);
  });
});

describe('signalCompletions', () => {
  const SRC = [
    'module m ();',
    '    parameter W = 8;',
    '    wire [8:0] sum_ext;',
    '    reg [3:0] q;',
    'endmodule',
  ].join('\n');

  it('收集信号与参数，detail 带类型/位宽', () => {
    const items = signalCompletions(SRC);
    const byName = new Map(items.map((i) => [i.label, i]));
    expect(byName.get('W')).toMatchObject({ kind: 'parameter', detail: 'parameter' });
    expect(byName.get('sum_ext')).toMatchObject({ kind: 'net', detail: 'wire [8:0]' });
    expect(byName.get('q')).toMatchObject({ kind: 'variable', detail: 'reg [3:0]' });
  });

  it('同名去重（端口优先于变量）', () => {
    const src = ['module m (input clk);', '    reg clk;', 'endmodule'].join('\n');
    const items = signalCompletions(src).filter((i) => i.label === 'clk');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('port');
  });
});

describe('moduleCompletions', () => {
  it('模块名清单 → kind module', () => {
    expect(moduleCompletions(['counter', 'alu'])).toEqual([
      { label: 'counter', kind: 'module', detail: 'module' },
      { label: 'alu', kind: 'module', detail: 'module' },
    ]);
  });
});
