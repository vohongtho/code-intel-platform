# Runtime Distribution Specification

## ADDED Requirements

### Requirement: Standalone install MUST NOT require system Node/npm

#### Scenario: Fresh supported machine has no Node or npm
- **WHEN** the standalone bundle is installed
- **THEN** `code-intel --version`, repository analysis, and MCP startup MUST use the bundled runtime successfully.

### Requirement: Upgrade MUST be atomic

#### Scenario: New version fails verification/smoke check
- **WHEN** upgrade aborts
- **THEN** the previously active version MUST remain selected and usable
- **AND** partial new-version files MUST NOT become active.

### Requirement: Doctor MUST provide actionable diagnostics

#### Scenario: Tree-sitter/native DB/MCP configuration is broken
- **WHEN** `code-intel doctor` runs
- **THEN** it MUST identify the failing component and remediation category
- **AND** JSON mode MUST expose a stable machine-readable status.

### Requirement: Uninstall MUST preserve user data by default

#### Scenario: User uninstalls runtime without purge option
- **WHEN** uninstall completes
- **THEN** runtime/launcher files MAY be removed
- **BUT** repository indexes and user configuration MUST remain unless explicit purge was requested.

### Requirement: Release integrity MUST be verified before activation

#### Scenario: Downloaded artifact checksum does not match manifest
- **WHEN** install or upgrade validates the artifact
- **THEN** activation MUST fail
- **AND** existing active installation MUST remain unchanged.
