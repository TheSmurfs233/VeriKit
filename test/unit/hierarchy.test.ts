import { describe, expect, it } from 'vitest';
import {
  buildHierarchy,
  findTopCandidates,
  type HierarchySource,
} from '../../src/core/parse/hierarchy';

/** 构造索引条目的助手 */
function mod(
  name: string,
  children: [string, string][],
  opts?: { file?: string; line?: number; conflicted?: boolean }
): HierarchySource {
  return {
    name,
    file: opts?.file ?? `${name}.v`,
    line: opts?.line ?? 0,
    conflicted: opts?.conflicted,
    children: children.map(([instanceName, moduleName]) => ({
      instanceName,
      moduleName,
      line: 1,
    })),
  };
}

describe('buildHierarchy', () => {
  const INDEX = new Map<string, HierarchySource>([
    ['top', mod('top', [['u_alu', 'alu'], ['u_counter_a', 'counter'], ['u_counter_b', 'counter']])],
    ['alu', mod('alu', [['u_adder', 'adder']])],
    ['adder', mod('adder', [])],
    ['counter', mod('counter', [])],
    ['missing_ref', mod('missing_ref', [['u_x', 'not_defined']])],
  ]);
  const lookup = (n: string): HierarchySource | undefined => INDEX.get(n);

  it('三层层次正确展开', () => {
    const root = buildHierarchy('top', lookup);
    expect(root?.moduleName).toBe('top');
    expect(root?.children.map((c) => c.instanceName)).toEqual([
      'u_alu',
      'u_counter_a',
      'u_counter_b',
    ]);
    const alu = root?.children.find((c) => c.instanceName === 'u_alu');
    expect(alu?.children[0].moduleName).toBe('adder');
    expect(alu?.children[0].children).toHaveLength(0);
  });

  it('同模块多实例 → 各自独立子树', () => {
    const root = buildHierarchy('top', lookup)!;
    const a = root.children.find((c) => c.instanceName === 'u_counter_a');
    const b = root.children.find((c) => c.instanceName === 'u_counter_b');
    expect(a?.moduleName).toBe('counter');
    expect(b?.moduleName).toBe('counter');
    expect(a).not.toBe(b);
  });

  it('定义信息（file/defLine）来自索引', () => {
    const root = buildHierarchy('top', lookup)!;
    expect(root.file).toBe('top.v');
    expect(root.children[0].file).toBe('alu.v');
  });

  it('未定义模块 → unresolved 叶子', () => {
    const root = buildHierarchy('missing_ref', lookup)!;
    expect(root.children[0].unresolved).toBe(true);
    expect(root.children[0].children).toHaveLength(0);
  });

  it('多处定义 → conflicted 标记', () => {
    const idx = new Map<string, HierarchySource>([
      ['dup', mod('dup', [], { conflicted: true })],
    ]);
    const root = buildHierarchy('dup', (n) => idx.get(n))!;
    expect(root.conflicted).toBe(true);
  });

  it('环路防护：A→B→A 不死循环', () => {
    const idx = new Map<string, HierarchySource>([
      ['a', mod('a', [['u_b', 'b']])],
      ['b', mod('b', [['u_a', 'a']])],
    ]);
    const root = buildHierarchy('a', (n) => idx.get(n))!;
    expect(root.moduleName).toBe('a');
    const b = root.children[0];
    expect(b.moduleName).toBe('b');
    const aAgain = b.children[0];
    expect(aAgain.cycle).toBe(true);
  });

  it('深度上限兜底', () => {
    const idx = new Map<string, HierarchySource>([
      ['x', mod('x', [['u_x', 'x']])], // 自例化
    ]);
    const root = buildHierarchy('x', (n) => idx.get(n), { maxDepth: 3 })!;
    let depth = 0;
    let cur: typeof root | undefined = root;
    while (cur && cur.children.length > 0) {
      cur = cur.children[0];
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(3);
  });

  it('top 不在索引中 → null', () => {
    expect(buildHierarchy('nope', lookup)).toBeNull();
  });
});

describe('findTopCandidates', () => {
  it('未被例化者为候选；被例化者排除', () => {
    const mods = [
      mod('top', [['u_a', 'a']]),
      mod('a', []),
      mod('tb', []),
    ];
    expect(findTopCandidates(mods).map((m) => m.name)).toEqual(['top', 'tb']);
  });

  it('自身被自己例化（病态）→ 不是候选', () => {
    const mods = [mod('a', [['u_a', 'a']])];
    expect(findTopCandidates(mods)).toEqual([]);
  });
});
