data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ssm_parameter" "ubuntu_2404" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

locals {
  name = "${var.app_name}-${var.environment}"
  tags = {
    Name        = local.name
    Application = var.app_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = merge(local.tags, { Name = "${local.name}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-igw" })
}

resource "aws_subnet" "app" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "${local.name}-subnet-${count.index + 1}" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(local.tags, { Name = "${local.name}-public-routes" })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.app)
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "Web and restricted SSH access for CostFlow"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  # Port 3000 is retained for direct API testing; restrict it to the operator's IP.
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [var.allowed_ssh_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "${local.name}-app-sg" })
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "PostgreSQL access only from the CostFlow application"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "${local.name}-database-sg" })
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "Redis access only from the CostFlow application"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "${local.name}-redis-sg" })
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnets"
  subnet_ids = aws_subnet.app[*].id
  tags       = merge(local.tags, { Name = "${local.name}-db-subnets" })
}

resource "aws_db_instance" "postgres" {
  identifier                 = "${local.name}-db"
  engine                     = "postgres"
  engine_version             = "15"
  instance_class             = "db.t3.micro"
  allocated_storage          = 20
  storage_type               = "gp2"
  db_name                    = "cost_optimizer"
  username                   = var.db_username
  password                   = var.db_password
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.database.id]
  publicly_accessible        = false
  multi_az                   = false
  backup_retention_period    = var.environment == "production" ? 7 : 1
  deletion_protection        = var.environment == "production"
  skip_final_snapshot        = var.environment != "production"
  final_snapshot_identifier  = var.environment == "production" ? "${local.name}-final" : null
  auto_minor_version_upgrade = true
  tags                       = merge(local.tags, { Name = "${local.name}-postgres" })
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis-subnets"
  subnet_ids = aws_subnet.app[*].id
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${local.name}-redis"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
  parameter_group_name = "default.redis7"
  tags                 = merge(local.tags, { Name = "${local.name}-redis" })
}

resource "aws_instance" "app" {
  ami                         = data.aws_ssm_parameter.ubuntu_2404.value
  instance_type               = "t3.micro"
  subnet_id                   = aws_subnet.app[0].id
  vpc_security_group_ids      = [aws_security_group.app.id]
  key_name                    = var.key_pair_name
  associate_public_ip_address = true
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    github_repository                  = var.github_repository
    database_url_b64                   = base64encode("postgresql://${var.db_username}:${urlencode(var.db_password)}@${aws_db_instance.postgres.address}:5432/cost_optimizer")
    redis_url_b64                      = base64encode("redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379")
    jwt_secret_b64                     = base64encode(var.jwt_secret)
    agent_key_hmac_secret_b64          = base64encode(var.agent_key_hmac_secret)
    provider_key_encryption_secret_b64 = base64encode(var.provider_key_encryption_secret)
    totp_encryption_secret_b64         = base64encode(var.totp_encryption_secret)
    cors_origins_b64                   = base64encode(var.cors_origins)
    gemini_api_key_b64                 = base64encode(var.gemini_api_key)
  })
  tags = merge(local.tags, { Name = "${local.name}-app" })
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${local.name}-eip" })
}

resource "aws_eip_association" "app" {
  allocation_id = aws_eip.app.id
  instance_id   = aws_instance.app.id
}
