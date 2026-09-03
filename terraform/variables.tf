variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Short, lowercase CostFlow application name used in resource names."
  type        = string
  default     = "costflow"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "development"

  validation {
    condition     = contains(["development", "production"], var.environment)
    error_message = "environment must be development or production."
  }
}

variable "db_username" {
  description = "PostgreSQL master username."
  type        = string
  default     = "optimizer"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL master password. Use a 20+ character generated value."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.db_password) >= 20
    error_message = "db_password must contain at least 20 characters."
  }
}

variable "key_pair_name" {
  description = "Name of an existing EC2 key pair used for emergency SSH access."
  type        = string
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH to EC2. Use your public IP with /32."
  type        = string
}

variable "jwt_secret" {
  description = "32+ character JWT signing secret."
  type        = string
  sensitive   = true
}

variable "agent_key_hmac_secret" {
  description = "32+ character HMAC secret for stored agent keys."
  type        = string
  sensitive   = true
}

variable "provider_key_encryption_secret" {
  description = "32+ character secret used to encrypt organization provider keys."
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Optional Gemini key used for semantic-cache embeddings. Organization provider keys remain managed in CostFlow."
  type        = string
  sensitive   = true
  default     = ""
}

variable "github_repository" {
  description = "Public Git repository cloned by EC2 during bootstrap."
  type        = string
  default     = "https://github.com/Abdullahxbytes/Ai-Cost-Optimizer.git"
}
