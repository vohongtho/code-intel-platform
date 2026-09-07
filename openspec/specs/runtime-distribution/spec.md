# runtime-distribution Specification

## Purpose
TBD - created by syncing change v1-0-11-self-contained-runtime-distribution. Update Purpose after archive.

## Requirements

### Requirement: Standalone install MUST NOT require system Node/npm

The standalone installation MUST NOT depend on a system-installed Node.js or npm; it MUST bundle or provision its own runtime.

#### Scenario: Fresh supported machine has no Node or npm
- **WHEN** the standalone bundle is installed
- **THEN** `code-intel --version`, repository analysis, and MCP startup MUST use the bundled runtime successfully.

### Requirement: Upgrade MUST be atomic

An upgrade MUST apply as an all-or-nothing operation: the previously active version MUST remain selected and usable unless the new version is fully verified and activated.

#### Scenario: New version fails verification/smoke check
- **WHEN** upgrade aborts
- **THEN** the previously active version MUST remain selected and usable
- **AND** partial new-version files MUST NOT become active.

### Requirement: Doctor MUST provide actionable diagnostics

`code-intel doctor` MUST identify the failing component and remediation category for runtime, native dependency, and MCP configuration problems, and MUST expose a stable machine-readable status in JSON mode.

#### Scenario: Tree-sitter/native DB/MCP configuration is broken
- **WHEN** `code-intel doctor` runs
- **THEN** it MUST identify the failing component and remediation category
- **AND** JSON mode MUST expose a stable machine-readable status.

### Requirement: Uninstall MUST preserve user data by default

Uninstall MUST remove only runtime and launcher files by default; it MUST NOT delete repository indexes or user configuration unless an explicit purge option was requested.

#### Scenario: User uninstalls runtime without purge option
- **WHEN** uninstall completes
- **THEN** runtime/launcher files MAY be removed
- **BUT** repository indexes and user configuration MUST remain unless explicit purge was requested.

### Requirement: Release integrity MUST be verified before activation

Install and upgrade MUST verify downloaded artifact integrity against the release manifest before activation; if verification fails, activation MUST fail and the existing active installation MUST remain unchanged.

#### Scenario: Downloaded artifact checksum does not match manifest
- **WHEN** install or upgrade validates the artifact
- **THEN** activation MUST fail
- **AND** existing active installation MUST remain unchanged.
