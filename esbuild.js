// esbuild 构建脚本：把 src/extension.ts 打成 dist/extension.js 单文件
// 用法：node esbuild.js [--watch] [--production]
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  // vscode 由扩展宿主在运行时提供，绝不能打包进来
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  // 对齐 VSCode 扩展宿主内置的 Node 主版本
  target: 'node24',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[esbuild] watching...');
  } else {
    await esbuild.build(options);
    console.log('[esbuild] build done');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
