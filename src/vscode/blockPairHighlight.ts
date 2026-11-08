import * as vscode from 'vscode';
import { findBlockPair } from '../core/block/pair';

/**
 * 块配对高亮：光标/选区落在 begin 或 end 上时，只高亮配对的那一对。
 *
 * 为什么不用 DocumentHighlightProvider：那个走 occurrences 机制，只覆盖"光标停靠"；
 * 用户要的是"选中时"也只出现配对的那一对，所以直接用装饰器 + 选区监听自己实现。
 *
 * 注意：VSCode 内置的 Selection Highlight（选中后全文相同词的灰虚影）是编辑器核心行为，
 * 本装饰器无法关掉它。若想只看配对，需要用户设置 `editor.selectionHighlight: false`（全局）。
 */

const LIGHT = { bg: 'rgba(184,134,11,0.30)', border: '#B8860B' };
const DARK = { bg: 'rgba(215,186,125,0.22)', border: '#D7BA7D' };

export class BlockPairHighlight implements vscode.Disposable {
  private deco: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.deco = this.buildDecoration(vscode.window.activeColorTheme.kind);
    this.disposables.push(
      this.deco,
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        const old = this.deco;
        this.deco = this.buildDecoration(theme.kind);
        this.disposables.push(this.deco);
        for (const editor of vscode.window.visibleTextEditors) {
          this.update(editor);
        }
        old.dispose();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        this.update(e.textEditor);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.update(editor);
      })
    );
  }

  private buildDecoration(kind: vscode.ColorThemeKind): vscode.TextEditorDecorationType {
    const c = kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? LIGHT : DARK;
    return vscode.window.createTextEditorDecorationType({
      backgroundColor: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: '2px',
    });
  }

  private update(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      return;
    }
    const clear = (): void => {
      editor.setDecorations(this.deco, []);
    };

    const word = editor.document.getWordRangeAtPosition(editor.selection.active);
    if (!word) {
      clear();
      return;
    }
    const w = editor.document.getText(word);
    if (w !== 'begin' && w !== 'end') {
      clear();
      return;
    }

    let pair;
    try {
      pair = findBlockPair(editor.document.getText(), word.start.line, word.start.character);
    } catch {
      clear();
      return;
    }
    if (!pair) {
      clear();
      return;
    }

    const ranges = [
      new vscode.Range(pair.begin.line, pair.begin.startChar, pair.begin.line, pair.begin.endChar),
      new vscode.Range(pair.end.line, pair.end.startChar, pair.end.line, pair.end.endChar),
    ];
    editor.setDecorations(this.deco, ranges);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
