# Spec Delta

## ADDED Requirements

### Requirement: 旧版本技法表自动迁移
书库或全局技法库的 techniques 表缺少当前 schema 的列(如 `scope`)时,系统 MUST 在访问前自动补齐缺失列(幂等迁移):全部存量行保留,新列取 schema 缺省值;重复迁移 MUST NOT 产生重复数据或报错。迁移失败时按技法库故障路径静默降级为空候选,不得向用户暴露 `no such column` 类错误。

#### Scenario: 旧表书库的面板与召回恢复可用
- **WHEN** 某书库的 techniques 表缺少 `scope` 列(历史版本建表)
- **THEN** 首次访问前自动补齐缺失列,技法面板正常列出该书技法,写作召回正常返回候选

#### Scenario: 迁移幂等且保数据
- **WHEN** 迁移执行成功后再次访问同一书库
- **THEN** 不产生重复列、不丢失任何存量技法行,行数据与迁移前一致

#### Scenario: 迁移失败静默降级
- **WHEN** 迁移因存储异常失败
- **THEN** 写作流水线按空候选继续,界面显示可理解的错误提示,不出现缺列报错
