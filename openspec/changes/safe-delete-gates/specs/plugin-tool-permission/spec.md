## MODIFIED Requirements

### Requirement: High-impact bundled tool confirmation

The system SHALL require user confirmation before executing bundled high-impact plugin tools even when the agent has an allow permission, and SHALL NOT require confirmation for reversible operations or non-destructive modes of those tools.

#### Scenario: Destructive chapter operation

- **WHEN** an agent calls `delete_chapter`
- **THEN** the bundled agent permission marks the tool as `ask`
- **AND** the central gate waits for user confirmation before execution

#### Scenario: Reversible chapter version restore

- **WHEN** an agent calls `restore_chapter_version`
- **THEN** the bundled agent permission marks the tool as `allow`
- **AND** execution proceeds without a confirmation prompt, because the restore appends the target version as a new latest version without deleting any history

#### Scenario: Arc backfill incremental mode

- **WHEN** an agent calls `backfill_story_arcs` with `mode=create_only`
- **THEN** execution proceeds without a confirmation prompt, and existing arcs are never deleted

#### Scenario: Arc rebuild deletion mode

- **WHEN** an agent calls `backfill_story_arcs` with `mode=replace_all` or `mode=replace_matching`
- **THEN** the tool raises a permission request before deleting any existing arc
- **AND** the request identifies the deletion mode and carries the number of existing arcs that would be deleted in its metadata
- **AND** deletion starts only after the request is approved

#### Scenario: Arc rebuild approval memory

- **WHEN** the user approves an arc rebuild permission request with the always option
- **THEN** subsequent calls in the same session for the same deletion mode proceed without a new prompt
- **AND** the other deletion mode still requires confirmation

#### Scenario: Arc rebuild pre-authorization

- **WHEN** the user permission configuration allows the arc rebuild permission key for a specific deletion mode
- **THEN** calls in that mode proceed without a prompt, while the other deletion mode still requires confirmation

#### Scenario: Arc rebuild rejection

- **WHEN** the user rejects an arc rebuild permission request
- **THEN** no existing arc is deleted and the tool call fails without modifying arc data

#### Scenario: Cascading or setting mutation

- **WHEN** an agent calls `cascade_execute`, `accept_pending_setting`, `merge_pending_settings`, `delete_setting`, `deduplicate_characters`, `deduplicate_relationships`, or `update_project_config`
- **THEN** the bundled agent permission marks the tool as `ask`
- **AND** approval can be remembered for the specific tool through the existing always-allow flow
