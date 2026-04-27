---
name: backup
description: "Covers the **backup** subsystem of code-intel-platform. 17 symbols across 2 files. Key symbols: `BackupService`, `createBackupScheduler`, `hmac`. Internal call density: 0.1 calls/symbol."
---

# backup

> **17 symbols** | **2 files** | path: `code-intel/core/src/backup/` | call density: 0.1/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/backup/`
- The user mentions `BackupService`, `createBackupScheduler`, `hmac` or asks how they work
- Adding, modifying, or debugging backup-related functionality
- Tracing call chains that pass through the backup layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/backup/backup-service.ts` | `S3Config`, `getS3Config`, `hmac`, `sha256hex` +(11) | 7 exported |
| `code-intel/core/src/backup/backup-scheduler.ts` | `BackupScheduler`, `createBackupScheduler` | 2 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `BackupService` | class | 3 | 0 | `backup/backup-service.ts` |
| `createBackupScheduler` | function | 1 | 1 | `backup/backup-scheduler.ts` |
| `hmac` | function | 2 | 0 | `backup/backup-service.ts` |
| `sigV4SigningKey` | function | 1 | 1 | `backup/backup-service.ts` |
| `BackupScheduler` | class | 1 | 0 | `backup/backup-scheduler.ts` |
| `getS3Config` | function | 1 | 0 | `backup/backup-service.ts` |
| `sha256hex` | function | 1 | 0 | `backup/backup-service.ts` |
| `s3Request` | function | 1 | 0 | `backup/backup-service.ts` |
| `getBackupDir` | function | 1 | 0 | `backup/backup-service.ts` |
| `getBackupKey` | function | 1 | 0 | `backup/backup-service.ts` |
| `encryptBuffer` | function | 1 | 0 | `backup/backup-service.ts` |
| `decryptBuffer` | function | 1 | 0 | `backup/backup-service.ts` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect BackupService
# Blast radius for entry point
code-intel impact BackupService
# Search this area
code-intel search "backup"
```
