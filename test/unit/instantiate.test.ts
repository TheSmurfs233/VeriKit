import { describe, expect, it } from 'vitest';
import { generateInstantiation } from '../../src/core/parse/instantiate';

// 用户提供的精确模板（2026-11-09）：
// 原模块 pwm_gen（1 参数 + 10 端口），生成的例化文本必须逐字符一致
const PWM_PARAMS = [{ name: 'CNT_W' }];
const PWM_PORTS = [
  { name: 'clk' },
  { name: 'rst_n' },
  { name: 'i_period' },
  { name: 'i_duty' },
  { name: 'i_phase' },
  { name: 'i_vld' },
  { name: 'i_en' },
  { name: 'i_sync' },
  { name: 'o_pwm' },
  { name: 'o_period_tick' },
];

const PWM_EXPECTED = [
  'pwm_gen # (',
  '.CNT_W(CNT_W)',
  ')',
  'pwm_gen_inst (',
  '.clk(clk),',
  '.rst_n(rst_n),',
  '.i_period(i_period),',
  '.i_duty(i_duty),',
  '.i_phase(i_phase),',
  '.i_vld(i_vld),',
  '.i_en(i_en),',
  '.i_sync(i_sync),',
  '.o_pwm(o_pwm),',
  '.o_period_tick(o_period_tick)',
  ');',
].join('\n');

describe('generateInstantiation', () => {
  it('用户模板逐字符一致（pwm_gen）', () => {
    expect(generateInstantiation('pwm_gen', PWM_PARAMS, PWM_PORTS)).toBe(PWM_EXPECTED);
  });

  it('无参数 → 省略参数表块', () => {
    const out = generateInstantiation('counter', [], [
      { name: 'clk' },
      { name: 'ovf' },
    ]);
    expect(out).toBe('counter counter_inst (\n.clk(clk),\n.ovf(ovf)\n);');
  });

  it('实例名默认 <模块名>_inst，可覆盖', () => {
    const out = generateInstantiation('alu', [], [{ name: 'a' }], 'u_alu_custom');
    expect(out).toContain('u_alu_custom (');
    expect(out).not.toContain('alu_inst');
  });

  it('无端口 → 生成空连接骨架（退化形态）', () => {
    const out = generateInstantiation('leaf', [], []);
    expect(out).toBe('leaf leaf_inst (\n\n);');
  });

  it('参数与端口的顺序保持输入顺序', () => {
    const out = generateInstantiation(
      'm',
      [{ name: 'B' }, { name: 'A' }],
      [{ name: 'z' }, { name: 'a' }]
    );
    expect(out).toContain('.B(B),\n.A(A)');
    expect(out).toContain('.z(z),\n.a(a)');
  });
});
