# AWS deployment guide

This deployment creates one EC2 application host, PostgreSQL on RDS, and Redis on ElastiCache. The database and Redis are private: only the EC2 security group can reach them.

## Before you begin

- Install Terraform 1.6+ and configure the AWS CLI (`aws configure`).
- Create an EC2 key pair in the target AWS region and keep its `.pem` file safe.
- Ensure your AWS account can create VPC, EC2, EIP, RDS, and ElastiCache resources.
- Generate secrets locally:

```bash
openssl rand -base64 48
```

Use a separate generated value for the database password, JWT secret, agent-key HMAC secret, and provider-key encryption secret.

## Provision infrastructure

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars. Set allowed_ssh_cidr to YOUR.PUBLIC.IP/32.
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Terraform outputs the Elastic IP and internal RDS/Redis endpoints. EC2 bootstrap clones `main`, writes `/opt/costflow/.env`, and runs `docker compose -f docker-compose.production.yml up -d --build`.

## Direct deployment from this Windows machine

For the existing EC2 instance, deploy directly from your computer instead of using GitHub authentication. The script archives the local project, excludes Terraform and credentials, uploads a separate production environment file over SSH, installs Docker if needed, and starts the production stack.

First create your private production file from the tracked template and replace every placeholder with your AWS endpoints and generated secrets:

```powershell
Copy-Item .env.production.example .env.production
```

From the repository root in PowerShell:

```powershell
.\scripts\deploy-ec2.ps1 `
  -KeyPath "$HOME\.ssh\cost-optimizer-key.pem" `
  -Host "44.193.109.138"
```

The private `.env.production` file is required and remains untracked. To upload a differently named file, add `-EnvFile ".env.my-production"`.

When the script completes, verify the public health endpoint:

```powershell
curl http://44.193.109.138/health
```

## Verify

Wait several minutes for RDS, ElastiCache, and cloud-init to finish, then run:

```bash
terraform output application_url
curl http://$(terraform output -raw ec2_public_ip)/api/health
ssh -i /path/to/keypair.pem ubuntu@$(terraform output -raw ec2_public_ip)
```

On EC2:

```bash
sudo tail -f /var/log/costflow-setup.log
cd /opt/costflow
sudo docker compose -f docker-compose.production.yml ps
sudo docker compose -f docker-compose.production.yml logs -f app web
curl http://localhost:3000/health
```

The browser application is available at `http://<elastic-ip>/`; API traffic is routed through `/api/` to the Node service.

## Update an existing deployment

Run the same `scripts/deploy-ec2.ps1` command above. It replaces the application files on EC2 with the local project files and rebuilds the containers; no GitHub access is required.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| EC2 bootstrap failed | `sudo tail -f /var/log/cloud-init-output.log` and `/var/log/costflow-setup.log` |
| API unhealthy | `sudo docker compose -f docker-compose.production.yml logs app` |
| RDS connection refused | Wait for RDS `available`; confirm the database SG allows only the app SG on 5432. |
| Redis connection refused | Wait for ElastiCache `available`; confirm the Redis SG allows only the app SG on 6379. |
| Terraform key-pair error | Create the named EC2 key pair in the same region, then rerun `terraform plan`. |
| State lock | Verify no other apply is running; use `terraform force-unlock` only after confirming that. |

Useful AWS checks:

```bash
aws ec2 describe-instances --filters "Name=tag:Name,Values=costflow-*"
aws rds describe-db-instances
aws elasticache describe-cache-clusters --show-cache-node-info
```

## Costs and security

The requested sizes are small development sizes, but AWS free-tier eligibility and public IPv4 pricing depend on your account and current AWS policy. Set AWS Budget alerts before applying.

RDS is intentionally not public, Redis has no public route, and port 3000 is limited to `allowed_ssh_cidr`; public users reach the application on port 80. Before production use, attach a domain/TLS certificate, tighten SSH access, and consider Secrets Manager plus a remote Terraform state backend.

## Destroy

For development environments only:

```bash
cd terraform
terraform plan -destroy
terraform destroy
```

Production uses deletion protection and a final RDS snapshot. Disable deletion protection deliberately only when retiring the environment.
