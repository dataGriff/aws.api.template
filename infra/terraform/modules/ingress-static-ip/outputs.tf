output "static_ips" {
  value       = aws_globalaccelerator_accelerator.this.ip_sets[0].ip_addresses
  description = "The two static anycast ingress IPs"
}
output "dns_name" { value = aws_globalaccelerator_accelerator.this.dns_name }
