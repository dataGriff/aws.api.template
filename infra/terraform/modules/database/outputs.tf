locals {
  endpoint = local.is_aurora ? aws_rds_cluster.this[0].endpoint : aws_db_instance.this[0].address
  db_arn   = local.is_aurora ? aws_rds_cluster.this[0].arn : aws_db_instance.this[0].arn
  db_id    = local.is_aurora ? aws_rds_cluster.this[0].cluster_identifier : aws_db_instance.this[0].identifier
}

output "endpoint" { value = local.endpoint }
output "port" { value = 5432 }
output "security_group_id" { value = aws_security_group.db.id }
output "kms_key_arn" { value = local.kms_key_arn }
output "db_identifier" { value = local.db_id }
output "db_arn" { value = local.db_arn }
# Facts about the deployed shape (asserted by `terraform test`, useful in plan output).
output "multi_az" { value = local.is_rds ? aws_db_instance.this[0].multi_az : var.multi_az }
output "deletion_protection" { value = var.deletion_protection }
output "performance_insights_enabled" {
  value = local.is_rds ? aws_db_instance.this[0].performance_insights_enabled : true
}
output "force_ssl_parameters" {
  value = local.is_rds ? [for p in aws_db_parameter_group.this[0].parameter : p.name] : [for p in aws_rds_cluster_parameter_group.this[0].parameter : p.name]
}
