import { NormalizedBill } from './normalized-bill';

export interface ParseResult {
  source: string;
  fileName: string;
  total: number;
  bills: NormalizedBill[];
  skipped: { row: number; reason: string; raw?: unknown }[]; // raw 为导致跳过的原始行数据
  accountHint?: string; // 文件级账户提示（建行活期卡号等）
  meta?: Record<string, unknown>; // 文件头元信息（昵称/时间范围/表尾汇总等）
}