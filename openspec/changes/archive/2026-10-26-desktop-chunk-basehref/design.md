# Design：映射基前缀注入

## D1：注入 `OPENNOVEL_BUNDLED_BASE`

`core/src/config/plugin/external.ts` 顶部加：

```ts
declare const OPENNOVEL_BUNDLED_BASE: string | undefined
```

`bundledEntry` 内：

```ts
const base = typeof OPENNOVEL_BUNDLED_BASE === "undefined" ? "" : OPENNOVEL_BUNDLED_BASE
return new URL(base + chunk, baseHref).href
```

## D2：桌面端注入 `"../"`

`electron.vite.config.ts` 的 `main.define` 加**顶层常量**（与 core `declare const` 匹配，非 `import.meta.env.`）：

```ts
OPENNOVEL_BUNDLED_BASE: JSON.stringify("../"),
```

electron-vite/rollup define 会文本替换 core 产物中的 `OPENNOVEL_BUNDLED_BASE` 标识符。`import.meta.url` 在 `chunks/node-*.js` 时深度为 1，`"../"` 回到 `out/main/` 再拼 `./plugin-bundle/<name>.js` 得正确绝对 URL。

## D3：dist/node 无注入 → 空串 → 原行为

`build-node.ts` 不注入 `OPENNOVEL_BUNDLED_BASE`；`typeof` 守卫为 undefined → `base = ""` → 路径不变，纯 Node 宿主行为完全保留。

## D4：为什么不改映射值为 `"../plugin-bundle/..."`

映射值由 `bundled-plugins.ts` 单一来源生成，dist/node 与桌面端共用。若改成 `"../plugin-bundle/..."`，dist/node 下 `node.js` 在 outdir 根，解析会跳到 outdir 之外。注入基前缀是**按宿主布局分别修正**的唯一正确做法。

## 验证

- 桌面构建后 grep `out/main/chunks/node-*.js` 中 `new URL("../" + chunk` 形态；
- 用 Node 脚本模拟 `import.meta.url = file:///...out/main/chunks/node-*.js`，验证 `new URL("../" + "./plugin-bundle/novel-writer-v2.js", base).href` 指向 `out/main/plugin-bundle/novel-writer-v2.js`；
- dist/node 产物 grep 不到 `OPENNOVEL_BUNDLED_BASE`，行为不变。
