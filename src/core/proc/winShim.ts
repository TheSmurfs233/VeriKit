/**
 * Windows 上的 `.bat` / `.cmd` 不能直接 spawn（libuv 不会自动补后缀，也没有可执行头），
 * 必须经 cmd.exe 转发。这里把它做成**纯函数**，好在 vitest 里覆盖各种引号组合。
 *
 * 关键规则（cmd 的 /s /c 语义）：整条命令行用一对引号包住时，cmd 会剥掉最外层引号，
 * 再按剩余内容执行。所以路径带空格时必须是 `"\"C:\a b\x.bat\" -version"`。
 */

export interface SpawnPlan {
  file: string;
  args: string[];
}

/** 需要 cmd.exe 转发的后缀 */
export function needsCmdShim(target: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(bat|cmd)$/i.test(target);
}

/**
 * 把单个参数包成 cmd 能正确解析的 token。
 * Windows 路径里不可能出现双引号，所以出现即视为非法输入并直接抛出。
 */
function quoteForCmd(token: string): string {
  if (token.includes('"')) {
    throw new Error(`路径中含非法字符（双引号），无法安全传参：${token}`);
  }
  return /[\s&|<>^()]/.test(token) ? `"${token}"` : token;
}

/** 构造真正要交给 child_process.spawn 的 file/args */
export function buildSpawnPlan(
  target: string,
  args: string[],
  platform: NodeJS.Platform,
  comspec: string
): SpawnPlan {
  if (!needsCmdShim(target, platform)) {
    return { file: target, args: [...args] };
  }
  const line = [target, ...args].map(quoteForCmd).join(' ');
  return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`] };
}
