# x-pm

> 一个命令，统一 npm / pnpm / bun / yarn。

![CI](https://github.com/hanqindylan/x-pm/actions/workflows/ci.yml/badge.svg)

![license](https://img.shields.io/badge/license-MIT-blue.svg)

`x` 会自动识别你项目里用的包_manager（看锁文件和 `packageManager` 字段），然后把命令翻译成对应的那一个。你不用再记「这个项目该敲 npm 还是 pnpm」。

## 特性 官方源超时

- **搜得到也找得到**：远程搜包 + 本地已装包检索 + 精确到可执行文件路径
- **统一 npx**：`xgo` 一个命令替代 `npx` / `pnpm dlx` / `yarn dlx` / `bun x`
- **不擅自提权**：任何情况下都不会自动 `sudo`，除非你显式要求
- **跨平台**：macOS / Linux / Windows

## 安装

需要 Node.js >= 18.18。

```bash
git clone https://github.com/hanqindylan/x-pm.git
cd x-pm
npm install
npm run build
npm link
```

装完之后 `x` 和 `xgo` 就是全局命令了。

在别的电脑上装（或者分享给别人）：

```bash
npm i -g github:hanqindylan/x-pm
```

卸载：

```bash
npm unlink -g x-pm
```

## 快速开始

```bash
x i                      # 安装依赖（自动选包管理器）
x a axios lodash         # 添加依赖
x a -D typescript        # 添加开发依赖
x dev                    # 直接跑 package.json 里的 script
x search react           # 搜包（默认国内源）
x where eslint           # 定位包和可执行文件
xgo cowsay hi            # 等价于 npx / pnpm dlx / bun x / yarn dlx
```

## 命令对照表

| x 命令              | npm                    | pnpm                  | yarn                  | bun                 |
| ----------------- | ---------------------- | --------------------- | --------------------- | ------------------- |
| `x i`             | `npm install`          | `pnpm install`        | `yarn install`        | `bun install`       |
| `x a axios`       | `npm install axios`    | `pnpm add axios`      | `yarn add axios`      | `bun add axios`     |
| `x a -D ts`       | `npm install -D ts`    | `pnpm add -D ts`      | `yarn add -D ts`      | `bun add -D ts`     |
| `x r lodash`      | `npm uninstall lodash` | `pnpm remove lodash`  | `yarn remove lodash`  | `bun remove lodash` |
| `x up`            | `npm update`           | `pnpm update`         | `yarn upgrade`        | `bun update`        |
| `x ls`            | `npm ls --depth=0`     | `pnpm list --depth=0` | `yarn list --depth=0` | `bun ls`            |
| `x run dev`       | `npm run dev`          | `pnpm run dev`        | `yarn run dev`        | `bun run dev`       |
| `x dev`           | 同上                     | 同上                    | 同上                    | 同上                  |
| `x exec eslint .` | `npm exec -- eslint .` | `pnpm exec eslint .`  | `yarn exec eslint .`  | `bun x eslint .`    |
| `xgo cowsay hi`   | `npx cowsay hi`        | `pnpm dlx cowsay hi`  | `yarn dlx cowsay hi`  | `bun x cowsay hi`   |

别名：`i`=install、`a`=add、`r`=remove、`up`=update、`ls`=list、`s`=search、`f`=find。

**所有未知参数原样透传**，所以下面这些都能用：

```bash
x i --legacy-peer-deps
x a axios --save-exact
x dev --port 3000
```

`--` 之后的内容也一律透传：`x a axios -- --pm`。

## 命令

### 包管理

```bash
x i                # 安装全部依赖
x i --frozen-lockfile
x a axios lodash   # 一次加多个
x a -D eslint      # 开发依赖
x r axios
x up
x ls
```

### 搜索与查找

`x search` 远程搜：

```bash
x search react                 # 默认国内源
x search react --source npm    # 切官方源
x search react --limit 20
x search react --where         # 顺带显示本地/全局路径
x search react --json          # 机器可读
```

输出：

```
源: registry.npmmirror.com    当前项目: npm

┌───────────┬────────┬────────────────────────────────────┬──────────────┐
│ 包名      │ 版本   │ 描述                               │ 发布者       │
├───────────┼────────┼────────────────────────────────────┼──────────────┤
│ react     │ 19.3.1 │ React is a JavaScript library for… │ GitHub Actions│
└───────────┴────────┴────────────────────────────────────┴──────────────┘

安装：x a react
```

`x find` 在本地已装的包里模糊搜：

```bash
x find eslint              # 本地 + 全局
x find eslint --local
x find eslint --global
x find --bin                # 只看带可执行文件的包
x find --deep               # 递归扫描（大仓库慢）
x find eslint --json
```

默认只扫顶层和 `@scope` 一层，不递归；结果按 `node_modules` 的 mtime 缓存，装了新包缓存自动失效。

`x where` 精确定位：

```bash
x where eslint
x where eslint --bin        # 只打印路径，方便管道
x where eslint --local
```

```
eslint  (来源: pnpm-lock.yaml)

├─ 包目录
  本地:   /repo/node_modules/eslint
│
├─ 可执行文件
  本地:   /repo/node_modules/.bin/eslint
│
└─ 元信息
  版本:   9.17.0
  来源:   pnpm
  主页:   https://eslint.org
```

`x where` 可以直接进管道：

```bash
echo $(x where eslint --bin | head -1)
```

### xgo

统一 `npx` / `pnpm dlx` / `yarn dlx` / `bun x`。执行顺序：

1. 本地 `node_modules/.bin/<cmd>` 有 → 直接用本地的
2. `PATH` 里有 → 直接用
3. 都没有 → 交给当前包管理器的 dlx

```bash
xgo cowsay hi
xgo --pm pnpm vite --host
xgo rm-rf                      # 显式要求 sudo
```

### sudo 规则

`x` **永远不会**自动加 `sudo`。只有两种情况会提权：

1. 你显式传了 `--sudo`
2. 执行失败且报错里有 `EACCES` / `permission denied`，并且你在提示里回答了 `y`

非交互环境（CI、管道）会直接跳过提问，不会挂住。

### 切换包管理器

```bash
x use pnpm
```

会往 `package.json` 写入 `packageManager` 字段（最高优先级），并提示你清理旧锁文件。`x` 不会自动删你的锁文件。

## 配置 `.xrc.json`

放在项目根目录（也可以放在上层目录，`x` 会向上找）：

```json
{
  "registry": "https://registry.npmmirror.com",
  "defaultPM": "pnpm",
  "searchLimit": 10,
  "aliases": {
    "s": "search",
    "f": "find"
  }
}
```

| 字段            | 说明                |
| ------------- | ----------------- |
| `registry`    | 搜索用的源             |
| `defaultPM`   | 锁文件缺失时的兜底包管理器     |
| `searchLimit` | `x search` 默认返回条数 |
| `aliases`     | 自定义命令别名           |

配置文件里写错的字段会被忽略并给一条警告，不会让命令整个跑不起来。

## 包管理器检测规则

从高到低：

1. `--pm <npm\|pnpm\|bun\|yarn>` 显式指定
2. `package.json` 的 `packageManager` 字段
3. `package-lock.json` / `npm-shrinkwrap.json` → npm
4. `pnpm-lock.yaml` → pnpm
5. `bun.lockb` / `bun.lock` → bun
6. `yarn.lock` → yarn
7. `.xrc.json` 的 `defaultPM`
8. 都没有 → npm

每次执行都会在 stderr 打印一行，比如：

```
[x] 检测到 pnpm-lock.yaml，使用 pnpm
```

## 国内源说明

`x search` **默认走国内源** `https://registry.npmmirror.com`，因为官方源在国内经常超时。

优先级从高到低：

1. 命令行 `--source npm` / `--source cn` / `--source <URL>`
2. `.xrc.json` 的 `registry`
3. 环境变量 `X_REGISTRY`
4. 默认国内源

```bash
x search react --source npm      # 临时用官方源
export X_REGISTRY=https://registry.npmmirror.com   # 整个会话都用它
```

## 开发

```bash
npm install
npm run dev      # tsx 直接跑 src/index.ts
npm run lint     # tsc --noEmit
npm test         # vitest
npm run build    # tsup 打包到 dist/
```

改了代码之后：

```bash
npm run build && x --help
```

## Roadmap

- [ ] 交互式初始化 `x init`
- [ ] `x doctor`：体检当前项目的包管理器环境
- [ ] 支持 workspace 批量执行
- [ ] Shell 补全脚本

## License

[MIT](./LICENSE) © hanqindylan
