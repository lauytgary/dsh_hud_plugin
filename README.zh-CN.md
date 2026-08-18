<div align="center">

[**English**](README.md) · **简体中文**

</div>

# dsh-stats-hud

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打造的科幻风格 HUD：把会话的实时统计数据变成游戏风格的经验条，以**固定在 Web 界面最右侧边缘的垂直竖栏**形式呈现——完全不改动原有的统计行。

![截图](docs/screenshot.png)

## 仪表（全英文、LLM 术语）

| 仪表 | 数据 | 满量程 | 超出满量程 |
| --- | --- | --- | --- |
| `CLOCK` 徽章 | 本地时间（24 小时制）+ `DS API PEAK` / `DS API OFF PEAK` 时段标识 | 高峰时段 = 北京时间 09:00-12:00 / 14:00-18:00（自动按本地时间换算） | PEAK 呈橙色、OFF PEAK 呈绿色 |
| `STEPS / TURN` 滚动行 | 步骤 / 回合数，以里程表滚筒样式滚动（类似 CONTEXT 行） | — | 挂载时滚筒旋转启动，数值变化时滚动 |
| `LLM / TOOLS` 双栏 | 两列（标签在上、数值在下），条形分段 = LLM:TOOLS 原始时间占比 | 无上限——2:1 的时间比就显示 2:1 的条 | — |
| `THROUGHPUT` 仪表盘 | tokens/s（吞吐量），标题居中，组合读数居中（`146 tok/s`） | 红线自动缩放 200→300→400…（弧形刻度随之变化） | — |
| `CONTEXT USAGE` 条 | 上下文窗口使用百分比，3 段：系统提示（灰）/ 工具（蓝）/ 消息（紫），按 token 占比 | 0-100% | ≥80% 整条变实心红；悬停显示三个 token 数 |
| `CACHE HIT` 条 | 缓存命中百分比 | 0-100% | <50% 红、<80% 黄、≥80% 绿 |
| `CONTEXT` 滚动计数器 | 三行里程表：CACHE HIT（绿）/ CACHE MISSED（橙）/ OUTPUT（粉） | 挂载时滚筒从 0 开始旋转；数字增加时向上滚动（9→0 进位），减少时向下滚动 | — |

Agent 运行期间，整个面板会「呼吸」起伏，进度条随之脉动。

## 响应式布局

HUD 会根据聊天栏右侧的可用空间自适应（通过 ResizeObserver 实时测量，因此拖拽侧栏、打开详情抽屉、调整窗口大小都会生效）：

| 档位 | 条件（可用空间） | 显示内容 |
| --- | --- | --- |
| `full` | ≥ 200px | 全部内容 |
| `mini` | ≥ 90px | 时钟（短版 PEAK/OFF PEAK 徽章）+ 紧凑滚动行（Step/Turn/HIT/MISS/OUT） |
| `hidden` | < 90px | 不显示（元素保持挂载，`display:none`） |

## 环境要求

- DeepSeek Harness `dsh`（已在 0.1.0-rc.6、macOS 上测试）
- pnpm（用于插件管理）

## 安装

```sh
# 从本地仓库安装
dsh plugin --profile web add /path/to/dsh-stats-hud

# 或直接从 GitHub 安装
dsh plugin --profile web add https://github.com/lauytgary/dsh_hud
```

然后**重启 `dsh web`**（加载器条目在启动时扫描）并刷新页面。该插件以 `link:` 依赖方式安装——在本地修改 `lib/client.js` 后只需重启，无需重新安装。

## 卸载

```sh
dsh plugin --profile web remove dsh-stats-hud
```

## 工作原理

- 注册到 `conversation.composer.dock` 插槽（id `dsh-stats-hud`，顺序 1）——**只是为了拿到会话作用域的 hooks**（`useSession` / `useProjection`）；面板本身是 `position: fixed`，不占用布局空间，原有统计行保持不变。
- 数据来自与原生界面相同的投影：`useProjection("sessionStats")`、`useProjection("tokenUsage")`、`useProjection("contextPressure")` 和 `useProjection("contextBreakdown")`——宿主端零改动。
- `exports.inject = ["slots"]` 是必需的：DSH 的 ctx 是严格代理，访问未声明的服务会抛错（`cannot get property "locale" without inject`）。
- 面板是 `pointer-events: none`（点击穿透）；只有 CONTEXT USAGE 条重新启用了指针事件，以便悬停提示生效。

## 文件结构

```
dsh-stats-hud/
├── package.json          # dsh.bundle（补丁层）+ dsh.client（浏览器入口）
├── cordis.patch.yml      # 将插件插入加载器条目
└── lib/
    ├── index.js          # 宿主端无操作（纯浏览器插件）
    └── client.js         # 浏览器打包：HUD 组件 + 插槽注册
```

`lib/client.js` 是手写的加载器打包文件（`window.__ModuleLoader__.load`）——无需构建步骤。

## 参数调优

所有常量都在 `lib/client.js` 中：

- 标签：`L` 对象（全英文 LLM 术语）
- 高峰时段：`LocalClock` 的 `bjMin >= 540 && bjMin < 720`（北京时间 9-12 点）和 `>= 840 && < 1080`（14-18 点），其中 `bjMin = ((now.getTime() + 8*3600e3) / 60000) % 1440`
- `MissionRolling`：步骤 / 回合的滚动滚筒（无满量程）
- `ChannelBar`：分段比例 = `llmMs / (llmMs + toolMs)`（无上限）
- `SpeedGauge` 的 `redline = 200`（初始值；`while (tps > redline) redline += 100` 自动缩放）
- `ContextUsageBar`：分段颜色和 ≥80% 实心红阈值；悬停提示从 `contextBreakdown` 投影读取 `systemTokens` / `toolsTokens` / `messageTokens`
- 滚动计数器：`DRUM`（3× 0-9）、`DRUM_H = 15`（每位数像素）、`RollingValue` 的进位 / 借位公式以及挂载时的旋转启动
- CSS：`position:fixed; right:12px`；档位在 `tierOf(space)` 中（`≥200` full / `≥90` mini / 其余 hidden）以及 `.gsh-root.gsh-*` 规则

## 发布到 npm（可选）

```sh
# 先移除 package.json 中的 "private": true，然后
npm publish
# 用户安装方式：
dsh plugin --profile web add dsh-stats-hud
```

## 许可证

MIT
