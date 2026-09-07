## Purpose

让插件工具与内置工具和 MCP 工具共享统一、可审计的用户审批链路，同时避免通配权限静默放行未知插件工具。

## Requirements

### Requirement: Plugin tool execution gate

The system SHALL evaluate a permission request before executing every plugin tool and SHALL NOT invoke the plugin tool when approval is denied.

#### Scenario: Approval required

- **WHEN** an agent calls a plugin tool without an exact allow rule
- **THEN** the system raises a permission request before plugin execution
- **AND** plugin execution starts only after the request is approved

#### Scenario: Approval denied

- **WHEN** the user rejects the plugin tool permission request
- **THEN** the plugin tool implementation is not invoked

### Requirement: Explicit plugin tool authorization

The system SHALL let an exact permission rule control a plugin tool by tool ID, and SHALL NOT treat a wildcard allow rule as implicit authorization for an undeclared plugin tool.

#### Scenario: Exact allow rule

- **WHEN** the active agent has `allow` for the plugin tool ID
- **THEN** the central gate allows execution without a new prompt

#### Scenario: Exact ask rule

- **WHEN** the active agent has `ask` for the plugin tool ID
- **THEN** the central gate requests approval even if a wildcard allow rule also exists

#### Scenario: Undeclared plugin tool

- **WHEN** only a wildcard allow rule exists for the plugin tool ID
- **THEN** the central gate requests approval

### Requirement: Plugin tool permission identity

The system SHALL use the plugin tool ID as the default permission identity and SHALL allow a plugin tool definition to override that identity with an explicit permission key.

#### Scenario: Default identity

- **WHEN** a plugin tool does not declare a permission key
- **THEN** permission evaluation uses the registered plugin tool ID

#### Scenario: Explicit identity

- **WHEN** a plugin tool declares a permission key
- **THEN** permission evaluation and always-allow storage use that key

### Requirement: High-impact bundled tool confirmation

The system SHALL require user confirmation before executing bundled high-impact plugin tools even when the agent has a wildcard allow permission.

#### Scenario: Destructive chapter operation

- **WHEN** an agent calls `delete_chapter` or `restore_chapter_version`
- **THEN** the bundled agent permission marks the tool as `ask`
- **AND** the central gate waits for user confirmation before execution

#### Scenario: Cascading or setting mutation

- **WHEN** an agent calls `cascade_execute`, `accept_pending_setting`, `merge_pending_settings`, `delete_setting`, `deduplicate_characters`, `deduplicate_relationships`, or `update_project_config`
- **THEN** the bundled agent permission marks the tool as `ask`
- **AND** approval can be remembered for the specific tool through the existing always-allow flow
