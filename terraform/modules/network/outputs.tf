output "vpc_id" {
  description = "VPC id"
  value       = aws_vpc.main.id
}

output "public_subnet_id" {
  description = "Public subnet for the EC2 instance"
  value       = aws_subnet.public.id
}

output "api_security_group_id" {
  description = "Security group for the API instance"
  value       = aws_security_group.api.id
}
