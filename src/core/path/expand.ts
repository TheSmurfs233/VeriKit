import * as path from 'node:path';

/**
 * 展开用户填写的路径。
 *
 * VSCode 的普通 settings 不会展开 `${env:VAR}`（那是 tasks/launch 的语法），
 * 所以这里自己处理。展开后可能变成空串 —— 调用方按"未配置"处理，不要当成路径用。
 */
export function expandPath(
  raw: string | undefined,
  env: Record<string, string | undefined>
): string {
  let p = (raw ?? '').trim();
  if (!p) {
    return '';
  }

  // ${env:NAME} —— 未定义的变量替换成空串，而不是保留原文
  p = p.replace(/\$\{env:([^}]+)\}/g, (_m, name: string) => env[name] ?? '');
  if (!p.trim()) {
    return '';
  }

  // ~ / ~/x / ~\x
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    const home = env.USERPROFILE ?? env.HOME ?? '';
    if (home) {
      p = path.join(home, p.slice(1));
    }
  }

  return p;
}
