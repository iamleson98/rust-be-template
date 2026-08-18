# ─── Terraform: Kamatera Singapore VM for VeXeVN ───────────────────
#
# Provisions a single Kamatera VM in Asia-Singapore, installs Docker,
# and deploys the app via docker compose.
#
# Prerequisites:
#   1. Kamatera API credentials:
#        KAMATERA_API_TOKEN  (env var — from Kamatera console > API)
#        KAMATERA_API_SECRET (env var)
#      Set via: export KAMATERA_API_TOKEN="..." KAMATERA_API_SECRET="..."
#
#   2. SSH public key at ~/.ssh/id_rsa.pub (or override var.ssh_public_key_path)
#
#   3. Your .env file ready in the repo root (with production JWT secret etc.)
#
# Usage:
#   cd terraform/
#   terraform init
#   terraform plan
#   terraform apply
#
# After apply:
#   - The VM's public IP is in: terraform output vm_public_ip
#   - SSH: ssh root@<vm_public_ip>
#   - App: http://<vm_public_ip>:8080
#   - Swagger: http://<vm_public_ip>:8080/swagger-ui
#
# Destroy:
#   terraform destroy

terraform {
  required_providers {
    kamatera = {
      source  = "Kamatera/kamatera"
      version = "~> 0.1.0"
    }
  }
  required_version = ">= 1.5"
}

# ─── Variables ──────────────────────────────────────────────────────

variable "kamatera_api_token" {
  description = "Kamatera API token (from console > API)"
  type        = string
  sensitive   = true
}

variable "kamatera_api_secret" {
  description = "Kamatera API secret"
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "Path to your SSH public key for VM access"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "vm_name" {
  description = "Name for the VM"
  type        = string
  default     = "vexevn-prod"
}

variable "vm_size" {
  description = "Kamatera server size (A=AMD, B=Intel). Format: A{cpu}{ram}"
  type        = string
  default     = "A2aa" # 2 vCPU, 2GB RAM — ~$12/month
  # Cheaper options: "A1aa" (1 vCPU, 1GB, ~$6/mo) — may OOM on large builds
  # Larger: "B2aa" (2 vCPU, 4GB, ~$20/mo) for production with Postgres
}

variable "vm_disk_size_gb" {
  description = "SSD disk size in GB"
  type        = number
  default     = 30
}

# ─── Provider ───────────────────────────────────────────────────────

provider "kamatera" {
  api_token  = var.kamatera_api_token
  api_secret = var.kamatera_api_secret
}

# ─── SSH Key ────────────────────────────────────────────────────────

locals {
  ssh_public_key = file(var.ssh_public_key_path)
}

resource "kamatera_sshkey" "deploy_key" {
  name      = "vexevn-deploy-key"
  publickey = local.ssh_public_key
}

# ─── VM ─────────────────────────────────────────────────────────────

resource "kamatera_server" "vexevn" {
  name          = var.vm_name
  zone          = "SIN-Singapore" # Asia-Singapore
  image         = "ubuntu_22.04_server_x64"
  size          = var.vm_size
  cpu_type      = "AMD"             # A-series = AMD, B-series = Intel
  billing_cycle = "monthly"
  disk_size     = var.vm_disk_size_gb
  ssh_keys      = [kamatera_sshkey.deploy_key.name]

  # Wait for the VM to be fully provisioned before running provisioner.
  timeouts {
    create = "15m"
    delete = "10m"
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────

output "vm_public_ip" {
  description = "Public IP of the Kamatera VM"
  value       = kamatera_server.vexevn.public_ip
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh root@${kamatera_server.vexevn.public_ip}"
}

output "app_url" {
  description = "URL to access the app"
  value       = "http://${kamatera_server.vexevn.public_ip}:8080"
}

output "swagger_url" {
  description = "URL for Swagger UI"
  value       = "http://${kamatera_server.vexevn.public_ip}:8080/swagger-ui"
}
