import { IsString, IsOptional, IsIn, IsNumber } from 'class-validator';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['cash', 'bank', 'alipay', 'wechat', 'credit', 'other'])
  type?: string;

  @IsOptional()
  @IsNumber()
  balance?: number;
}
