/**
 * 可复位防抖器（onEdit 触发用）。
 *
 * 语义：连续 schedule 只保留最后一次；cancel 取消挂起；pending 可查询。
 * 独立成类是为了能用 vi.useFakeTimers 精确测试防抖窗口。
 */

export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ms: number,
    private readonly fn: () => void
  ) {}

  schedule(fn?: () => void): void {
    const run = fn ?? this.fn;
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, this.ms);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  dispose(): void {
    this.cancel();
  }
}
