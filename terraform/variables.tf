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

variable "ssh_private_key_path" {
  description = "Path to your SSH private key for VM provisioning"
  type        = string
  sensitive   = true
  default     = "~/.ssh/id_rsa"
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

