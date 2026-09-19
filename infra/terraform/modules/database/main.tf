terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

locals {
  is_aurora = var.engine == "aurora"
  is_rds    = var.engine == "rds"

  kms_key_arn = var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.db[0].arn

  # Parameter-group families follow the major engine version.
  postgres_major = split(".", var.postgres_version)[0]
  aurora_major   = split(".", var.aurora_version)[0]

  # Performance Insights is not supported on the micro/small burstable classes;
  # enabling it there fails the apply, so it follows the instance class.
  performance_insights = !can(regex("\\.(micro|small)$", var.instance_class))
}

resource "aws_kms_key" "db" {
  count                   = var.kms_key_arn == null ? 1 : 0
  description             = "${var.name} database encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.tags
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "db" {
  name_prefix = "${var.name}-db-"
  vpc_id      = var.vpc_id
  description = "Database access"
  ingress {
    description     = "Postgres from clients"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.ingress_security_group_ids
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(var.tags, { Name = "${var.name}-db" })
}

# TLS is enforced by the SERVER, not just requested by clients: a session that
# does not negotiate SSL is rejected. (RDS Proxy's require_tls only covers the
# client->proxy hop.)
resource "aws_db_parameter_group" "this" {
  count       = local.is_rds ? 1 : 0
  name_prefix = "${var.name}-"
  family      = "postgres${local.postgres_major}"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  lifecycle {
    create_before_destroy = true
  }
  tags = var.tags
}

resource "aws_rds_cluster_parameter_group" "this" {
  count       = local.is_aurora ? 1 : 0
  name_prefix = "${var.name}-"
  family      = "aurora-postgresql${local.aurora_major}"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  lifecycle {
    create_before_destroy = true
  }
  tags = var.tags
}

# --- RDS Postgres instance (default) ----------------------------------------
resource "aws_db_instance" "this" {
  count                               = local.is_rds ? 1 : 0
  identifier                          = var.name
  engine                              = "postgres"
  engine_version                      = var.postgres_version
  instance_class                      = var.instance_class
  allocated_storage                   = 20
  max_allocated_storage               = 100
  storage_encrypted                   = true
  kms_key_id                          = local.kms_key_arn
  db_name                             = var.database_name
  username                            = var.username
  password                            = var.password
  db_subnet_group_name                = aws_db_subnet_group.this.name
  parameter_group_name                = aws_db_parameter_group.this[0].name
  vpc_security_group_ids              = [aws_security_group.db.id]
  multi_az                            = var.multi_az
  iam_database_authentication_enabled = true
  backup_retention_period             = var.backup_retention_days
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${var.name}-final" : null
  performance_insights_enabled        = local.performance_insights
  enabled_cloudwatch_logs_exports     = ["postgresql", "upgrade"]
  auto_minor_version_upgrade          = true
  apply_immediately                   = var.apply_immediately
  tags                                = var.tags
}

# --- Aurora Serverless v2 cluster (opt-in via engine=aurora) ----------------
resource "aws_rds_cluster" "this" {
  count                               = local.is_aurora ? 1 : 0
  cluster_identifier                  = var.name
  engine                              = "aurora-postgresql"
  engine_mode                         = "provisioned"
  engine_version                      = var.aurora_version
  database_name                       = var.database_name
  master_username                     = var.username
  master_password                     = var.password
  db_subnet_group_name                = aws_db_subnet_group.this.name
  db_cluster_parameter_group_name     = aws_rds_cluster_parameter_group.this[0].name
  vpc_security_group_ids              = [aws_security_group.db.id]
  storage_encrypted                   = true
  kms_key_id                          = local.kms_key_arn
  iam_database_authentication_enabled = true
  backup_retention_period             = var.backup_retention_days
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${var.name}-final" : null
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  apply_immediately                   = var.apply_immediately
  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_acu
    max_capacity = var.aurora_max_acu
  }
  tags = var.tags
}

# One writer, plus a reader in a second AZ when multi_az is set so the cluster
# can fail over automatically.
resource "aws_rds_cluster_instance" "this" {
  count                = local.is_aurora ? (var.multi_az ? 2 : 1) : 0
  identifier           = "${var.name}-${count.index + 1}"
  cluster_identifier   = aws_rds_cluster.this[0].id
  instance_class       = "db.serverless"
  engine               = aws_rds_cluster.this[0].engine
  engine_version       = aws_rds_cluster.this[0].engine_version
  db_subnet_group_name = aws_db_subnet_group.this.name
  tags                 = var.tags
}
