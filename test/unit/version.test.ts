import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILD_ID, VERSION, versionBanner } from '../../src/core/version';

// vitest 从项目根目录运行
const root = process.cwd();

describe('版本号', () => {
  it('VERSION 与 package.json 的 version 一致', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it('BUILD_ID 是正整数', () => {
    expect(Number.isInteger(BUILD_ID)).toBe(true);
    expect(BUILD_ID).toBeGreaterThan(0);
  });

  it('版本横幅格式固定', () => {
    expect(versionBanner()).toBe(`verikit v${VERSION} build ${BUILD_ID}`);
  });
});
