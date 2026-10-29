// 启动阶段打点：CI 上 effect 模式曾 30 分钟零输出（banner 未打印），用 boot 行区分
// 卡在 bun/import 阶段还是 main 初始化阶段。
console.log(`[boot] script entry ${new Date().toISOString()}`)
await import("../test/server/httpapi-exercise/index")
