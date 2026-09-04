import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { BaseParser } from './base.parser';
import { NormalizedBill } from '../../modules/imports/types/normalized-bill';
import { ParseResult } from '../../modules/imports/types/parse-result';

// 支付宝交易明细 CSV（GBK 编码）
// 表头(索引24): 交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注
@Injectable()
export class AlipayParser extends BaseParser {
  private readonly logger = new Logger(AlipayParser.name);

  detect(fileName: string): boolean {
    return /支付宝|交易明细/i.test(fileName) || fileName.toLowerCase().endsWith('.csv');
  }

  async parse(filePath: string): Promise<ParseResult> {
    const buf = fs.readFileSync(filePath);
    const text = iconv.decode(buf, 'gbk');
    const lines = text.split(/\r?\n/);

    // 定位表头行：包含「交易时间,交易分类,交易对方」
    let headerIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 40); i++) {
      if (lines[i].includes('交易时间') && lines[i].includes('交易分类') && lines[i].includes('收/支')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      throw new Error('无法识别支付宝账单表头（缺少"交易时间,交易分类"列）');
    }

    const header = lines[headerIdx].split(',');
    const idx = (name: string) => header.findIndex((h) => h.trim() === name);

    const cTime = idx('交易时间');
    const cCategory = idx('交易分类');
    const cCounterParty = idx('交易对方');
    const cProduct = idx('商品说明');
    const cFlow = idx('收/支');
    const cAmount = idx('金额');
    const cPayMethod = idx('收/付款方式');
    const cStatus = idx('交易状态');
    const cExternalId = idx('交易订单号');

    const bills: NormalizedBill[] = [];
    const skipped: { row: number; reason: string; raw?: unknown }[] = [];

    for (let r = headerIdx + 1; r < lines.length; r++) {
      const line = lines[r].trim();
      if (!line) continue;
      const cols = line.split(',');
      const get = (i: number) => (i >= 0 ? (cols[i] || '').trim() : '');

      const status = get(cStatus);
      if (status === '交易关闭' || status === '') {
        skipped.push({ row: r + 1, reason: status ? `交易状态:${status}，不计入账` : '空行跳过', raw: cols });
        continue;
      }

      const flow = get(cFlow);
      const amountRaw = get(cAmount);
      const amountSign = flow === '支出' ? -1 : 1;
      const amountCents = this.toCents(amountRaw) * BigInt(amountSign);

      // 收/支三值：收入/支出/不计收支（基金买卖等按平台原始口径记为不计收支）
      const { billType, neutral } = this.resolveBillType(flow);

      const payMethod = get(cPayMethod);
      const product = get(cProduct);
      const counterParty = get(cCounterParty);

      bills.push({
        time: get(cTime),
        amountCents,
        billType,
        neutral,
        sourceCategory: get(cCategory) || undefined,
        remark: product || undefined,
        accountHint: payMethod || undefined,
        counterParty: counterParty || undefined,
        externalId: get(cExternalId) || undefined,
        rawData: cols,
      });
    }

    this.logger.log(`支付宝解析完成: ${bills.length} 笔, 跳过 ${skipped.length} 笔`);
    return { source: 'alipay', fileName: filePath.split(/[\\/]/).pop() || '', total: bills.length, bills, skipped };
  }
}