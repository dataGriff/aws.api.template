-- Overdue todos (past due date, not done) for a tenant.
SELECT todo_id, user_sub, title, due_date, (CURRENT_DATE - due_date) AS days_overdue
FROM todos
WHERE tenant_id = :'tenant'
  AND status <> 'done'
  AND due_date IS NOT NULL
  AND due_date < CURRENT_DATE
ORDER BY due_date ASC;
