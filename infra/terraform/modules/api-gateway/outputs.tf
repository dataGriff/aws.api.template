output "rest_api_id" { value = aws_api_gateway_rest_api.this.id }
output "stage_name" { value = aws_api_gateway_stage.this.stage_name }
output "stage_arn" { value = aws_api_gateway_stage.this.arn }
output "execution_arn" { value = aws_api_gateway_rest_api.this.execution_arn }
output "invoke_url" { value = aws_api_gateway_stage.this.invoke_url }
output "api_key_id" { value = aws_api_gateway_api_key.default.id }
