# Encryption at Rest — graph.db & vector.db

`code-intel` stores its knowledge graph in two SQLite-based database files:

| File | Purpose |
|------|---------|
| `.code-intel/graph.db` | Symbol graph: nodes, edges, call relationships |
| `.code-intel/vector.db` | Vector embeddings for semantic search |

These files are created with **`chmod 600`** automatically (see `src/shared/fs-secure.ts`),
so only the owning OS user can read them. For deployments requiring **encryption at rest**
(compliance, shared hosts, cloud storage), use one of the approaches below.

---

## Approach 1 — Filesystem-level Encryption (Recommended)

Encrypt the entire `.code-intel/` directory using the OS filesystem layer.
This is transparent to `code-intel` — no application changes needed.

### Linux: LUKS encrypted volume

```bash
# 1. Create a LUKS container (replace /dev/sdX with your device or loopback)
sudo cryptsetup luksFormat /dev/sdX
sudo cryptsetup luksOpen /dev/sdX code-intel-data
sudo mkfs.ext4 /dev/mapper/code-intel-data

# 2. Mount and point code-intel at it
sudo mkdir -p /mnt/code-intel-data
sudo mount /dev/mapper/code-intel-data /mnt/code-intel-data
sudo chown $USER:$USER /mnt/code-intel-data

# Set CODE_INTEL_SECRETS_PATH and graph DB path via env:
export CODE_INTEL_DATA_DIR=/mnt/code-intel-data/.code-intel

# 3. On shutdown, unmount and lock
sudo umount /mnt/code-intel-data
sudo cryptsetup luksClose code-intel-data
```

### Linux: fscrypt (ext4 / f2fs)

```bash
# Enable fscrypt on the filesystem
tune2fs -O encrypt /dev/sdX
fscryptctl setup

# Encrypt .code-intel/ in-place
fscryptctl encrypt .code-intel/
```

### macOS: Encrypted APFS volume

```bash
# Create an encrypted APFS volume via Disk Utility GUI, or:
diskutil apfs addVolume disk1 APFS "CodeIntelData" -stdinPassphrase <<< "your-passphrase"
# Mount at ~/code-intel-data and symlink .code-intel → ~/code-intel-data/.code-intel
```

### Windows: BitLocker

Enable BitLocker on the drive containing the `.code-intel/` directory via
**Control Panel → BitLocker Drive Encryption**, or via PowerShell:

```powershell
Enable-BitLocker -MountPoint "C:" -EncryptionMethod Aes256 -UsedSpaceOnly -TpmProtector
```

---

## Approach 2 — SQLite Encryption Extension (SEE / SQLCipher)

For column-level encryption of the SQLite databases themselves, you can use
[SQLCipher](https://www.zetetic.net/sqlcipher/) (open-source) or the official
[SQLite Encryption Extension (SEE)](https://www.sqlite.org/see/doc/trunk/www/readme.wiki).

> ⚠️  This requires replacing the `better-sqlite3` dependency with
> `@journeyapps/sqlcipher` or a compatible fork, and is **not yet supported
> out-of-the-box** in this release. Filesystem encryption (Approach 1) is the
> recommended path.

### SQLCipher (community edition) — future integration plan

```ts
// Future: SqlCipherDb wrapper (not yet implemented)
const db = new Database('.code-intel/graph.db', {
  key: process.env.CODE_INTEL_DB_KEY,
});
db.pragma(`key="${process.env.CODE_INTEL_DB_KEY}"`);
```

---

## Approach 3 — Cloud Storage with Server-Side Encryption

When hosting `.code-intel/` on cloud block storage or object storage:

### AWS S3 (SSE-S3 / SSE-KMS)

```bash
# Enable default encryption on the bucket
aws s3api put-bucket-encryption \
  --bucket my-code-intel-bucket \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "arn:aws:kms:us-east-1:123456789:key/my-key"
      }
    }]
  }'
```

### Azure Blob Storage

Azure Blob Storage encrypts all data at rest by default using AES-256 (Microsoft-managed keys).
For customer-managed keys (CMK), configure via **Key Vault** integration in the Azure Portal.

### Google Cloud Storage

```bash
# Create a bucket with CMEK
gcloud storage buckets create gs://my-code-intel \
  --default-encryption-key=projects/my-project/locations/global/keyRings/my-ring/cryptoKeys/my-key
```

---

## Approach 4 — Encrypted Backups

The built-in **backup system** (`code-intel backup create`) already encrypts all backup
archives with **AES-256-GCM** (see `src/backup/backup-service.ts`). Back up regularly
and store backups on encrypted media or cloud storage with SSE enabled.

```bash
# Create an encrypted backup
code-intel backup create

# List backups
code-intel backup list

# Restore from backup
code-intel backup restore <id>
```

---

## File Permission Hardening (Always Applied)

`code-intel` automatically enforces the following permissions at startup and
after every analysis, regardless of encryption approach:

```
.code-intel/          chmod 700   (owner rwx, no group/other)
.code-intel/graph.db  chmod 600   (owner rw only)
.code-intel/vector.db chmod 600   (owner rw only)
.code-intel/.secrets  chmod 600   (owner rw only)
~/.code-intel/        chmod 700   (global config dir)
```

These are enforced by `src/shared/fs-secure.ts` → `secureMkdir()`, `tightenDbFiles()`.

---

## Recommendations by Deployment Type

| Scenario | Recommended Approach |
|----------|---------------------|
| Developer laptop (local only) | File permissions (auto) are sufficient |
| Shared Linux server | LUKS encrypted volume (Approach 1) |
| Docker / Kubernetes | Mount encrypted volume or use cloud SSE (Approach 3) |
| macOS team machine | Encrypted APFS volume (Approach 1) |
| Compliance (HIPAA/SOC2) | Filesystem encryption + encrypted backups + CMK on cloud |
| CI/CD ephemeral runner | No persistent DB — encrypt any exported artifacts |

---

## Verifying Permissions

```bash
# Check DB file permissions after analysis
ls -la .code-intel/
# Expected output:
# drwx------ 2 user user 4096 ...  .code-intel/
# -rw------- 1 user user ...       .code-intel/graph.db
# -rw------- 1 user user ...       .code-intel/vector.db

# Verify with stat
stat -c "%a %n" .code-intel/ .code-intel/*.db
# Expected: 700 .code-intel/
#           600 .code-intel/graph.db
#           600 .code-intel/vector.db
```

---

## Related

- [TLS / Reverse Proxy Guidance](./tls-guidance.md)
- [Backup & Recovery Runbook](./runbooks/disaster-recovery.md)
- [`src/shared/fs-secure.ts`](../code-intel/core/src/shared/fs-secure.ts) — permission hardening
- [`src/auth/secret-store.ts`](../code-intel/core/src/auth/secret-store.ts) — AES-256-GCM secrets store
- [`src/backup/backup-service.ts`](../code-intel/core/src/backup/backup-service.ts) — encrypted backups
