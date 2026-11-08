/**
 * 版本号的唯一来源之一。
 *
 * 为什么 version 和 package.json 里重复了一次：
 * 打包后的代码读不到 package.json 的运行时值（esbuild 会内联），
 * 而 version 是"给人看"的、BUILD_ID 是"给校验用"的。
 * 重复的代价由 test/doc_check.py 的三方一致性检查来兜底。
 */

/** 语义化版本，必须与 package.json 的 version 完全一致 */
export const VERSION = '0.9.0';

/** 单调递增的构建号，每次"可被加载的改动"都要 +1 */
export const BUILD_ID = 30;

/** 激活时打印到 OutputChannel 的第一行 */
export function versionBanner(): string {
  return `verikit v${VERSION} build ${BUILD_ID}`;
}
