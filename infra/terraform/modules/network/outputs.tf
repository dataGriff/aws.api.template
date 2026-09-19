output "vpc_id" { value = aws_vpc.this.id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "vpc_cidr" { value = aws_vpc.this.cidr_block }
output "egress_ip" {
  value       = var.enable_egress_static_ip ? aws_eip.nat[0].public_ip : null
  description = "Stable egress IP when opted in"
}
output "dynamodb_prefix_list_id" {
  value       = aws_vpc_endpoint.dynamodb.prefix_list_id
  description = "Managed prefix list of the DynamoDB gateway endpoint (for egress rules)"
}
output "nat_enabled" { value = local.enable_nat }
