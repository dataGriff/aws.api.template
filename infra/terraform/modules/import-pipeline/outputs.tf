output "bucket_name" { value = aws_s3_bucket.imports.bucket }
output "bucket_arn" { value = aws_s3_bucket.imports.arn }
output "queue_arn" { value = aws_sqs_queue.imports.arn }
output "dead_letter_queue_name" { value = aws_sqs_queue.dead_letter.name }
output "function_name" { value = aws_lambda_function.ingest.function_name }
# For terraform test: the security posture of the bucket as planned.
output "bucket_sse_algorithm" {
  value = one(aws_s3_bucket_server_side_encryption_configuration.imports.rule).apply_server_side_encryption_by_default[0].sse_algorithm
}
output "bucket_versioning" { value = aws_s3_bucket_versioning.imports.versioning_configuration[0].status }
output "bucket_public_access_blocked" {
  value = alltrue([
    aws_s3_bucket_public_access_block.imports.block_public_acls,
    aws_s3_bucket_public_access_block.imports.block_public_policy,
    aws_s3_bucket_public_access_block.imports.ignore_public_acls,
    aws_s3_bucket_public_access_block.imports.restrict_public_buckets,
  ])
}
output "lifecycle_rule_ids" { value = [for r in aws_s3_bucket_lifecycle_configuration.imports.rule : r.id] }
output "notification_prefixes" { value = [for q in aws_s3_bucket_notification.imports.queue : q.filter_prefix] }
output "max_receive_count" { value = var.max_receive_count }
output "ingest_reserved_concurrency" { value = aws_lambda_function.ingest.reserved_concurrent_executions }
output "ingest_in_vpc" { value = length(aws_lambda_function.ingest.vpc_config) == 1 }
