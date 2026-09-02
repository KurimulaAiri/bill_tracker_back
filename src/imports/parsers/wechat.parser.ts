import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { BaseParser } from './base.parser';
import { NormalizedBill } from '../../modules/imports/types/normalized-bill';
import { ParseResult } from '../../modules/imports/types/parse-result';

// 微信支付账单 XLSX
// 表头(索引17): 交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
@Injectable()
export class WechatParser extends BaseParser {
  private readonly logger = new Logger(WechatParser.name);

  detect(fileName: string): boolean {
    return /微信/.test(fileName) || /WeChat/i.test(fileName);
  }

  async parse(filePath: string): Promise<ParseResult> {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    // 定位表头行：包含「交易时间」「交易类型」「收/支」
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i];
      const joined = String(row.join(','));
      if (joined.includes('交易时间') && joined.includes('交易类型') && joined.includes('收/支')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) throw new Error('无法识别微信账单表头（缺少"交易时间,交易类型,收/支"列）');

    const header = rows[headerIdx] || [];
    const idx = (name: string) => header.findIndex((h) => String(h).trim() === name);

    const cTime = idx('交易时间');
    const cType = idx('交易类型');
    const cCounterParty = idx('交易对方');
    const cProduct = idx('商品');
    const cFlow = idx('收/支');
    const cAmount = idx('金额(元)');
    const cPayMethod = idx('支付方式');
    const cStatus = idx('当前状态');
    const cExternalId = idx('交易单号');
    const cRemark = idx('备注');

    const bills: NormalizedBill[] = [];
    const skipped: { row: number; reason: string }[] = [];

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((v) => v === '' || v === null || v === undefined)) continue;
      const get = (i: number) => (i >= 0 && row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '');

      const flow = get(cFlow);
      const amountRaw = get(cAmount);
      const amountSign = flow === '支出' ? -1 : 1;
      const amountCents = this.toCents(amountRaw) * BigInt(amountSign);

      const { billType, neutral } = this.resolveBillType(flow);

      // Excel 时间: 可能为字符串或日期对象/序列号
      const rawTime = row[cTime];
      let time: string | Date = String(rawTime);
      if (rawTime instanceof Date) {
        time = rawTime;
      } else if (typeof rawTime === 'number') {
        time = this.excelDateToIso(rawTime);
      }

      const remark = get(cRemark) || get(cProduct);

      bills.push({
        time,
        amountCents,
        billType,
        neutral,
        sourceCategory: get(cType) || undefined,
        remark: remark || undefined,
        accountHint: get(cPayMethod) || undefined,
        counterParty: get(cCounterParty) || undefined,
        externalId: get(cExternalId) || undefined,
        rawData: row,
      });
    }

    this.logger.log(`微信解析完成: ${bills.length} 笔, 跳过 ${skipped.length} 笔`);
    return { source: 'wechat', fileName: filePath.split(/[\\/]/).pop() || '', total: bills.length, bills, skipped };
  }

  protected excelDateToIso(serial: number): string {
    // Excel 序列号 -> ISO 日期时间 (UTC+8)
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms + 8 * 3600 * 1000);
    return d.toISOString().replace('Z', '+08:00');
  }
}