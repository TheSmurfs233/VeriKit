# FPGA Verilog Helper

VSCode 的 Verilog **代码编写**辅助插件。轻量、跨平台（先只实测 Windows）、仅自用。

**不做**综合、仿真运行、工程生成。

## 当前状态

S0（工程骨架与门禁）进行中：插件可激活、可打包，**没有任何功能**。

功能从 S2 开始（高亮与代码片段），核心自研部分是 S3a 的模块头解析。

## 开发

```bash
npm install
npm run verify        # 五段门禁：静态检查 / 单测 / 架构与文档 / 构建 / 打包
```

调试：在 VSCode 里按 F5（会自动先编译），会打开一个加载了本插件的"扩展开发宿主"窗口。

`.vscode/launch.json` 里有两个配置：

| 配置 | 打开的目录 | 用途 |
|---|---|---|
| 运行扩展（当前工作区） | 插件源码目录 | 只确认插件能激活 |
| **运行扩展（打开测试工作区）** | `../test-workspace` | **平时用这个** —— 弹出的窗口直接打开 HDL 测试工程，可以看高亮/诊断效果 |

测试工作区在 `D:\Embedded\FPGA\test-workspace`，与插件源码平级，不属于本仓库。
它包含 `rtl/counter.v`（正常模块）、`top.v`（跨文件例化）、`broken.v`（故意写错）、
`legacy_nonansi.v`（非 ANSI 端口边界样本）、`中文文件名_测试.v`（非 ASCII 路径）。

> 日常使用（不是开发）不需要 F5：`npm run package` 后
> `code --install-extension dist/fpga-verilog-helper.vsix` 装一次即可。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/01_项目进度.md` | **唯一**"现在做到哪"的事实来源 |
| `docs/10_框架_三层架构.md` | 分层、路线声明（为什么只有一块自研） |
| `docs/18_待确认清单.md` | 所有悬案的唯一去处 |
| `docs/90_已知问题与限制.md` | 已知缺陷与设计限制 |
| `docs/00_开发日志.md` | 追加式实验记录 |
| `workflow/` | 开发流程规范（阶段、门禁、测试策略、调试方法论） |

## 架构硬约束

`src/core/**` **不得 import `vscode`** —— 由 `test/arch.js` 在 `verify.sh` 中机械检查。

一旦违反，该模块将永久失去在 vitest 中被测试的可能，只能靠手动 F5 回归。
