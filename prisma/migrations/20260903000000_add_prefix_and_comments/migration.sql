-- CreateTable
CREATE TABLE `bill_user` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户ID（主键，自增）',
    `username` VARCHAR(50) NOT NULL COMMENT '用户名：登录账号，全局唯一',
    `passwordHash` VARCHAR(100) NOT NULL COMMENT '密码哈希：bcrypt 加密后的密码，不存明文',
    `email` VARCHAR(100) NULL COMMENT '邮箱：可选，全局唯一',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间：注册时间，自动生成',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '更新时间：最后修改时间，自动维护',

    UNIQUE INDEX `bill_user_username_key`(`username`),
    UNIQUE INDEX `bill_user_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '用户表：系统的登录账号，一个用户可以拥有多个账户、分类、账单与导入批次';

-- CreateTable
CREATE TABLE `bill_account` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户ID（主键，自增）',
    `userId` BIGINT NOT NULL COMMENT '所属用户ID：关联 bill_user.id',
    `name` VARCHAR(50) NOT NULL COMMENT '账户名称：如 支付宝/建行储蓄卡，同一用户下不可重名',
    `type` VARCHAR(20) NOT NULL COMMENT '账户类型：cash=现金 bank=银行卡 alipay=支付宝 wechat=微信 credit=信用卡 other=其他',
    `balance` BIGINT NOT NULL DEFAULT 0 COMMENT '账户余额：以「分」为单位存储，默认 0',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间：注册时间，自动生成',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '更新时间：最后修改时间，自动维护',

    INDEX `bill_account_userId_idx`(`userId`),
    UNIQUE INDEX `bill_account_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '账户表：用户的资金账户（支付宝/微信/建行储蓄/建行信用卡等），账单可归属到账户';

-- CreateTable
CREATE TABLE `bill_category` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户ID（主键，自增）',
    `userId` BIGINT NULL COMMENT '所属用户ID：关联 bill_user.id',
    `name` VARCHAR(50) NOT NULL COMMENT '账户名称：如 支付宝/建行储蓄卡，同一用户下不可重名',
    `type` VARCHAR(10) NOT NULL COMMENT '账户类型：cash=现金 bank=银行卡 alipay=支付宝 wechat=微信 credit=信用卡 other=其他',
    `icon` VARCHAR(50) NULL COMMENT '图标标识：前端展示用 key',
    `sort` INTEGER NOT NULL DEFAULT 0 COMMENT '排序权重：数值越小越靠前',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间：注册时间，自动生成',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '更新时间：最后修改时间，自动维护',

    INDEX `bill_category_userId_idx`(`userId`),
    UNIQUE INDEX `bill_category_userId_name_type_key`(`userId`, `name`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '分类表：账单收支分类；userId 为 NULL 表示系统预置分类（所有用户共享）';

-- CreateTable
CREATE TABLE `bill_bill` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户ID（主键，自增）',
    `userId` BIGINT NOT NULL COMMENT '所属用户ID：关联 bill_user.id',
    `accountId` BIGINT NULL COMMENT '所属账户ID：可为空，关联 bill_account.id',
    `categoryId` BIGINT NULL COMMENT '分类ID：可为空，关联 bill_category.id',
    `amount` BIGINT NOT NULL COMMENT '金额（分）：收入为正、支出为负，精度到分',
    `billType` VARCHAR(10) NOT NULL COMMENT '收支类型：income=收入 expense=支出 neutral=中性',
    `note` VARCHAR(500) NULL COMMENT '备注：用户可修改的明细说明，最长 500 字',
    `source` VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT '数据来源：manual=手工 alipay=支付宝 wechat=微信 ccb_saving=建行活期 ccb_credit=建行信用卡',
    `externalId` VARCHAR(100) NULL COMMENT '来源交易单号：用于去重，同一用户同一来源下唯一',
    `rawData` JSON NULL COMMENT '原始数据：源文件原始记录（JSON），便于追溯',
    `neutral` BOOLEAN NOT NULL DEFAULT false COMMENT '是否中性交易：true 表示不计入收支统计',
    `billDate` DATETIME(3) NOT NULL COMMENT '交易时间：交易实际发生的时间',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间：注册时间，自动生成',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '更新时间：最后修改时间，自动维护',

    INDEX `bill_bill_userId_billDate_idx`(`userId`, `billDate`),
    INDEX `bill_bill_userId_categoryId_idx`(`userId`, `categoryId`),
    INDEX `bill_bill_userId_source_idx`(`userId`, `source`),
    UNIQUE INDEX `bill_bill_userId_source_externalId_key`(`userId`, `source`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '账单表：核心流水表，手工记账与批量导入的数据统一存储于此';

-- CreateTable
CREATE TABLE `bill_import_batch` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户ID（主键，自增）',
    `userId` BIGINT NOT NULL COMMENT '所属用户ID：关联 bill_user.id',
    `source` VARCHAR(20) NOT NULL COMMENT '数据来源：manual=手工 alipay=支付宝 wechat=微信 ccb_saving=建行活期 ccb_credit=建行信用卡',
    `fileName` VARCHAR(200) NOT NULL COMMENT '导入文件名：原始上传的文件名',
    `total` INTEGER NOT NULL DEFAULT 0 COMMENT '文件总笔数：解析出的记录总数',
    `success` INTEGER NOT NULL DEFAULT 0 COMMENT '成功入库笔数',
    `skipped` INTEGER NOT NULL DEFAULT 0 COMMENT '跳过笔数：重复单号等被跳过',
    `failed` INTEGER NOT NULL DEFAULT 0 COMMENT '失败笔数：金额无效等原因入库失败',
    `status` VARCHAR(20) NOT NULL DEFAULT 'done' COMMENT '批次状态：done=已完成',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间：注册时间，自动生成',

    INDEX `bill_import_batch_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '导入批次表：每次账单文件导入产生一个批次，记录整体成功/失败/跳过统计';

-- CreateTable
CREATE TABLE `bill_import_failure` (
    `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '用户ID（主键，自增）',
    `batchId` BIGINT NOT NULL COMMENT '所属批次ID：关联 bill_import_batch.id',
    `rowNo` INTEGER NOT NULL COMMENT '源文件行号：原始文件中的行号（1 起始）',
    `reason` VARCHAR(200) NOT NULL COMMENT '失败原因：如 金额无效/交易日期无效',
    `raw` JSON NULL COMMENT '原始数据：该行原始内容（JSON），便于人工核对',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间：注册时间，自动生成',

    INDEX `bill_import_failure_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '导入失败明细表：记录批次中每条失败记录的行号、原因与原始数据';

-- AddForeignKey
ALTER TABLE `bill_account` ADD CONSTRAINT `bill_account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bill_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_category` ADD CONSTRAINT `bill_category_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bill_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_bill` ADD CONSTRAINT `bill_bill_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bill_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_bill` ADD CONSTRAINT `bill_bill_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `bill_account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_bill` ADD CONSTRAINT `bill_bill_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `bill_category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_import_batch` ADD CONSTRAINT `bill_import_batch_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `bill_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_import_failure` ADD CONSTRAINT `bill_import_failure_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `bill_import_batch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

