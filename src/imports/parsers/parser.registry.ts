import { Injectable } from '@nestjs/common';
import { BillParser } from './base.parser';
import { AlipayParser } from './alipay.parser';
import { WechatParser } from './wechat.parser';
import { CcbSavingParser } from './ccb-saving.parser';
import { CcbCreditParser } from './ccb-credit.parser';

@Injectable()
export class ParserRegistry {
  constructor(
    private readonly alipay: AlipayParser,
    private readonly wechat: WechatParser,
    private readonly ccbSaving: CcbSavingParser,
    private readonly ccbCredit: CcbCreditParser,
  ) {}

  getParsers(): BillParser[] {
    return [this.alipay, this.wechat, this.ccbSaving, this.ccbCredit];
  }

  find(fileName: string): BillParser | undefined {
    return this.getParsers().find((p) => p.detect(fileName));
  }
}