locals {
  endpoint = local.is_aurora ? aws_rds_cluster.this[0].endpoint : aws_db_instance.this[0].address
  db_arn   = local.is_aurora ? aws_rds_cluster.this[0].arn : aws_db_instance.this[0].arn
  db_id    = local.is_aurora ? aws_rds_cluster.this[0].cluster_identifier : aws_db_instance.this[0].identifier
}

output "endpoint" { value = local.endpoint }
output "port" { value = 5432 }
output "security_group_id" { value = aws_security_group.db.id }
output "kms_key_arn" { value = aws_kms_key.db.arn }
output "db_identifier" { value = local.db_id }
output "db_arn" { value = local.db_arn }
