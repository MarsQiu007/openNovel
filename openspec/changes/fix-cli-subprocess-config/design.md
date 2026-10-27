# 设计

## 根因探明

### 配置链路

1. `cli-process.ts` 写入 `home/.config/opennovel/opennovel.json`（test provider 配置）
2. 子进程通过 `Bun.spawn` 启动，`env` 中设 `XDG_CONFIG_HOME=home/.config`
3. core `global.ts` 第 13 行 `const config = path.join(xdgConfig!, app)` 计算全局配置目录
4. `xdg-basedir` 在**模块加载时**读 `env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')`
5. core `config.ts` 第 173 行 `globalDirectory = AbsolutePath.make(global.config)` 加载全局配置

### 可疑点

- `xdg-basedir` 的 `os.homedir()` 在 Linux 上读 `HOME` 环境变量
- bun 1.3.14（CI）vs bun 1.4.3（本地）可能对模块加载顺序或环境变量传递有不同行为
- `test/preload.ts` 设置了 `XDG_CONFIG_HOME`，`cli-process.ts` 的 `isolatedEnv` 覆盖它，但 `extendEnv: true` 的合并顺序是否正确？

### 修复方向

1. **首选**：在 `cli-process.ts` 中加调试日志，CI 中打印子进程实际读到的 `global.config` 路径和配置文件内容
2. **可能修复**：确保 `isolatedEnv` 中的 `XDG_CONFIG_HOME` 在子进程模块加载前生效
3. **备选**：在 `global.ts` 中改用 `Path.home` 派生 config 路径（而非依赖 `xdg-basedir` 的模块级缓存）

## 验证

- CI 中 4 个 cli 子进程测试通过
- 本地测试不回退
