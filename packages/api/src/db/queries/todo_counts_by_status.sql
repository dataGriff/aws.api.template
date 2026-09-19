-- How many todos each user in a tenant has, broken down by status.
SELECT user_sub,
       count(*) FILTER (WHERE status = 'open')        AS open,
       count(*) FILTER (WHERE status = 'in_progress') AS in_progress,
       count(*) FILTER (WHERE status = 'done')        AS done,
       count(*)                                       AS total
FROM todos
WHERE tenant_id = :'tenant'
GROUP BY user_sub
ORDER BY total DESC;
