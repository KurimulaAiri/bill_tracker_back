/* eslint-disable no-console */
// 用 docs/入账示例 中的真实文件验证四个解析器
import * as path from 'path';
import { AlipayParser } from '../src/imports/parsers/alipay.parser';
import { WechatParser } from '../src/imports/parsers/wechat.parser';
import { CcbSavingParser } from '../src/imports/parsers/ccb-saving.parser';
import { CcbCreditParser } from '../src/imports/parsers/ccb-credit.parser';

const DOCS = path.resolve(__dirname, '../../..', 'docs', '入账示例');

async function main() {
  const cases: { name: string; parser: any; file: string; expect?: number }[] = [
    { name: '支付宝 CSV', parser: new AlipayParser(), file: path.join(DOCS, '支付宝交易明细(20260801-20260831).csv'), expect: 112 },
    { name: '微信 XLSX', parser: new WechatParser(), file: path.join(DOCS, '微信支付账单流水文件(20260801-20260831)_20260902121319.xlsx'), expect: 64 },
    { name: '建行活期1', parser: new CcbSavingParser(), file: path.join(DOCS, 'hqmx_20260902133800', 'hqmx_20260902133800.xls') },
    { name: '建行活期2', parser: new CcbSavingParser(), file: path.join(DOCS, 'hqmx_20260902133918', 'hqmx_20260902133918.xls') },
    { name: '建行信用卡 PDF', parser: new CcbCreditParser(), file: path.join(DOCS, 'xykmx_20260902133648', 'xykmx_20260902133648.pdf'), expect: 1 },
  ];

  for (const c of cases) {
    try {
      const r = await c.parser.parse(c.file);
      const checked = c.expect !== undefined ? (r.bills.length === c.expect ? '✓' : `✗(期望 ${c.expect})`) : '✓(数量未断言)';
      console.log(`[${checked}] ${c.name}: 解析 ${r.bills.length} 笔 (跳过 ${r.skipped.length}) 账户提示: ${r.accountHint || '-'}`);
      // 打印前2条示例
      for (const b of r.bills.slice(0, 2)) {
        console.log('    ->', JSON.stringify({ t: b.time, amt: b.amountCents.toString(), type: b.billType, cat: b.sourceCategory, acct: b.accountHint, ext: b.externalId, remark: b.remark }, null, 0));
      }
    } catch (e: any) {
      console.log(`[✗] ${c.name}: ${e.message}`);
    }
  }
}

main().finally(() => process.exit(0));