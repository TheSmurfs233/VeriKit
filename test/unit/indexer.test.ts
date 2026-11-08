import { describe, expect, it } from 'vitest';
import { rebuildIndex } from '../../src/core/parse/indexer';

const TOP_TEXT = [
  'module top ();',
  '    counter u_a (.clk(c));',
  '    counter u_b (.clk(c));',
  'endmodule',
].join('\n');

const COUNTER_TEXT = 'module counter (input clk); endmodule';

describe('rebuildIndex', () => {
  it('回归（v0.9.0 实测 bug）：同一文件传入两次 → 无冲突、children 不翻倍', () => {
    const r = rebuildIndex([
      { file: 'top.v', text: TOP_TEXT },
      { file: 'top.v', text: TOP_TEXT },
      { file: 'counter.v', text: COUNTER_TEXT },
      { file: 'counter.v', text: COUNTER_TEXT },
    ]);
    expect(r.conflicts.size).toBe(0);
    expect(r.modules.get('top')!.conflicted).toBeUndefined();
    expect(r.modules.get('counter')!.conflicted).toBeUndefined();
    expect(r.modules.get('top')!.children.map((c) => c.instanceName)).toEqual(['u_a', 'u_b']);
  });

  it('同一文件重复传入 → 后者覆盖（打开文档覆盖磁盘版本）', () => {
    const oldText = 'module m (input a); endmodule';
    const newText = 'module m (input b); endmodule';
    const r = rebuildIndex([
      { file: 'm.v', text: oldText },
      { file: 'm.v', text: newText },
    ]);
    expect(r.modules.get('m')!.ports[0].name).toBe('b');
  });

  it('同名模块定义在不同文件 → 冲突 + ⚠ 标记', () => {
    const r = rebuildIndex([
      { file: 'a/counter.v', text: COUNTER_TEXT },
      { file: 'b/counter.v', text: COUNTER_TEXT },
    ]);
    expect(r.conflicts.get('counter')).toEqual(['a/counter.v', 'b/counter.v']);
    expect(r.modules.get('counter')!.conflicted).toBe(true);
  });

  it('例化归属：top 的例化挂在 top.children，counter 无 children', () => {
    const r = rebuildIndex([
      { file: 'top.v', text: TOP_TEXT },
      { file: 'counter.v', text: COUNTER_TEXT },
    ]);
    expect(r.modules.get('top')!.children).toHaveLength(2);
    expect(r.modules.get('counter')!.children).toHaveLength(0);
  });

  it('打开文档覆盖磁盘后，例化按新文本归属', () => {
    const edited = ['module top ();', '    counter u_new (.clk(c));', 'endmodule'].join('\n');
    const r = rebuildIndex([
      { file: 'top.v', text: edited },
      { file: 'counter.v', text: COUNTER_TEXT },
    ]);
    expect(r.modules.get('top')!.children.map((c) => c.instanceName)).toEqual(['u_new']);
  });
});
