output "api_invoke_url" { value = module.api_gateway.invoke_url }
output "api_key_id" {
  value       = module.api_gateway.api_key_id
  description = "Read the key value with: aws apigateway get-api-key --api-key <id> --include-value"
}
output "cognito_user_pool_id" { value = module.cognito.user_pool_id }
output "cognito_app_client_id" { value = module.cognito.app_client_id }
output "cognito_test_client_id" { value = module.cognito.test_client_id }
output "cognito_issuer" { value = module.cognito.issuer }
output "db_endpoint" { value = local.db_host }
output "alarm_topic_arn" { value = module.observability.alarm_topic_arn }
output "egress_static_ip" { value = module.network.egress_ip }
output "ingress_static_ips" {
  value = var.enable_ingress_static_ip ? module.ingress_static_ip[0].static_ips : null
}
output "custom_domain" {
  value = var.custom_domain_enabled ? module.custom_dns[0].domain_name : null
}
