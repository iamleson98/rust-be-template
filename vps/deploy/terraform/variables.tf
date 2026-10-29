variable "ovh_endpoint" {
  description = "OVHcloud API endpoint. Accounts of the Asia subsidiaries (ASIA, SG, AU, IN) live on ovh-ca."
  type        = string
  default     = "ovh-ca"
}

variable "ovh_subsidiary" {
  description = "OVHcloud subsidiary that bills the order (the account's)."
  type        = string
  default     = "ASIA"
}

variable "name" {
  description = "Display name and hostname of the VPS."
  type        = string
  default     = "datxevui-vps"
}

variable "plan" {
  description = "VPS plan: vps-2027-model1 = 2 vCPU / 4 GB / 40 GB NVMe ($5.35/month + $0.50 backup, Asia catalog 2026-10)."
  type        = string
  default     = "vps-2027-model1"
}

variable "pricing" {
  description = "default = monthly without commitment; upfront6 / upfront12 pay 6 or 12 months ahead for 5-15% less."
  type        = string
  default     = "default"

  validation {
    condition     = contains(["default", "upfront6", "upfront12"], var.pricing)
    error_message = "One of default, upfront6, upfront12."
  }
}

variable "datacenter" {
  description = "VPS datacenter. SGP (Singapore) is the closest to Vietnam."
  type        = string
  default     = "SGP"
}

variable "os" {
  description = "OS the order installs (catalog value of vps_os)."
  type        = string
  default     = "Ubuntu 24.04"
}

variable "image_id" {
  description = <<-EOT
    Image the VPS is rebuilt with, together with the SSH key. The API lists
    image ids only for an existing VPS, so the first apply orders without
    it; scripts/install-key.py then installs the key and prints the id to
    set here (README, "Provision with OpenTofu").
  EOT
  type        = string
  default     = null
}

variable "auto_backup" {
  description = "Daily automated backup (+$0.50/month). The order is refused without it in SGP, UK and BHS (2026-10)."
  type        = bool
  default     = true
}

variable "ssh_public_key_path" {
  description = "Public key installed on the VPS."
  type        = string
  default     = "~/.ssh/datxevui-vps.pub"
}

variable "ssh_private_key_path" {
  description = "Private key OpenTofu provisions the VPS with."
  type        = string
  default     = "~/.ssh/datxevui-vps"
}

variable "deploy_public_key_path" {
  description = "Public key of the CI deploy user (release.yml holds the private key as VPS_DEPLOY_KEY)."
  type        = string
  default     = "~/.ssh/datxevui-deploy.pub"
}

variable "ssh_user" {
  description = "Login user of the Ubuntu image (sudo, key only)."
  type        = string
  default     = "ubuntu"
}
