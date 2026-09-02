import { IsString, IsOptional, IsIn, IsNumber } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['cash', 'bank', 'alipay', 'wechat', 'credit', 'other'])
  type?: string = 'other';

  @IsOptional()
  @IsNumber()
  balance?: number = 0;
}