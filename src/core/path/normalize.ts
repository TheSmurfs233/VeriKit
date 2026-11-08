/**
 * 路径归一：Windows 下同一文件可能有多种写法（实测同一文件同时出现
 * d:\... 与 d:/...），比较前必须归一，否则诊断会匹配不到文件而静默丢失。
 *
 * 规则：反斜杠 → 正斜杠，统一小写（Windows 文件系统大小写不敏感）。
 * 非 Windows 下小写化理论上有误伤风险（存在仅大小写不同的两个文件），
 * 但本项目实测平台为 Windows，S3b 多文件化时再按平台区分。
 */

export function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}
