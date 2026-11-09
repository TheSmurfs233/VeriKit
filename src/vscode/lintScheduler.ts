import * as vscode from 'vscode';
import { parseXvlogOutput } from '../core/diag/parse';
import { lintFileRaw } from '../core/lint/raw';
import { resolveChangeAction, shouldTrigger } from '../core/trigger/policy';
import { Debouncer } from '../core/trigger/debounce';
import { writeBufferCopy } from '../core/lint/bufferCopy';
import { xvlogAdapter } from '../core/toolchain/adapter';
import type { ToolchainService } from './toolchainService';
import type { DiagnosticController } from './diagnosticController';

/**
 * 语法检查调度器：把"事件 → 检查 → 诊断"串起来。
 *
 * 触发：打开 / 保存（v1 固定 onOpenSave；编辑时触发见 docs/00 的后续增量）。
 * 竞态保护：每文档维护 seq，结果返回时序号过期则丢弃 —— 快速连续保存时
 * 最终显示的一定是最后一次检查的结果。
 *
 * 降级：工具链缺失/禁用 → 整簇清空 + 状态栏（由 ToolchainService 呈现）；
 * 超时 → 不写诊断（不展示过期结果）；解析自检（dropped.other > 0）→ 输出告警。
 */

export class LintScheduler implements vscode.Disposable {
  private seqByUri = new Map<string, number>();
  /** 每文档的编辑防抖（仅 onEdit 开启时挂起） */
  private debouncers = new Map<string, Debouncer>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: ToolchainService,
    private readonly controller: DiagnosticController,
    private readonly out: vscode.OutputChannel
  ) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((d) => {
        if (shouldTrigger('onOpenSave', 'open')) {
          void this.lint(d);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        this.debouncerFor(d.uri.toString()).cancel();   // 保存=最终确认，取消挂起的缓冲检查
        if (shouldTrigger('onOpenSave', 'save')) {
          void this.lint(d, 'disk');
        }
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.controller.delete(d.uri);
        this.seqByUri.delete(d.uri.toString());
        this.debouncerFor(d.uri.toString()).dispose();
        this.debouncers.delete(d.uri.toString());
      }),
      // change 事件三态：磁盘回读(外部改动) / 用户输入(onEdit 开启时防抖检查缓冲副本) / 忽略
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!LintScheduler.isCheckable(e.document)) {
          return;
        }
        const onEdit = vscode.workspace.getConfiguration().get<boolean>('verikit.check.onEdit', false);
        const action = resolveChangeAction(onEdit, e.contentChanges.length > 0);
        const key = e.document.uri.toString();
        if (action === 'disk') {
          this.debouncerFor(key).cancel();
          void this.lint(e.document, 'disk');
          return;
        }
        if (action === 'buffer') {
          // 停止输入 1 秒后才检查缓冲区副本；连续输入只保留最后一次
          this.debouncerFor(key).schedule(() => void this.lint(e.document, 'buffer'));
        }
      }),
      // 文件重命名：旧路径的诊断与序号清掉；新路径是 .v 则触发检查
      vscode.workspace.onDidRenameFiles((e) => {
        for (const f of e.files) {
          this.controller.delete(f.oldUri);
          this.seqByUri.delete(f.oldUri.toString());
        }
        for (const f of e.files) {
          void vscode.workspace.openTextDocument(f.newUri).then(
            (doc) => {
              if (LintScheduler.isCheckable(doc)) {
                void this.lint(doc);
              }
            },
            () => undefined
          );
        }
      }),
      // 文件删除：诊断与序号清掉
      vscode.workspace.onDidDeleteFiles((e) => {
        for (const f of e.files) {
          this.controller.delete(f);
          this.seqByUri.delete(f.toString());
        }
      })
    );

    // 激活时补检：窗口恢复的文档不会触发 onDidOpen（事件先于激活完成），
    // 不补检的话红线要等第一次保存才出现 —— 这是本轮修掉的真缺口
    for (const doc of vscode.workspace.textDocuments) {
      if (LintScheduler.isCheckable(doc)) {
        void this.lint(doc);
      }
    }
  }

  private static isCheckable(doc: vscode.TextDocument): boolean {
    return doc.uri.scheme === 'file' && doc.languageId === 'verilog' && /\.v$/i.test(doc.fileName);
  }

  /** 手动触发入口（命令/事件共用同一管道）；source=disk 用原文件，buffer 用缓冲副本 */
  async lint(doc: vscode.TextDocument, source: 'disk' | 'buffer' = 'disk'): Promise<void> {
    if (!LintScheduler.isCheckable(doc)) {
      return;
    }
    const key = doc.uri.toString();
    const seq = (this.seqByUri.get(key) ?? 0) + 1;
    this.seqByUri.set(key, seq);

    const state = await this.service.probe();
    if (seq !== this.seqByUri.get(key)) {
      return; // 期间又发起了新检查
    }
    if (state.disabled || !state.presence?.found || !state.presence.exePath) {
      this.controller.clearAll();
      this.out.appendLine('[lint] 工具链不可用，已清空全部诊断');
      return;
    }

    const cfg = vscode.workspace.getConfiguration();
    const timeoutMs = cfg.get<number>('verikit.check.timeout', xvlogAdapter.defaultTimeoutMs);

    this.out.appendLine(`[lint] seq=${seq} start ${doc.fileName}（${source}）`);
    // buffer 模式：未保存内容写临时副本（保留原文件名），用完即删
    const copy =
      source === 'buffer' ? await writeBufferCopy(doc.fileName, doc.getText()) : undefined;
    try {
      const target = copy ? copy.file : doc.fileName;
      const r = await lintFileRaw(xvlogAdapter, state.presence.exePath, target, {
        timeoutMs,
      });

      // 过期检查必须在 await 之后：期间用户可能又保存了一次
      if (seq !== this.seqByUri.get(key)) {
        this.out.appendLine(`[lint] seq=${seq} 结果已过期，丢弃`);
        return;
      }

      const parsed = parseXvlogOutput(`${r.stdout}\n${r.stderr}`);
      this.out.appendLine(
        `[lint] exit=${r.code} elapsed=${r.elapsedMs} ms → 诊断 ${parsed.items.length} 条` +
          `（忽略 INFO ${parsed.dropped.info}、未识别 ${parsed.dropped.other}）`
      );

      // 解析器自检哨兵：有未识别行且有错误退出码时，说明格式可能变了
      if (parsed.items.length === 0 && parsed.dropped.other > 0 && r.code !== 0) {
        this.out.appendLine(
          '[lint] ⚠ 有 ERROR 退出码但未解析出诊断 —— 解析器可能已退化，请执行「VeriKit: 导出诊断 JSON」取证'
        );
      }

      this.controller.setFor(doc.uri, doc, parsed.items, r.timedOut);
    } finally {
      await copy?.dispose();
    }
  }

  /** 每文档防抖器（惰性创建；保存/关闭时取消） */
  private debouncerFor(key: string): Debouncer {
    let d = this.debouncers.get(key);
    if (!d) {
      d = new Debouncer(1000, () => undefined);
      this.debouncers.set(key, d);
    }
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const d of this.debouncers.values()) {
      d.dispose();
    }
    this.debouncers.clear();
  }
}
