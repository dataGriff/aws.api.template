output "endpoint" { value = aws_db_proxy.this.endpoint }
output "proxy_arn" { value = aws_db_proxy.this.arn }

# The prx-* resource id used to scope rds-db:connect IAM permissions.
# ARN shape: arn:aws:rds:<region>:<account>:db-proxy:prx-xxxx
output "proxy_resource_id" { value = element(split(":", aws_db_proxy.this.arn), 6) }
output "role_permissions_boundary" { value = aws_iam_role.proxy.permissions_boundary }
