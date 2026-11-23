terraform {
  # OpenTofu >= 1.8: state encryption, and variables in the encryption block.
  required_version = ">= 1.8.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # State lives in Cloudflare R2 (S3-compatible). Settings that differ per person
  # (bucket, endpoint) come from backend.hcl: see backend.hcl.example.
  backend "s3" {}

  # Client-side encryption: state and plan files are unreadable at rest, even in R2.
  # The passphrase comes from TF_VAR_state_passphrase. Lose it and the state is gone,
  # so keep it in a password manager.
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }
    state {
      method   = method.aes_gcm.main
      enforced = true
    }
    plan {
      method   = method.aes_gcm.main
      enforced = true
    }
  }
}

# The API token comes from CLOUDFLARE_API_TOKEN. Never put it in a file.
provider "cloudflare" {}
