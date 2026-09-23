-- 补齐迁移：schema.prisma 自 20260903180000 之后累计的改动从未生成迁移文件，
-- 导致线上 prisma migrate deploy 一直输出 "No pending migrations to apply"，
-- 数据库结构停留在旧版本（典型症状：bill_category.aliases 列不存在，/api/stats/category 报 500）。
--
-- 本迁移由 `prisma migrate diff --from-url <线上库> --to-schema-datamodel prisma/schema.prisma`
-- 生成的差异 SQL 整理而来，仅保留「补齐」部分：
--   * 不 DROP 旧的无前缀表（user/account/bill/category/importbatch/importfailure），
--     它们是 20260902160000_init 的遗留物，是否有存量数据需人工确认后再处理。

-- DropIndex
-- 账户表唯一键由 (userId, name) 改为 (userId, parentId, name)：
-- 旧唯一键不删除会导致同一用户下不同父账户无法存在同名子账户（如「微信/零钱」与「支付宝/零钱」冲突）
DROP INDEX `bill_account_userId_name_key` ON `bill_account`;

-- AlterTable
-- 账户分层：父账户 ID（NULL 为顶层账户）
ALTER TABLE `bill_account` ADD COLUMN `parentId` BIGINT NULL;

-- AlterTable
-- 账单表新增导入溯源字段：所属批次 / 所属批次组 / 批次内来源文件名
ALTER TABLE `bill_bill` ADD COLUMN `batchFileName` VARCHAR(200) NULL,
    ADD COLUMN `importBatchId` BIGINT NULL,
    ADD COLUMN `importGroupId` BIGINT NULL;

-- AlterTable
-- 分类表新增来源分类映射（[{source, value}]），导入时命中即归类
ALTER TABLE `bill_category` ADD COLUMN `aliases` JSON NULL;

-- AlterTable
-- 导入批次表新增所属批次组与文件头元信息
ALTER TABLE `bill_import_batch` ADD COLUMN `importGroupId` BIGINT NULL,
    ADD COLUMN `meta` JSON NULL;

-- CreateTable
-- 导入批次组：一次批量导入（多文件）的会话
CREATE TABLE `bill_import_group` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `groupKey` VARCHAR(50) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bill_import_group_userId_idx`(`userId`),
    UNIQUE INDEX `bill_import_group_userId_groupKey_key`(`userId`, `groupKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
-- 字段映射配置：用户自定义各来源账单文件的列名映射
CREATE TABLE `bill_field_mapping` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` BIGINT NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `field` VARCHAR(50) NOT NULL,
    `columnName` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `bill_field_mapping_userId_idx`(`userId`),
    UNIQUE INDEX `bill_field_mapping_userId_source_field_key`(`userId`, `source`, `field`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `bill_account_parentId_idx` ON `bill_account`(`parentId`);

-- CreateIndex
CREATE UNIQUE INDEX `bill_account_userId_parentId_name_key` ON `bill_account`(`userId`, `parentId`, `name`);

-- CreateIndex
CREATE INDEX `bill_bill_userId_importBatchId_idx` ON `bill_bill`(`userId`, `importBatchId`);

-- CreateIndex
CREATE INDEX `bill_import_batch_importGroupId_idx` ON `bill_import_batch`(`importGroupId`);

-- AddForeignKey
ALTER TABLE `bill_account` ADD CONSTRAINT `bill_account_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `bill_account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_import_group` ADD CONSTRAINT `bill_import_group_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bill_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_import_batch` ADD CONSTRAINT `bill_import_batch_importGroupId_fkey` FOREIGN KEY (`importGroupId`) REFERENCES `bill_import_group`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_field_mapping` ADD CONSTRAINT `bill_field_mapping_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bill_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
