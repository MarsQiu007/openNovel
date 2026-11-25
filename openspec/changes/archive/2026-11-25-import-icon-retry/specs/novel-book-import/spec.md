# Spec Delta

## ADDED Requirements

### Requirement: 导入文件选择图标呈现

书籍导入的文件选择入口 SHALL 呈现已注册的文件图标，MUST NOT 因图标名未注册而渲染为空白占位。

#### Scenario: 文件选择区渲染图标

- **WHEN** 用户进入书籍导入的文件选择区
- **THEN** 文件选择按钮内呈现可见文件图标，控制台不出现该图标未注册的开发期告警
