output "api_invoke_url" { value = module.api_gateway.invoke_url }
output "api_key_id" {
  value       = module.api_gateway.api_key_id
  description = "Read the key value with: aws apigateway get-api-key --api-key <id> --include-value"
}
output "db_endpoint" { value = local.db_host }
output "custom_domain" {
  value = var.custom_domain_enabled ? module.custom_domain[0].domain_name : null
}
output "platform_prefix" {
  value       = "/${var.platform_name}/${var.env}"
  description = "Where this stack read the platform interface from"
}
