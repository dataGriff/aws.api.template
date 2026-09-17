-- Todos for a tenant, newest first.
-- Run with: task db:query -- todos_by_tenant   (override tenant: TENANT=acme task db:query -- todos_by_tenant)
SELECT todo_id, user_sub, title, status, due_date, created_at
FROM todos
WHERE tenant_id = :'tenant'
ORDER BY created_at DESC
LIMIT 50;
