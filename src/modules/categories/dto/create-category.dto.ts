import { IsString, IsOptional, IsIn, IsNumber } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsIn(['income', 'expense'])
  type?: string = 'expense';

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsNumber()
  sort?: number = 0;

  @IsOptional()
  aliases?: { source: string; value: string }[] | null;
}