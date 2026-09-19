output "user_pool_id" { value = aws_cognito_user_pool.this.id }
output "user_pool_arn" { value = aws_cognito_user_pool.this.arn }
output "app_client_id" { value = aws_cognito_user_pool_client.app.id }
output "test_client_id" {
  value = var.enable_test_client ? aws_cognito_user_pool_client.test[0].id : null
}
output "hosted_ui_domain" { value = aws_cognito_user_pool_domain.this.domain }
output "issuer" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}
output "deletion_protection" { value = aws_cognito_user_pool.this.deletion_protection }
output "prevent_user_existence_errors" {
  value = aws_cognito_user_pool_client.app.prevent_user_existence_errors
}
output "test_client_enabled" { value = var.enable_test_client }
