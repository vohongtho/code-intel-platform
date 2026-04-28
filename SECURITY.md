# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | ✅ Active support |
| 0.1.x   | ⚠️ Critical fixes only |
| < 0.1   | ❌ No longer supported |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please report vulnerabilities privately via one of:

1. **GitHub Security Advisories**: https://github.com/vohongtho/code-intel-platform/security/advisories/new
2. **Email**: Contact via GitHub profile

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (optional)

### Response timeline

| Step | Target |
|------|--------|
| Acknowledgement | 48 hours |
| Initial assessment | 5 business days |
| Fix or mitigation | 30 days (critical: 7 days) |
| Public disclosure | After fix is released |

## Security Architecture

### Authentication
- Local accounts with bcrypt (12 rounds) password hashing
- API tokens: raw token shown once, SHA-256 hash stored
- Session cookies: `HttpOnly`, `SameSite=Strict` in production, `Secure` in production
- Configurable session TTL (default: 8 hours)
- Dev auto-login: only on localhost, only when single admin exists

### Authorization
- RBAC: `admin`, `analyst`, `viewer`, `repo-owner` roles
- All API endpoints require authentication
- Path traversal protection on file read endpoints
- Audit log for every auth check

### Transport
- `helmet` secure HTTP headers
- CORS allowlist (no wildcard in production)
- Per-IP rate limiting (100 req/15min)
- 1 MB request payload cap
- TLS via reverse proxy (nginx/caddy)

### Data Protection
- AES-256-GCM encrypted backups
- SHA-256 manifest per backup
- Sensitive data masked in all log output
- No secrets in config files (require `$ENV_VAR` syntax)

### Supply Chain
- Signed npm releases with provenance attestation
- Signed Docker images with cosign
- SBOM (CycloneDX) attached to each release
- Dependabot weekly dependency updates
- `npm audit` gate: 0 high/critical CVEs

## Known Security Scope

The following are **in scope** for security reports:
- Authentication bypass
- Authorization bypass / privilege escalation
- Path traversal / directory traversal
- Remote code execution
- SQL injection
- Secrets disclosure via logs or API responses
- CORS misconfiguration
- XSS in Web UI

The following are **out of scope**:
- Denial of service via resource exhaustion on localhost (dev mode)
- Issues requiring physical access to the machine
- Vulnerabilities in optionally-installed dependencies not used in default config

## Security Configuration Checklist (Production)

```bash
# 1. Set NODE_ENV=production
export NODE_ENV=production

# 2. Run behind TLS (nginx/caddy)
# See docs/tls-setup.md for nginx/caddy examples

# 3. Restrict CORS origins
export CODE_INTEL_CORS_ORIGINS="https://your-domain.com"

# 4. Set backup encryption key
export CODE_INTEL_BACKUP_KEY="$(openssl rand -hex 32)"

# 5. Create admin account
code-intel user create admin --role admin

# 6. Disable dev auto-login (do NOT set CODE_INTEL_DEV_AUTO_LOGIN)

# 7. Run npm audit
npm audit --audit-level=high
```
