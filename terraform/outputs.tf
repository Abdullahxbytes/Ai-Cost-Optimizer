output "ec2_public_ip" { value = aws_eip.app.public_ip }
output "ec2_private_ip" { value = aws_instance.app.private_ip }
output "rds_endpoint" { value = aws_db_instance.postgres.endpoint }
output "redis_endpoint" { value = "${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379" }
output "ssh_command" { value = "ssh -i /path/to/${var.key_pair_name}.pem ubuntu@${aws_eip.app.public_ip}" }
output "database_connection_string" {
  value     = "postgresql://${var.db_username}:***@${aws_db_instance.postgres.address}:5432/cost_optimizer"
  sensitive = true
}
output "application_url" { value = "http://${aws_eip.app.public_ip}" }
