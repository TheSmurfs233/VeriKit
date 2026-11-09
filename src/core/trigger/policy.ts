/**
 * 触发策略（纯函数）。
 *
 * v1 固定 onOpenSave：打开与保存时检查。
 * 为什么不做 onEdit（编辑时触发）：实测单次 xvlog 约 0.8~1.3 s，边打字边跑
 * 就是持续占用 CPU；且 xvlog 读磁盘文件，未保存内容需要先写临时文件。
 * 编辑时检查将作为后续可选配置（verikit.check.onEdit，默认关），走同一管道。
 */

export type TriggerPolicy = 'onOpenSave' | 'none';
export type TriggerEvent = 'open' | 'save' | 'change';

export function shouldTrigger(policy: TriggerPolicy, event: TriggerEvent): boolean {
  if (policy === 'none') {
    return false;
  }
  return event === 'open' || event === 'save';
}

/**
 * change 事件的处置决策：
 *   - contentChanges 为空 = 磁盘回读（外部改动/重载）→ 按磁盘检查（零代价，文件与缓冲一致）
 *   - 用户输入 → 仅在 onEdit 开启时检查缓冲区副本，否则不动
 */
export type ChangeAction = 'disk' | 'buffer' | 'none';

export function resolveChangeAction(onEditEnabled: boolean, hasContentChanges: boolean): ChangeAction {
  if (!hasContentChanges) {
    return 'disk';
  }
  return onEditEnabled ? 'buffer' : 'none';
}
