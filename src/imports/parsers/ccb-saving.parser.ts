import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { BaseParser } from './base.parser';
import { NormalizedBill } from '../../modules/imports/types/normalized-bill';
import { ParseResult } from '../../modules/imports/types/parse-result';

// 建行活期账户交易明细 XLS
// 表头(索引4): 序号,摘要,币别,钞汇,交易日期,交易金额,账户余额,交易地点/附言,对方账号与户名
@Injectable()
export class CcbSavingParser extends BaseParser {
  private readonly logger = new Logger(CcbSavingParser.name);

  detect(fileName: string): boolean {
    return /hqmx/i.test(fileName) || (/(银行|活期)/.test(fileName) && fileName.toLowerCase().endsWith('.xls'));
  }

  async parse(filePath: string): Promise<ParseResult> {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    // 表头行：包含「序号」「摘要」「交易日期」「交易金额」
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const joined = String(rows[i].join(','));
      if (joined.includes('摘要') && joined.includes('交易金额') && joined.includes('交易日期')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) throw new Error('无法识别建行活期明细表头（缺少"摘要,交易日期,交易金额"列）');

    const header = rows[headerIdx] || [];
    const idx = (name: string) => header.findIndex((h) => String(h).trim() === name);

    const cSummary = idx('摘要');
    const cDate = idx('交易日期');
    const cAmount = idx('交易金额');
    const cCounterParty = idx('对方账号与户名');
    const cBalance = idx('账户余额');
    const cSeq = idx('序号');

    // 从头部找卡号/账号
    let accountHint: string | undefined;
    for (let i = 0; i < headerIdx; i++) {
      const joined = String(rows[i].join(','));
      const m = joined.match(/卡号\/账号[:：]?\s*(\d+)/);
      if (m) accountHint = m[1];
    }

    const bills: NormalizedBill[] = [];
    const skipped: { row: number; reason: string }[] = [];

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((v) => v === '' || v === null || v === undefined)) continue;
      const get = (i: number) => (i >= 0 && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '');

      const seq = get(cSeq);
      if (!seq) {
        skipped.push({ row: r + 1, reason: '序号为空，跳过行尾' });
        continue;
      }

      const amountRaw = get(cAmount);
      const amountCents = this.toCents(amountRaw); // 金额本身带符号
      const { billType, neutral } = this.resolveBillType(undefined, amountCents);

      // 对方账号与户名: "6217001930066356917/赵杰" -> 户名在 / 后
      const cpRaw = get(cCounterParty);
      let counterParty: string | undefined;
      if (cpRaw && cpRaw !== '/') {
        const parts = cpRaw.split('/');
        counterParty = (parts[parts.length - 1] || '').replace(/\*\*\*/g, '') || undefined;
      }

      bills.push({
        time: this.toDate(get(cDate)),
        amountCents,
        billType,
        neutral,
        sourceCategory: get(cSummary) || undefined,
        remark: get(cSummary) || undefined,
        counterParty: counterParty || undefined,
        externalId: `${get(cDate)}-${seq}`,
        rawData: row,
      });
    }

    this.logger.log(`建行活期解析完成: ${bills.length} 笔, 跳过 ${skipped.length} 笔, 账户: ${accountHint || '-'}`);
    return {
      source: 'ccb_saving',
      fileName: filePath.split(/[\\/]/).pop() || '',
      total: bills.length,
      bills,
      skipped,
      accountHint,
    };
  }

  // "20260803" -> ISO 日期
  protected toDate(yyyymmdd: string): string {
    const s = String(yyyymmdd).trim();
    if (!s || s === '/') return new Date().toISOString();
    if (s.includes('-') || s.includes('/')) {
      const d = new Date(s);
      return d.toISOString();
    }
    if (/^\d{8}$/.test(s)) {
      const y = s.slice(0, 4);
      const m = s.slice(4, 6);
      const d = s.slice(6, 8);
      return `${y}-${m}-${d}T12:00:00+08:00`;
    }
    return new Date().toISOString();
  }
}