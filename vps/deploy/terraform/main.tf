# The VPS that runs vps-service (place search, OSM indexer, cron driver).
#
# OpenTofu orders it, and once its SSH key is installed (see image_id)
# prepares the host over SSH: firewall (SSH only; Cloudflare Tunnel is the
# way in), automatic security updates, hardened key-only SSH with sshguard,
# cloudflared, and vps-service with its timer that pulls signed releases.
# The tunnel's connector token and the service tokens are installed by hand
# (vps/README.md): secrets do not belong in OpenTofu state.

provider "ovh" {
  # Credentials: ~/.ovh.conf or OVH_* environment variables.
  endpoint = var.ovh_endpoint
}

locals {
  ssh_public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
  model          = replace(var.plan, "vps-2027-", "")
  options = concat(
    # Local NVMe storage: free, and mandatory in some regions.
    [{ duration = "P1M", plan_code = "option-storage-local-2027-${local.model}", pricing_mode = "default", quantity = 1 }],
    var.auto_backup ? [{ duration = "P1M", plan_code = "option-auto-backup-2027-1-${local.model}", pricing_mode = "default", quantity = 1 }] : [],
  )
}

resource "ovh_vps" "this" {
  display_name   = var.name
  ovh_subsidiary = var.ovh_subsidiary
  plan = [{
    duration     = "P1M"
    plan_code    = var.plan
    pricing_mode = var.pricing
    configuration = [
      { label = "vps_datacenter", value = var.datacenter },
      { label = "vps_os", value = var.os },
    ]
  }]
  plan_option = local.options

  # With an image, the order is followed by a rebuild that installs the
  # SSH key (the order itself cannot carry one).
  image_id             = var.image_id
  public_ssh_key       = var.image_id == null ? null : local.ssh_public_key
  do_not_send_password = true

  lifecycle {
    # A changed plan or image would re-order or reinstall the server and
    # lose its disk. Plans are upgraded in the Control Panel (the IP and
    # data stay); the image matters only when the VPS is created.
    ignore_changes = [plan, plan_option, image_id, public_ssh_key, do_not_send_password]
  }
}

data "ovh_vps" "this" {
  service_name = ovh_vps.this.service_name
}

locals {
  ipv4 = [for ip in data.ovh_vps.this.ips : ip if can(regex("^[0-9]+(\\.[0-9]+){3}$", ip))][0]
}

# Host preparation, once the key is on the VPS; runs again when the script changes.
resource "terraform_data" "bootstrap" {
  count = var.image_id == null ? 0 : 1

  triggers_replace = {
    ip     = local.ipv4
    script = filesha256("${path.module}/templates/bootstrap.sh")
  }

  connection {
    type        = "ssh"
    host        = local.ipv4
    user        = var.ssh_user
    private_key = file(pathexpand(var.ssh_private_key_path))
  }
  provisioner "file" {
    source      = "${path.module}/templates/bootstrap.sh"
    destination = "/tmp/datxevui-bootstrap.sh"
  }
  provisioner "remote-exec" {
    inline = [
      "sudo NAME='${var.name}' bash /tmp/datxevui-bootstrap.sh",
      "rm -f /tmp/datxevui-bootstrap.sh",
    ]
  }
}
