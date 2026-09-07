# 新书初始化衔接 Specification

## Purpose

在新书创建与 AI 写作之间提供明确的设定初始化入口，并在完全零核心设定时阻止用户静默裸写第一章，保证开篇生成有基本上下文。

## ADDED Requirements

### Requirement: Empty-chat bootstrap suggestion

The system SHALL show an explicit bootstrap suggestion in a book's empty chat before the next-chapter suggestion when the book has no character records and no world-entry records, and the relevant setting queries have finished loading.

#### Scenario: Zero-setting book

- **WHEN** a book has an empty chat, zero characters, and zero world entries
- **THEN** the system shows the bootstrap suggestion before any next-chapter suggestion

#### Scenario: Book with core settings

- **WHEN** a book has at least one character or world entry
- **THEN** the system does not show the bootstrap suggestion as the primary empty-chat action

### Requirement: Bootstrap prompt carries book context

The system SHALL ensure that activating the bootstrap suggestion sends a prompt that explicitly requests novel setting initialization and includes the book title, genre, and synopsis.

#### Scenario: User activates bootstrap

- **WHEN** the user activates the bootstrap suggestion
- **THEN** the system creates and binds a session when needed and sends the initialization request to that session

#### Scenario: Initialization request is specific

- **WHEN** the bootstrap prompt is sent
- **THEN** it contains the book title, genre, and synopsis in addition to the initialization instruction

### Requirement: First-chapter zero-setting guard

The system SHALL reject a plugin chapter write when it is the first chapter, the chapter has no existing content, and the novel has zero characters and zero world entries.

#### Scenario: Bare first chapter

- **WHEN** a chapter write targets a first chapter with no existing content and the novel has no characters or world entries
- **THEN** the system rejects the write and reports that setting initialization is required

#### Scenario: Existing or configured novel

- **WHEN** the chapter already has content, the chapter is not the first chapter, or the novel has at least one character or world entry
- **THEN** the normal chapter write behavior proceeds
