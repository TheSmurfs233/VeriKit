import { describe, expect, it } from 'vitest';
import { bodyPortsForModule, collectBodyPorts } from '../../src/core/parse/signals';
import { rebuildIndex } from '../../src/core/parse/indexer';
import { generateInstantiation } from '../../src/core/parse/instantiate';

// 用户实测 bug 样本：bus_matrix（非 ANSI）与其例化 —— 方向提示缺失
const BUS_TEXT = [
  'module bus_matrix (clk, rst_n, cpu_dout, mem_din, led);',
  '',
  '    input  wire       clk;',
  '    input  wire       rst_n;',
  '    input  wire [7:0] cpu_dout;',
  '    input  wire [7:0] mem_din;',
  '    output wire [7:0] led;',
  '',
  '    arbiter #(.DEPTH(4)) u_arb (.clk(clk), .req(|cpu_dout), .grant(grant));',
  '',
  '    assign led = grant ? cpu_dout : mem_din;',
  '',
  'endmodule',
].join('\n');

describe('collectBodyPorts（非 ANSI 端口来源）', () => {
  it('体内端口声明 → 方向/顺序/行号齐全', () => {
    const ports = bodyPortsForModule(BUS_TEXT, 'bus_matrix');
    expect(ports.map((p) => [p.name, p.direction])).toEqual([
      ['clk', 'input'],
      ['rst_n', 'input'],
      ['cpu_dout', 'input'],
      ['mem_din', 'input'],
      ['led', 'output'],
    ]);
    expect(ports[0].line).toBe(2);
  });

  it('按模块分组：多模块文件各归各', () => {
    const src = [
      'module m1 (x);',
      '    input wire x;',
      'endmodule',
      'module m2 ();',
      '    output wire y;',
      'endmodule',
    ].join('\n');
    const all = collectBodyPorts(src);
    expect(all.get('m1')!.map((p) => p.name)).toEqual(['x']);
    expect(all.get('m2')!.map((p) => p.name)).toEqual(['y']);
  });

  it('未声明端口的模块 → 空数组', () => {
    expect(bodyPortsForModule('module m (); endmodule', 'm')).toEqual([]);
  });
});

describe('索引并入体内端口（非 ANSI 全链路）', () => {
  it('rebuildIndex：非 ANSI 模块的 ports 由体内声明补齐', () => {
    const counterText = 'module counter (input clk); endmodule';
    const r = rebuildIndex([
      { file: 'bus_matrix.v', text: BUS_TEXT },
      { file: 'counter.v', text: counterText },
    ]);
    expect(r.modules.get('bus_matrix')!.ports.map((p) => p.name)).toEqual([
      'clk',
      'rst_n',
      'cpu_dout',
      'mem_din',
      'led',
    ]);
    expect(r.modules.get('counter')!.ports.map((p) => p.name)).toEqual(['clk']);
  });

  it('全链路：非 ANSI 模块也能一键例化出完整端口', () => {
    const r = rebuildIndex([{ file: 'bus_matrix.v', text: BUS_TEXT }]);
    const m = r.modules.get('bus_matrix')!;
    const text = generateInstantiation(m.name, m.params, m.ports);
    expect(text).toContain('.clk(clk),');
    expect(text).toContain('.rst_n(rst_n),');
    expect(text).toContain('.cpu_dout(cpu_dout),');
    expect(text).toContain('.led(led)');
    expect(text).not.toContain('()');
  });
});
