---
name: backup
description: "Covers the **backup** subsystem of code-intel-platform. 8 symbols across 1 files. Key symbols: `BackupService`, `getBackupDir`, `getBackupKey`. Internal call density: 0 calls/symbol."
---

# backup

> **8 symbols** | **1 files** | path: `code-intel/core/src/backup/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/core/src/backup/`
- The user mentions `BackupService`, `getBackupDir`, `getBackupKey` or asks how they work
- Adding, modifying, or debugging backup-related functionality
- Tracing call chains that pass through the backup layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/core/src/backup/backup-service.ts` | `BackupManifest`, `BackupEntry`, `getBackupDir`, `getBackupKey` +(4) | 5 exported |

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `BackupService` | class | 2 | 0 | `backup/backup-service.ts` |
| `getBackupDir` | function | 1 | 0 | `backup/backup-service.ts` |
| `getBackupKey` | function | 1 | 0 | `backup/backup-service.ts` |
| `encryptBuffer` | function | 1 | 0 | `backup/backup-service.ts` |
| `decryptBuffer` | function | 1 | 0 | `backup/backup-service.ts` |
| `BackupManifest` | interface | 0 | 0 | `backup/backup-service.ts` |
| `BackupEntry` | interface | 0 | 0 | `backup/backup-service.ts` |
| `sha256File` | function | 0 | 0 | `backup/backup-service.ts` |

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
