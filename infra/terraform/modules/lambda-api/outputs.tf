output "function_name" { value = aws_lambda_function.api.function_name }
output "function_arn" { value = aws_lambda_function.api.arn }
output "alias_arn" { value = aws_lambda_alias.live.arn }
output "invoke_arn" { value = aws_lambda_alias.live.invoke_arn }
output "log_group_name" { value = aws_cloudwatch_log_group.lambda.name }
