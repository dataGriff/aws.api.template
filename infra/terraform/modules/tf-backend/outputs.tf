output "state_bucket" { value = aws_s3_bucket.state.id }
output "state_bucket_arn" { value = aws_s3_bucket.state.arn }
output "lock_table" { value = aws_dynamodb_table.lock.id }
output "lock_table_arn" { value = aws_dynamodb_table.lock.arn }
output "kms_key_arn" { value = aws_kms_key.state.arn }
output "kms_alias" { value = aws_kms_alias.state.name }
