import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateBillDto {
  @IsNumber()
  amountCents: number;

  @IsOptional()
  @IsString()
  billType?: 'income' | 'expense' | 'neutral';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  accountId?: bigint;

  @IsOptional()
  categoryId?: bigint;

  @IsOptional()
  @IsDateString()
  billDate?: string;
}