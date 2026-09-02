import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { AlipayParser } from '../../imports/parsers/alipay.parser';
import { WechatParser } from '../../imports/parsers/wechat.parser';
import { CcbSavingParser } from '../../imports/parsers/ccb-saving.parser';
import { CcbCreditParser } from '../../imports/parsers/ccb-credit.parser';
import { ParserRegistry } from '../../imports/parsers/parser.registry';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ImportsController],
  providers: [ImportsService, AlipayParser, WechatParser, CcbSavingParser, CcbCreditParser, 
    ParserRegistry],
  exports: [ImportsService],
})
export class ImportsModule {}