output "instance_id" {
  description = "EC2 instance id (SSM session target)"
  value       = aws_instance.app.id
}

output "public_dns" {
  description = "EIP-backed public DNS name — CloudFront's /api/* origin"
  value       = aws_eip.app.public_dns
}

output "public_ip" {
  description = "Elastic IP"
  value       = aws_eip.app.public_ip
}
