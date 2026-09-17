terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.60" }
  }
}

locals {
  is_aurora = var.engine == "aurora"
  is_rds    = var.engine == "rds"
}

resource "aws_kms_key" "db" {
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
  kms_key_id                          = aws_kms_key.db.arn
  db_name                             = var.database_name
  username                            = var.username
  password                            = var.password
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.db.id]
  iam_database_authentication_enabled = true
  backup_retention_period             = var.backup_retention_days
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${var.name}-final" : null
  performance_insights_enabled        = true
  auto_minor_version_upgrade          = true
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
  vpc_security_group_ids              = [aws_security_group.db.id]
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.db.arn
  iam_database_authentication_enabled = true
  backup_retention_period             = var.backup_retention_days
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${var.name}-final" : null
  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_acu
    max_capacity = var.aurora_max_acu
  }
  tags = var.tags
}

resource "aws_rds_cluster_instance" "this" {
  count                = local.is_aurora ? 1 : 0
  identifier           = "${var.name}-1"
  cluster_identifier   = aws_rds_cluster.this[0].id
  instance_class       = "db.serverless"
  engine               = aws_rds_cluster.this[0].engine
  engine_version       = aws_rds_cluster.this[0].engine_version
  db_subnet_group_name = aws_db_subnet_group.this.name
}
