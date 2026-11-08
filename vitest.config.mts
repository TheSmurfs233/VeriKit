import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    // 关闭文件级并行。
    // 原因：多个 worker 会并发写 Vite 的 SSR 转换缓存（落在系统临时目录），Windows 上偶发
    //   EPERM: operation not permitted, open '...\Temp\<随机>\ssr\<hash>'
    // 表现为"3 次里 1 次失败"：代码没动，门禁却红了 —— 这是最伤信任的一种失败。
    // 实测：串行后连跑 5 次全绿；本套用例总耗时仍在 1~2 s，代价可接受。
    fileParallelism: false,
  },
});
