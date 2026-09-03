-- AlterTable
-- 账单表新增来源表单结构化字段：对方信息/商户号/支付方式/卡号/状态/附加列
ALTER TABLE `bill_bill`
  ADD COLUMN `counterParty` VARCHAR(200) NULL,
  ADD COLUMN `counterpartyAccount` VARCHAR(100) NULL,
  ADD COLUMN `merchantNo` VARCHAR(100) NULL,
  ADD COLUMN `payMethod` VARCHAR(100) NULL,
  ADD COLUMN `cardNo` VARCHAR(50) NULL,
  ADD COLUMN `status` VARCHAR(50) NULL,
  ADD COLUMN `extraJson` JSON NULL;