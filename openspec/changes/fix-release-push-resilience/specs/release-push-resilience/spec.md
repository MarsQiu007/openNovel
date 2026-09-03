# release-push-resilience

## Purpose

规范 release 准备阶段对 git push 操作的容错行为：version bump commit 的推送需容忍 GitHub 瞬时故障并自动重试；tag 推送失败必须即时让 prepare 阶段失败，杜绝静默吞错导致问题延迟到 build 阶段才暴露。

## ADDED Requirements

### Requirement: bump commit 推送对瞬时错误自动重试

release 准备阶段推送 version bump commit 到目标分支时，遇到瞬时性失败（服务端 5xx、网络中断等）SHALL 自动重试；重试次数耗尽仍失败时 SHALL 以明确错误终止 prepare 阶段。

#### Scenario: 首次推送被服务端瞬时错误拒收后重试成功

- **WHEN** version bump commit 首次推送被 GitHub 服务端以瞬时错误（如 Internal Server Error）拒收
- **THEN** 系统自动重试推送且重试内成功
- **AND** prepare 阶段继续正常执行，release 流程不中断

#### Scenario: 重试耗尽后仍然失败

- **WHEN** version bump commit 推送在全部重试次数耗尽后仍未成功
- **THEN** prepare 阶段以失败终止
- **AND** 失败日志中包含最后一次推送的原始错误信息（如 remote 拒收原因与 Request ID）

### Requirement: tag 推送失败必须即时失败

release 准备阶段向远端推送 release tag 时，推送失败 MUST 使 prepare 阶段立即失败，不得静默跳过或降级为警告；tag 推送成功后远端 MUST 存在指向正确 commit 的 tag。

#### Scenario: tag 推送失败时 prepare 即时终止

- **WHEN** release tag 推送到远端失败（任何原因）
- **THEN** prepare 阶段立即以失败终止
- **AND** 失败日志中包含 tag 推送的原始错误信息
- **AND** 后续 build 阶段不会被触发

#### Scenario: tag 推送成功后远端可用

- **WHEN** release tag 推送到远端成功
- **THEN** 远端存在该 tag 且指向 prepare 阶段产出的 commit
- **AND** build 阶段能够基于该 tag 正常 checkout
