-- 0000_skinny_apocalypse.down.sql
-- 迁移 0000_skinny_apocalypse（首迁：8 表 + 索引 + 约束）的人工回滚脚本（FR-004b / AR1-012）。
--
-- 使用方式（人工执行，由 DBA 操作）：
--   psql "$DATABASE_URL" -f app/lib/db/migrations/0000_skinny_apocalypse.down.sql
--
-- 说明：
-- 1. 本文件不纳入 drizzle-kit migrate 自动执行（单向人工回滚，up 可重复执行、down 不自动重放）；
-- 2. 不自动清理 __drizzle_migrations 版本表（该表由 drizzle 自管、禁止手改）：
--    回滚后如需重放该迁移，由 DBA 手动删除版本表中对应记录后再执行 db:migrate；
-- 3. 全部索引/约束随表删除，无需单独 DROP；
-- 4. DROP 顺序按外键依赖逆序（子表在前），级联删除约束不影响此处顺序。
DROP TABLE IF EXISTS "solve_records";
DROP TABLE IF EXISTS "billing_records";
DROP TABLE IF EXISTS "user_solution_access";
DROP TABLE IF EXISTS "sample_indexes";
DROP TABLE IF EXISTS "primary_indexes";
DROP TABLE IF EXISTS "quota_accounts";
DROP TABLE IF EXISTS "solutions";
DROP TABLE IF EXISTS "users";
