/**
 * Windows 上的 `.bat` / `.cmd` 不能直接 spawn：
 *   - libuv 不会自动补后缀
 *   - 直接 spawn 会抛 EINVAL（实测，见 test/unit/winShim.spawn.test.ts）
 *   - `shell: true` 会把参数拼成字符串，路径里的空格/`&` 立刻出问题
 *
 * 正确的形态是让 **`call` 当 cmd 的命令**，其余作为它的参数：
 *   cmd.exe /d /s /c call <bat 路径> <args...>
 *
 * ⚠️ 不要自己拼 `"<path> <args>"` 整条命令行 —— 实测会被 Node 的 argv 转义
 * 破坏成 `\"...\"`，cmd 收到的是一串带反斜杠的字面量，报"不是内部或外部命令"。
 * 这个坑是 S1 手动验收时踩到的：版本查询 53 ms 就失败，而期望是约 1 s。
 */

export interface SpawnPlan {
  file: string;
  args: string[];
}

/** cmd 的元字符：出现在路径或参数里就无法安全传递 */
const CMD_UNSAFE = /[&|<>^"]/;

/** 需要 cmd.exe 转发的后缀 */
export function needsCmdShim(target: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && /\.(bat|cmd)$/i.test(target);
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

  for (const token of [target, ...args]) {
    if (CMD_UNSAFE.test(token)) {
      throw new Error(`路径或参数含 cmd 无法安全转义的字符：${token}`);
    }
  }

  return { file: comspec, args: ['/d', '/s', '/c', 'call', target, ...args] };
}
