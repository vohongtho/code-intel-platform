---
name: backup
description: "Covers the **backup** subsystem of code-intel. 37 symbols across 2 files. Key symbols: `constructor`, `getS3Config`, `constructor`. Internal call density: 0.9 calls/symbol. Participates in 4 execution flow(s)."
---

# backup

> **37 symbols** | **2 files** | path: `core/src/backup/` | call density: 0.9/sym

## When to Use

Load this skill when:
- The task involves code in `core/src/backup/`
- The user mentions `constructor`, `getS3Config`, `constructor` or asks how they work
- Adding, modifying, or debugging backup-related functionality
- Tracing call chains that pass through the backup layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `core/src/backup/backup-service.ts` | `S3Config`, `getS3Config`, `hmac`, `sha256hex` +(24) | 20 exported |
| `core/src/backup/backup-scheduler.ts` | `BackupScheduler`, `constructor`, `isEnabled`, `start` +(5) | 9 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`constructor`** `(method)` → `core/src/backup/backup-scheduler.ts:18`
- **`getS3Config`** `(function)` → `core/src/backup/backup-service.ts:26`
- **`constructor`** `(method)` → `core/src/backup/backup-service.ts:197`
- **`downloadFromS3`** `(method)` → `core/src/backup/backup-service.ts:327`
- **`listS3Backups`** `(method)` → `core/src/backup/backup-service.ts:342`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `s3Request` | function | 3 | 8 | `backup/backup-service.ts` |
| `createBackup` | method | 4 | 4 | `backup/backup-service.ts` |
| `start` | method | 1 | 6 | `backup/backup-scheduler.ts` |
| `_runBackups` | method | 1 | 5 | `backup/backup-scheduler.ts` |
| `restoreBackup` | method | 3 | 2 | `backup/backup-service.ts` |
| `applyRetention` | method | 2 | 3 | `backup/backup-service.ts` |
| `_loadIndex` | method | 4 | 1 | `backup/backup-service.ts` |
| `BackupService` | class | 4 | 0 | `backup/backup-service.ts` |
| `listBackups` | method | 3 | 1 | `backup/backup-service.ts` |
| `getS3Config` | method | 3 | 0 | `backup/backup-service.ts` |
| `uploadToS3` | method | 1 | 2 | `backup/backup-service.ts` |
| `downloadFromS3` | method | 0 | 3 | `backup/backup-service.ts` |

## Execution Flows

**4** execution path(s) pass through this area.
Run `code-intel inspect <symbol>` on a hot symbol to trace the full call chain.

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect s3Request
# Blast radius for entry point
code-intel impact constructor
# Search this area
code-intel search "backup"
```
