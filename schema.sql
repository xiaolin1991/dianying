-- ============================================================
-- 晓林影视 XIAOLIN-TV — Cloudflare D1 数据库初始化表结构
-- 数据库名: dianying
-- 绑定名称: DB (或 dianying)
--
-- 执行方法（二选一）:
-- 1. Wrangler CLI 执行:
--    npx wrangler d1 execute dianying --file=./schema.sql
--
-- 2. Cloudflare 控制台直接执行:
--    打开 dash.cloudflare.com -> 存储与数据库 (Storage & Databases)
--    -> D1 -> dianying -> 控制台 (Console) -> 粘贴本文件内容执行
--
-- 提示: Worker 后端也内置了自动建表机制 (Zero-Config)，即使未手动执行，首次读写也会自动创建。
-- ============================================================

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 加速基于更新时间或范围的排序查询
CREATE INDEX IF NOT EXISTS idx_kv_store_updated ON kv_store(updated_at DESC);
