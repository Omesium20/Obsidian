# Network: /24 VPC, one public subnet, internet gateway, and the API security
# group. No NAT gateway, no private subnets yet — the /24 leaves three /26
# blocks reserved for a second AZ / private tier when the app scales out
# (docs/scaling.md).

data "aws_availability_zones" "available" {
  state = "available"
}

# CloudFront's origin-facing IP ranges, maintained by AWS. Restricting ingress
# to this list is what makes the app "only reachable through CloudFront".
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true # the instance's public DNS name is CloudFront's origin

  tags = {
    Name = "${var.name_prefix}-vpc"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 2, 0) # first /26 of the /24
  availability_zone = data.aws_availability_zones.available.names[0]

  # The instance needs outbound internet during first boot (docker install,
  # image pulls) before its EIP is associated.
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.name_prefix}-public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.name_prefix}-public"
  }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# API instance security group. Deliberately no port 22 rule — admin access is
# SSM Session Manager, which needs no inbound rules at all (docs/deployment.md).
resource "aws_security_group" "api" {
  name        = "${var.name_prefix}-api"
  description = "API origin: ingress only from CloudFront origin-facing IPs, no SSH"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.name_prefix}-api"
  }
}

resource "aws_vpc_security_group_ingress_rule" "api_from_cloudfront" {
  security_group_id = aws_security_group.api.id
  description       = "CloudFront /api/* behavior -> backend container"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
  ip_protocol       = "tcp"
  from_port         = var.api_port
  to_port           = var.api_port
}

# Open egress: Supabase Postgres, Plaid, SES SMTP, SSM endpoints, docker pulls,
# CloudWatch PutMetricData all leave through here.
resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  description       = "All outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
