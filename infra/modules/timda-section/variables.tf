# Inputs mirror `timda plan` (TIMDA-1, specs/0001-finger-record.md).

variable "zone_id" {
  description = "Cloudflare zone ID for the Section's domain."
  type        = string
}

variable "domain" {
  description = "The Section's domain, e.g. section72.net. This is the Section's identity."
  type        = string
  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,62}$", var.domain))
    error_message = "domain must be a lowercase DNS name without a trailing dot."
  }
}

variable "name" {
  description = "In-world designation of the place (never a person), <= 48 chars."
  type        = string
  validation {
    # Printable ASCII without ';' or '%'. For anything fancier, percent-encode it yourself
    # (or generate the records with timda plan).
    condition     = length(var.name) > 0 && length(var.name) <= 48 && can(regex("^[\\x20-\\x24\\x26-\\x3a\\x3c-\\x7e]+$", var.name))
    error_message = "name must be 1-48 printable ASCII characters, without ';' or '%'."
  }
}

variable "status" {
  description = "open (listed and routable), closed (listed as dark) or pending (being set up: valid, but not listed)."
  type        = string
  validation {
    condition     = contains(["open", "closed", "pending"], var.status)
    error_message = "status must be open, closed or pending."
  }
}

variable "type" {
  description = "section, place or hub."
  type        = string
  default     = "section"
  validation {
    condition     = contains(["section", "place", "hub"], var.type)
    error_message = "type must be section, place or hub."
  }
}

variable "concept" {
  description = "One line of in-world description, <= 120 chars."
  type        = string
  default     = null
  validation {
    condition     = var.concept == null || (length(var.concept) <= 120 && can(regex("^[\\x20-\\x24\\x26-\\x3a\\x3c-\\x7e]*$", var.concept)))
    error_message = "concept must be <= 120 printable ASCII characters, without ';' or '%'."
  }
}

variable "expires" {
  description = "Optional YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ after which the Section is delisted."
  type        = string
  default     = null
  validation {
    condition     = var.expires == null || can(regex("^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}Z)?$", var.expires))
    error_message = "expires must be YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ."
  }
}

variable "auth" {
  description = "Auth methods visitors can use: passkey, pubkey, none."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for a in var.auth : contains(["passkey", "pubkey", "none"], a)])
    error_message = "auth entries must be passkey, pubkey or none."
  }
}

variable "keys" {
  description = "1-8 keys, as printed by `timda key file.pub`: ed25519:<b64> or sk-ed25519:<b64>."
  type        = list(string)
  validation {
    condition     = length(var.keys) >= 1 && length(var.keys) <= 8
    error_message = "a Section needs 1 to 8 keys (TIMDA-1 §5)."
  }
  validation {
    condition     = alltrue([for k in var.keys : can(regex("^(ed25519|sk-ed25519):[A-Za-z0-9+/]{43}=$", k))])
    error_message = "each key must look like ed25519:<44 base64 chars> or sk-ed25519:<44 base64 chars>."
  }
}

variable "airlock" {
  description = "Where visitors arrive from the hub. Must be https on this domain. Convention: https://<domain>/airlock"
  type        = string
  default     = null
}

variable "charter" {
  description = "Definitive out-of-character rules and contact. Must be https on this domain. Convention: https://<domain>/charter"
  type        = string
  default     = null
}

variable "setting" {
  description = "In-world setting and lore. Any https URL. Convention: https://<domain>/setting"
  type        = string
  default     = null
}

variable "button" {
  description = "The Section's 88x31 button: a PNG or GIF, 88x31 or 176x62, at most 16 KiB. Must be https on this domain. Convention: https://<domain>/88x31.png"
  type        = string
  default     = null
}

variable "banner" {
  description = "A 468x60 banner for the hub's showcase: a PNG or GIF, 468x60 or 936x120, at most 64 KiB. Must be https on this domain. Convention: https://<domain>/468x60.png"
  type        = string
  default     = null
}

variable "banner_caption" {
  description = "Optional caption shown with the banner, up to 140 characters. No semicolons or percent signs (they'd need percent-encoding)."
  type        = string
  default     = null
  validation {
    condition     = var.banner_caption == null || (length(var.banner_caption) <= 140 && !can(regex("[;%\"]", var.banner_caption)))
    error_message = "banner_caption must be at most 140 characters, without ; % or quotes."
  }
}

variable "inbox" {
  description = "The hub that holds this Section's mail (TIMDA-3), e.g. timda.space. Leave null for no inbox."
  type        = string
  default     = null
  validation {
    condition     = var.inbox == null || can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,62}$", var.inbox))
    error_message = "inbox must be a hub's domain name, lowercase, with no trailing dot."
  }
}

variable "inbox_age" {
  description = "Optional age X25519 public key (age1...). With it, mail to this Section must be sealed to it, so the hub can't read it."
  type        = string
  default     = null
  validation {
    condition     = var.inbox_age == null || can(regex("^age1[02-9ac-hj-np-z]{58}$", var.inbox_age))
    error_message = "inbox_age must be an age X25519 public key (age1 and 58 more characters), from age-keygen."
  }
}

variable "ttl" {
  description = "TTL for every record. Keep them identical and <= 3600 (TIMDA-1 §9.1)."
  type        = number
  default     = 300
  validation {
    condition     = var.ttl >= 60 && var.ttl <= 3600
    error_message = "ttl must be between 60 and 3600 seconds."
  }
}
