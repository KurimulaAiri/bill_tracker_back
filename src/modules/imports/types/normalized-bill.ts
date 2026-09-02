// 标准化账单中间结构：四种来源解析后的统一输出
export interface NormalizedBill {
  id?: string; // 前端预览用
  time: Date | string; // 交易时间
  amountCents: bigint; // 分，收入为正、支出为负
  billType: 'income' | 'expense' | 'neutral'; // 收支类型
  neutral: boolean; // 中性交易/不计收支
  category?: string; // 系统分类名（映射后）
  sourceCategory?: string; // 来源原始分类
  remark?: string; // 备注
  accountHint?: string; // 账户提示（用于自动关联）
  externalId?: string; // 来源交易单号（去重键）
  counterParty?: string; // 交易对方
  rawData?: unknown; // 原始行
}