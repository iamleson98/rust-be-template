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
      version = "~> 1.0"
    }
  }
  required_version = ">= 1.5.0"
}

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
  cpu_type      = "AMD" # A-series = AMD, B-series = Intel
  billing_cycle = "monthly"
  disk_size     = var.vm_disk_size_gb
  ssh_keys      = [kamatera_sshkey.deploy_key.name]

  # Wait for the VM to be fully provisioned before running provisioner.
  timeouts {
    create = "15m"
    delete = "10m"
  }

  # Install Docker and prepare the VM for deployment
  provisioner "remote-exec" {
    inline = [
      "apt-get update",
      "apt-get install -y curl ca-certificates gnupg lsb-release",
      # Install Docker
      "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg",
      "echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable' | tee /etc/apt/sources.list.d/docker.list > /dev/null",
      "apt-get update",
      "apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin",
      "docker --version",
      "docker compose version",
      # Create deployment directory
      "mkdir -p /opt/vexevn",
      "chmod 755 /opt/vexevn"
    ]

    connection {
      type        = "ssh"
      user        = "root"
      private_key = file(var.ssh_private_key_path)
      host        = self.public_ip
      timeout     = "3m"
    }
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
