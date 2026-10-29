output "service_name" {
  description = "OVHcloud service name of the VPS (for scripts/install-key.py and the Control Panel)."
  value       = ovh_vps.this.service_name
}

output "ipv4" {
  description = "Public IPv4 address."
  value       = local.ipv4
}

output "ssh" {
  description = "How to log in."
  value       = "ssh -i ${var.ssh_private_key_path} ${var.ssh_user}@${local.ipv4}"
}

output "awaiting_ssh_key" {
  description = "True until the key is installed and image_id is set (README)."
  value       = var.image_id == null
}

output "monthly_cost_usd" {
  description = "List price per month (USD, excl. tax; Asia catalog of 2026-10, no commitment)."
  value = lookup({
    "vps-2027-model1" = 5.35
    "vps-2027-model2" = 10.00
    "vps-2027-model3" = 14.50
    "vps-2027-model4" = 27.50
  }, var.plan, null) + (var.auto_backup ? 0.5 : 0)
}
