output "domain_name" { value = aws_api_gateway_domain_name.this.domain_name }
output "regional_domain_name" { value = aws_api_gateway_domain_name.this.regional_domain_name }
output "certificate_arn" { value = aws_acm_certificate.this.arn }
