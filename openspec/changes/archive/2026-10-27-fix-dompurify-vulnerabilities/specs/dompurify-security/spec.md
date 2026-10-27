# Spec Delta

## Purpose

定义 dompurify 安全升级后的系统行为——确保 markdown 渲染、HTML 清理等使用 dompurify 的场景不受已知漏洞影响。

## ADDED Requirements

### Requirement: dompurify 版本不低于 3.4.17

`packages/ui` 和 `packages/session-ui` 的 `dompurify` 依赖版本 SHALL 不低于 `3.4.17`，以修复以下已知漏洞：
- GHSA-cg2g-xh64-v4q7（critical）：SAFE_FOR_TEMPLATES bypass
- GHSA-mrv2-3pqr-j5jr（high）：IN_PLACE hook 残留事件处理器
- GHSA-c6gr-qvv4-5v3f（low）：SMIL attributeName=href guard 跳过

#### Scenario: 升级后版本检查

- **WHEN** 检查 `packages/ui/package.json` 和 `packages/session-ui/package.json` 的 `dompurify` 版本
- **THEN** 版本号 SHALL 为 `3.4.17` 或更高

#### Scenario: markdown 渲染不受漏洞影响

- **WHEN** 渲染包含潜在 XSS 向量的 markdown 内容
- **THEN** dompurify SHALL 正确清理所有已知漏洞利用向量
- **AND** 不引入新的渲染回归
