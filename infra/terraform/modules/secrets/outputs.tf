output "secret_arn" { value = aws_secretsmanager_secret.db.arn }
output "password" {
  value     = random_password.db.result
  sensitive = true
}
output "username" { value = var.username }
