# 设计

## 变更范围

只改两个测试文件的 mock 对象，不涉及源码。

## bootstrap.test.ts 修复

两处 `v2` mock 加 `session.active`：

```ts
// 第 70 行 和 第 116 行的 v2 mock 各加：
v2: {
  agent: { ... },
  command: { ... },
  reference: { ... },
  session: { active: async () => ({ data: { data: {} } }) },  // 新增
}
```

`session.active` 返回空对象即可（表示无活跃会话），测试不依赖具体活跃会话。

## workspace-data.test.ts 修复

`createDeps` 中的 `client` mock 从 `session: { list, create, prompt }` 改为 `v2: { session: { list, create, prompt } }`：

```ts
const sdk = (() => ({
  directory: "dir-1",
  client: {
    v2: {  // 原 session 字段改为 v2.session
      session: {
        list: async (args?: unknown) => { ... },
        create: async () => { ... },
        prompt: async (args: { sessionID: string; parts: { type: string; text: string }[] }) => { ... },
      },
    },
  },
})) as unknown as ReturnType<typeof useSDK>
```

## 验证

- `bun run test:unit` 中 bootstrap 和 workspace-data 相关用例通过
- CI 上 `app#test` 不再报 `undefined is not an object`
