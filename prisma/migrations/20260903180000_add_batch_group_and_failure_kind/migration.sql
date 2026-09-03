-- AlterTable
-- 导入批次表新增批量会话标识 groupId（同一次批量导入的多文件共用），用于前端合并展示
ALTER TABLE `bill_import_batch`
  ADD COLUMN `groupId` VARCHAR(50) NULL,
  ADD INDEX `bill_import_batch_userId_groupId_idx` (`userId`, `groupId`);

-- 导入明细表新增类型字段 kind：fail=失败 skip=跳过
ALTER TABLE `bill_import_failure`
  ADD COLUMN `kind` VARCHAR(10) NOT NULL DEFAULT 'fail';