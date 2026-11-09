/**
 * 缓冲区临时副本（onEdit 检查的输入源）。
 *
 * 背景：xvlog 读磁盘文件，看不见编辑器里未保存的内容。
 * 编辑时检查必须先把缓冲区写成磁盘上的临时副本再编译。
 *
 * 关键约束：**保留原文件名与扩展名** —— xvlog 对文件扩展名敏感，
 * 诊断消息里的文件名也来自它。副本放在独立临时目录，用完即删。
 */

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

export interface BufferCopy {
  /** 临时目录（清理用） */
  dir: string;
  /** 副本绝对路径（喂给 xvlog） */
  file: string;
  /** 删除整个临时目录 */
  dispose: () => Promise<void>;
}

export async function writeBufferCopy(fileName: string, text: string): Promise<BufferCopy> {
  const dir = await mkdtemp(path.join(tmpdir(), 'verikit-edit-'));
  const file = path.join(dir, path.basename(fileName));
  await writeFile(file, text, 'utf8');
  return {
    dir,
    file,
    dispose: (): Promise<void> => rm(dir, { recursive: true, force: true }).catch(() => undefined),
  };
}
