# Run with OpenTofu (`tofu`); the block keeps the name the language gives it.
terraform {
  required_version = ">= 1.13"

  # State lives outside the repository (it names the server and its IP):
  #   tofu init -backend-config="path=$HOME/.config/datxevui/vps.tfstate"
  backend "local" {}

  required_providers {
    ovh = {
      source  = "ovh/ovh"
      version = "= 2.22.0"
    }
  }
}
