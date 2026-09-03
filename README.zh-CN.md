[English](README.md) | 简体中文

# pi-submodel

一个 Pi 扩展，注册 `/submodel` 命令：一个键盘优先的双栏 TUI，用于编辑用户级设置文件（`~/.pi/agent/settings.json`）里原生的 `pi-subagents` 模型策略——默认子代理模型、每个代理的主模型、thinking 级别、有序 fallback 路由。不用手改 JSON，也绝不碰父会话的模型。

## 兼容性

- 只针对 `nicobailon/pi-subagents` **0.64.x**。检测到其他版本会明确报错并拒绝打开，不会写入任何设置。如果没检测到 pi-subagents，编辑器仍会打开并按原生 0.64.x 的结构写入（附警告）。
- Pi 扩展 API 已在 Pi 0.84.4（`@earendil-works/pi-coding-agent`）上验证通过。
- 需要 Node >= 22。

## 安装

从 GitHub 安装（固定到 tag 或 commit ref）：

```
pi install git:github.com/bioShaun/pi-submodel@v0.1.0
```

包发布到 npm 之后：

```
pi install npm:pi-submodel
```

或从本地检出目录安装：

```
pi install /absolute/path/to/pi-submodel
```

然后运行 `/reload`（或重启 Pi），`/submodel` 命令即出现。要升级到更新的 ref，重新执行 `pi install git:github.com/bioShaun/pi-submodel@<new-ref>`；`pi update --extensions` 会把克隆同步到固定的 ref。

## 使用

运行 `/submodel`。两个窗格：

- **左侧——导航器。** `default` 条目、六个 pi-subagents 0.64 内置代理（`scout`、`researcher`、`worker`、`reviewer`、`oracle`、`delegate`），以及 `agentOverrides` 里已配置的其他名字。
- **右侧——编辑器。** 当前选中条目的聚焦编辑器。`default` 条目只有一个字段（默认模型）；代理有主模型、thinking、有序 fallback 路由三个字段。

它写入的就是 pi-subagents 的原生结构：

```json
{
  "subagents": {
    "defaultModel": "provider/default-model",
    "agentOverrides": {
      "worker": {
        "model": "provider/primary-model",
        "thinking": "high",
        "fallbackModels": [
          "provider/first-fallback",
          "provider/second-fallback"
        ]
      }
    }
  }
}
```

fallback 顺序按显示原样持久化；pi-subagents 在遇到可重试的 provider/model 失败时按此顺序尝试。

## 键盘操作

| 上下文 | 按键 | 动作 |
| --- | --- | --- |
| 导航器 | 上 / 下 | 选择条目 |
| 导航器 | Enter | 聚焦该条目的编辑器 |
| 导航器 | r | 重置选中角色（只删本编辑器管理的字段） |
| 导航器 | s | 打开保存预览 |
| 导航器 | Esc | 关闭编辑器（有未保存修改会先确认） |
| 编辑器 | 上 / 下 | 在字段之间移动 |
| 编辑器 | Enter | 打开该字段的选择器 |
| 编辑器 | a | 添加 fallback |
| 编辑器 | j / k | 高亮下一条 / 上一条 fallback |
| 编辑器 | d | 删除高亮的 fallback |
| 编辑器 | J | 把高亮的 fallback 下移 |
| 编辑器 | K | 把高亮的 fallback 上移 |
| 编辑器 | r | 重置选中角色（只删管理的字段） |
| 编辑器 | s | 打开保存预览 |
| 编辑器 | Esc | 退回导航器 |
| 选择器 | 输入 | 模糊过滤列表 |
| 选择器 | 上 / 下 | 选择 |
| 选择器 | Enter | 确认 |
| 选择器 | Esc | 取消 |
| 保存预览 | 上 / 下 / PageUp / PageDown | 滚动 |
| 保存预览 | Enter | 保存 |
| 保存预览 | Esc | 取消 |
| 放弃提示 | Enter | 放弃修改 |
| 放弃提示 | Esc | 继续编辑 |

所有上下文里 Ctrl+C 等价于 Esc；退格键编辑选择器的搜索词。

## 它编辑什么（以及保留什么）

本编辑器只拥有这些字段：

- `subagents.defaultModel`
- `subagents.agentOverrides.<name>.model`
- `subagents.agentOverrides.<name>.thinking`
- `subagents.agentOverrides.<name>.fallbackModels`

其他所有顶层设置、所有其他 `subagents` 字段、每个代理覆盖里的所有其他字段，保存时原样保留。

Inherit 语义：

- **Inherit** 默认模型：删除 `subagents.defaultModel`，pi-subagents 走自己的正常解析。
- **Inherit** 代理主模型：只删该代理的 `model`，thinking 和 fallbacks 不动。
- **Default** thinking：只删 `agentOverrides.<name>.thinking`。
- 清空的 fallback 列表：删除 `agentOverrides.<name>.fallbackModels`。
- 删除受管字段后若代理覆盖对象为空，该条目会被移除，连带清理因此变空的父对象。

Thinking 级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`，外加 **Default**（删除覆盖）。已有的显式 `"thinking": false` 原样保留；显式的 `"fallbackModels": false` 同样原样保留（可用 Reset 移除）。

## 安全性

- 所有编辑都先放在内存草稿里，直到你显式保存；取消则文件一个字节都不变。
- 保存前展示修改后 `subagents` JSON 的预览，需要你确认。
- 写入是原子的：同目录临时文件 + 重命名。新文件以私有权限（0600）创建；已有文件保留原权限位。
- 如果设置文件在 `/submodel` 打开后被外部修改（另一个 Pi 实例、手动编辑），保存会基于内容指纹拒绝写入。重新打开编辑器即可加载新文件。
- JSON 损坏或字段结构不兼容时，编辑器直接以明确错误拒绝打开，绝不猜测修复。
- 不在当前 registry 里的已配置模型会保留并标记 `(unavailable)`——绝不悄悄丢弃。
- 重复的 fallback、以及把主模型加进自己的 fallback 路由，都会被拒绝。

## 保存之后

1. 运行 `/reload`，让运行中的 Pi 加载新设置。
2. 用 `/subagents-models`（或 `/subagents-models <agent>` 查看单个角色）验证实际生效的映射。

## 不支持

- 项目级 `.pi/settings.json` 编辑
- 每会话的模型覆盖
- 运行时请求拦截或强制覆盖
- 修改父会话模型
- 编辑提示词、工具、技能、上下文继承、验收策略或禁用状态
- 按.provider 的 `agentOverridesByProvider`
- `modelScope`、`defaultProvider`、`defaultThinking`、`maxThinking`、`disableThinking`
- Provider、凭证或 registry 管理
- 用真实付费请求探测模型
- fallback 的执行本身——重试的触发与执行由 pi-subagents 负责
- `tintinweb/pi-subagents`
- 保留 JSON 注释（文件会重写为纯 JSON）
- 保存后自动 reload

## 开发

```
npm install
npm test          # node --test
npm run typecheck
```

架构：`src/index.ts` 是一层很薄的 Pi 适配器；实际行为都在可测试的命令 seam（`src/submodel/command.ts`）后面，测试用临时设置文件、假模型 registry 和可驱动的编辑器组件来驱动它。

## License

MIT —— 见 [LICENSE](LICENSE)。
