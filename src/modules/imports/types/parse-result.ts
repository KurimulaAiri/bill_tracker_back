import { NormalizedBill } from './normalized-bill';

export interface ParseResult {
  source: string;
  fileName: string;
  total: number;
  bills: NormalizedBill[];
  skipped: { row: number; reason: string }[];
  accountHint?: string; // 文件级账户提示（建行活期卡号等）
}