-- Cross-tenant summary (admin/ops view): volume and activity per tenant.
SELECT tenant_id,
       count(DISTINCT user_sub) AS users,
       count(*)                 AS todos,
       max(updated_at)          AS last_activity
FROM todos
GROUP BY tenant_id
ORDER BY todos DESC;
