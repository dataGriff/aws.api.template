terraform {
  required_version = ">= 1.9"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.60" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

# CSV import pipeline for POST /imports (see api/todo-import.odcs.yaml and
# packages/api/src/import/):
#
#   client --pre-signed POST--> S3 uploads/  --ObjectCreated--> SQS --> ingest Lambda
#                                   |                             |         |
#                             quarantine/  <-- reject (+report) --+   todos (Postgres)
#
# The bucket only ever receives objects through the signed POST policy the API
# mints (key, content type, size range and SSE-KMS key are conditions), and its
# own policy refuses anything unencrypted or over plain HTTP. The ingest is the
# only reader; it validates the whole file against the data contract and either
# creates every row in one transaction or quarantines the file.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  partition   = data.aws_partition.current.partition
  bucket_name = "${var.name}-imports-${local.account_id}"
  function    = "${var.name}-import"
  # Long enough for a full file plus retries; the SQS visibility timeout must
  # exceed the function timeout (AWS recommends 6x).
  timeout_seconds = 120
}

# --- Bucket ---------------------------------------------------------------------
resource "aws_s3_bucket" "imports" {
  #checkov:skip=CKV_AWS_144:Single-region template; uploads are transient (processed then deleted) and quarantine is retained by lifecycle, so cross-region replication adds cost without a recovery benefit
  bucket        = local.bucket_name
  force_destroy = var.env != "prod"
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "imports" {
  bucket                  = aws_s3_bucket.imports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "imports" {
  bucket = aws_s3_bucket.imports.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "imports" {
  bucket = aws_s3_bucket.imports.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "imports" {
  bucket = aws_s3_bucket.imports.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.data_kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "imports" {
  bucket     = aws_s3_bucket.imports.id
  depends_on = [aws_s3_bucket_versioning.imports]

  # Uploads are deleted by the ingest once processed; anything left behind was
  # never processed (abandoned pre-signed target) and expires.
  rule {
    id     = "expire-unprocessed-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = var.upload_retention_days }
    noncurrent_version_expiration { noncurrent_days = var.upload_retention_days }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
  # Quarantined files + reports stay for review, then go.
  rule {
    id     = "expire-quarantine"
    status = "Enabled"
    filter { prefix = "quarantine/" }
    expiration { days = var.quarantine_retention_days }
    noncurrent_version_expiration { noncurrent_days = var.quarantine_retention_days }
  }
  rule {
    id     = "abort-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

# Refuse plain HTTP, refuse unencrypted or otherwise-keyed writes. The signed
# POST policy already fixes these for uploads; this closes the door for any
# other principal with write access.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.imports.arn,
      "${aws_s3_bucket.imports.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid       = "DenyUnencryptedWrites"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.imports.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
  statement {
    sid       = "DenyWrongKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.imports.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [var.data_kms_key_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "imports" {
  bucket     = aws_s3_bucket.imports.id
  policy     = data.aws_iam_policy_document.bucket.json
  depends_on = [aws_s3_bucket_public_access_block.imports]
}

# Server access logs for the uploads bucket (who fetched/put what). S3 writes
# them itself, so this bucket uses SSE-S3: the log delivery service cannot use a
# CMK. It is private, versioned, TLS-only and expires its objects.
resource "aws_s3_bucket" "access_logs" {
  #checkov:skip=CKV_AWS_18:This IS the access-log bucket; logging it into itself is recursive
  #checkov:skip=CKV_AWS_144:Access logs of a single-region bucket; no replication target
  #checkov:skip=CKV_AWS_145:S3 server access logging delivery does not support SSE-KMS targets; SSE-S3 is the strongest available
  #checkov:skip=CKV2_AWS_62:Nothing consumes access-log events; the uploads bucket is the one with notifications
  bucket        = "${local.bucket_name}-logs"
  force_destroy = var.env != "prod"
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket                  = aws_s3_bucket.access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket     = aws_s3_bucket.access_logs.id
  depends_on = [aws_s3_bucket_versioning.access_logs]
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration { days = var.log_retention_days }
    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

data "aws_iam_policy_document" "access_logs" {
  statement {
    sid       = "S3ServerAccessLogsPolicy"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.access_logs.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.imports.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.access_logs.arn,
      "${aws_s3_bucket.access_logs.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "access_logs" {
  bucket     = aws_s3_bucket.access_logs.id
  policy     = data.aws_iam_policy_document.access_logs.json
  depends_on = [aws_s3_bucket_public_access_block.access_logs]
}

resource "aws_s3_bucket_logging" "imports" {
  bucket        = aws_s3_bucket.imports.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "s3-access/"
}

# --- Queue + dead-letter queue ------------------------------------------------
resource "aws_sqs_queue" "dead_letter" {
  name                       = "${local.function}-dlq"
  kms_master_key_id          = var.ops_kms_key_arn
  message_retention_seconds  = 14 * 24 * 3600
  visibility_timeout_seconds = local.timeout_seconds
  tags                       = var.tags
}

resource "aws_sqs_queue" "imports" {
  name                       = local.function
  kms_master_key_id          = var.ops_kms_key_arn
  message_retention_seconds  = 4 * 24 * 3600
  visibility_timeout_seconds = local.timeout_seconds * 6
  receive_wait_time_seconds  = 10
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = var.max_receive_count
  })
  tags = var.tags
}

resource "aws_sqs_queue_redrive_allow_policy" "dead_letter" {
  queue_url = aws_sqs_queue.dead_letter.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.imports.arn]
  })
}

# Only THIS bucket, in THIS account, may enqueue.
data "aws_iam_policy_document" "queue" {
  statement {
    sid       = "S3Notifications"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.imports.arn]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.imports.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "imports" {
  queue_url = aws_sqs_queue.imports.id
  policy    = data.aws_iam_policy_document.queue.json
}

resource "aws_s3_bucket_notification" "imports" {
  bucket = aws_s3_bucket.imports.id
  queue {
    queue_arn     = aws_sqs_queue.imports.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/"
    filter_suffix = ".csv"
  }
  depends_on = [aws_sqs_queue_policy.imports]
}

# --- Ingest Lambda -----------------------------------------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ingest" {
  name_prefix        = "${var.name}-import-"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.ingest.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Least privilege, by prefix: read + delete uploads, write quarantine, nothing else.
data "aws_iam_policy_document" "ingest" {
  statement {
    sid       = "Tracing"
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
  statement {
    sid       = "ReadUploads"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.imports.arn}/uploads/*"]
  }
  statement {
    sid       = "WriteQuarantine"
    actions   = ["s3:PutObject", "s3:PutObjectTagging"]
    resources = ["${aws_s3_bucket.imports.arn}/quarantine/*"]
  }
  statement {
    sid       = "Queue"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
    resources = [aws_sqs_queue.imports.arn]
  }
  statement {
    sid       = "ReadSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.secret_arn]
  }
  dynamic "statement" {
    for_each = var.rds_iam_auth ? [1] : []
    content {
      sid       = "RdsIamConnect"
      actions   = ["rds-db:connect"]
      resources = ["arn:${local.partition}:rds-db:${var.region}:${local.account_id}:dbuser:${var.rds_proxy_resource_id}/${var.db_user}"]
    }
  }
  # Objects and the secret (data key); queue messages and environment (ops key).
  statement {
    sid       = "Kms"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [var.data_kms_key_arn, var.ops_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "ingest" {
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.ingest.json
}

resource "aws_cloudwatch_log_group" "ingest" {
  #checkov:skip=CKV_AWS_338:Retention is var.log_retention_days (365 by default, shortened only in dev/staging tfvars); Checkov does not resolve it through this module call
  name              = "/aws/lambda/${local.function}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.ops_kms_key_arn
  tags              = var.tags
}

data "archive_file" "ingest" {
  type        = "zip"
  source_file = "${var.dist_dir}/import-handler.js"
  output_path = "${path.module}/.build/${local.function}.zip"
}

resource "aws_lambda_function" "ingest" {
  #checkov:skip=CKV_AWS_272:Code signing: artifacts are built from source in CI behind OIDC; signing config is an opt-in extension
  function_name    = local.function
  role             = aws_iam_role.ingest.arn
  runtime          = "nodejs22.x"
  handler          = "import-handler.handler"
  filename         = data.archive_file.ingest.output_path
  source_code_hash = data.archive_file.ingest.output_base64sha256
  timeout          = local.timeout_seconds
  memory_size      = var.memory_size
  architectures    = ["arm64"]
  # Bounds DB connections and memory held by concurrent files.
  reserved_concurrent_executions = var.reserved_concurrency
  kms_key_arn                    = var.ops_kms_key_arn

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  tracing_config { mode = "Active" }

  # Failures after the SQS retries land on the queue's DLQ (redrive policy);
  # this is the function-level destination for asynchronous invokes too.
  dead_letter_config { target_arn = aws_sqs_queue.dead_letter.arn }

  environment {
    variables = {
      APP_ENV                      = var.env
      NODE_OPTIONS                 = "--enable-source-maps"
      POWERTOOLS_SERVICE_NAME      = local.function
      POWERTOOLS_METRICS_NAMESPACE = var.name
      DB_HOST                      = var.db_host
      DB_PORT                      = tostring(var.db_port)
      DB_NAME                      = var.db_name
      DB_USER                      = var.db_user
      DB_SSL                       = "true"
      DB_IAM_AUTH                  = var.rds_iam_auth ? "true" : "false"
      DB_SECRET_ARN                = var.secret_arn
      IMPORT_BUCKET                = aws_s3_bucket.imports.bucket
      IMPORT_KMS_KEY_ARN           = var.data_kms_key_arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.ingest, aws_iam_role_policy.ingest]
  tags       = var.tags
}

# The DLQ destination above needs sqs:SendMessage on the DLQ.
data "aws_iam_policy_document" "dlq" {
  statement {
    sid       = "DeadLetter"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.dead_letter.arn]
  }
}

resource "aws_iam_role_policy" "dlq" {
  role   = aws_iam_role.ingest.id
  policy = data.aws_iam_policy_document.dlq.json
}

resource "aws_lambda_event_source_mapping" "imports" {
  event_source_arn = aws_sqs_queue.imports.arn
  function_name    = aws_lambda_function.ingest.arn
  # One notification per invocation: a file is validated and committed on its own.
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = max(2, var.reserved_concurrency) }
}

# --- Alarms --------------------------------------------------------------------------
# A rejected file is a business event that someone should look at: the file is
# in quarantine with its report, and the API status carries the first errors.
resource "aws_cloudwatch_metric_alarm" "rejected" {
  alarm_name          = "${local.function}-rejected"
  alarm_description   = "A CSV import violated api/todo-import.odcs.yaml and was quarantined (see the quarantine/ prefix of ${local.bucket_name})"
  namespace           = var.name
  metric_name         = "import_rejected"
  dimensions          = { service = local.function }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  ok_actions          = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

# A message on the DLQ means the ingest itself failed repeatedly (database or
# S3 unreachable, bug): the file is still under uploads/ and the import shows
# `processing`. Redrive once the cause is fixed (docs/operations).
resource "aws_cloudwatch_metric_alarm" "dead_letter" {
  alarm_name          = "${local.function}-dead-letter"
  alarm_description   = "CSV import notifications could not be processed after retries; redrive ${aws_sqs_queue.dead_letter.name} once the cause is fixed"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.dead_letter.name }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [var.alarm_topic_arn]
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}
