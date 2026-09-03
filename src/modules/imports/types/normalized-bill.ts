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
  counterParty?: string; // 交易对方名称
  counterpartyAccount?: string; // 对方账号（支付宝"对方账号"、建行"对方账号与户名"账号部分）
  merchantNo?: string; // 商家/商户单号（支付宝"商家订单号"、微信"商户单号"）
  payMethod?: string; // 收/付款方式（支付宝"收/付款方式"、微信"支付方式"）
  cardNo?: string; // 卡号/账号（建行）
  status?: string; // 交易状态（支付宝"交易状态"、微信"当前状态"）
  extraJson?: Record<string, unknown>; // 附加列（键=源列名，值=原始单元格）
  rawData?: unknown; // 原始行
}