# pebrel-pi-wsl

让 Pebrel 识别 WSL 中的 Pi 会话，同步任务运行状态，并显示等待输入和任务完成通知。

## 安装

在 Pebrel 中启用 AI hook 功能，然后在 Pebrel 的 WSL 终端中安装：

```bash
pi install git:github.com/VauntlekV/pebrel-pi-wsl
```

启动 Pi，扩展会自动加载：

```bash
pi
```

如果 Pi 已在运行，任务结束后执行 `/reload`。

已验证环境：Pebrel 2.1.1、Pi 1.0.0、Debian WSL2。

## 使用

扩展自动同步以下事件：

- **会话开始**：上报会话状态；原生会话文件落盘并校验后，才向 Pebrel 提供可恢复的会话身份。
- **任务运行**：更新运行和工具完成状态。
- **等待输入**：agent 通过提问扩展（如 `ask_user_question`）或其他阻塞式 UI 等待选择、输入时，上报需要用户关注；回答或取消后恢复运行状态。
- **任务完成**：上报结束原因，由 Pebrel 处理完成通知。
- **会话退出**：结束对应的会话状态。

通知行为遵循 Pebrel 和操作系统的通知设置。切换到其他程序、Pebrel 窗口不在前台时，等待输入事件走 Pebrel 的系统通知通道，提醒返回回答；通知不包含问题正文或用户答案。等待输入通知使用简短标签，例如 `Ask_Questions[workbench] · Pane 9 · Pi正在等待选择或输入。`；方括号内仅为 Pi 启动目录名，不显示 `/home/…` 前缀。`Pane 9` 由 Pebrel 自动附加，真实工作目录仍原样传递。

等待输入通知需要 Pi **0.84.4+**（提供 `ui_prompt_start` / `ui_prompt_end`）。较旧版本仍保留原有任务完成通知，但不支持此等待输入提醒。

## 管理

```bash
# 查看已安装的包
pi list

# 启用或禁用扩展
pi config

# 卸载
pi remove git:github.com/VauntlekV/pebrel-pi-wsl
```

安装来源不固定标签或提交，使用仓库默认分支的最新代码。后续更新已安装的扩展：

```bash
pi update --extensions
```

更新后，重启 Pi 或执行 `/reload`。

若此前安装时指定了版本标签，请先移除旧的安装来源，再使用上面的无版本命令重新安装；已安装的固定来源不会因 README 修改而自动切换。

## 工作方式

扩展订阅 Pi 生命周期事件，通过 WSL 终端的认证 OSC 通道将会话和任务信息传给 Pebrel。
任务完成以 `agent_settled` 为边界，覆盖自动重试和后续执行。
等待输入订阅 Pi 原生 `ui_prompt_start` / `ui_prompt_end`，通过现有 `attention` 事件通知 Pebrel；等待期间不会因其他并行工具完成而提前清除状态，不将提问误报为任务完成。

实现使用 TypeScript 和 Node.js 内置模块。

## 会话恢复与空会话

Pi 在启动时分配会话 ID，但通常到第一条用户消息时才创建会话文件。扩展仅在原生 JSONL 文件存在、首行元数据校验通过后上报 `session_id` 和 `session_file`，避免 Pebrel 保存无法恢复的临时 ID。首条消息落盘后，后续事件会自动补上身份；此前的运行状态上报不受影响。未持久化模式（`--no-session`）也只上报状态，不提供恢复身份。

重启实测（Pebrel 2.2.2、Pi 1.3.0、Ubuntu WSL2）：

- **已有对话的会话**：保持 Pi 打开，正常退出并重启 Pebrel 后，对话可以自动恢复。
- **空会话**：仅启动 `pi`、未发送消息，重启后只能恢复工作目录，不能重新打开 Pi。此问题作为已知限制记录，暂不修复。

如果旧版扩展已将临时 ID 保存为恢复目标，失败的恢复目标还可能阻止同一窗格中后来启动的 Pi 上报状态。升级扩展不能清除 Pebrel 内存中的旧目标：请先退出旧 Pi、关闭异常窗格，再新建 WSL 窗格；需要保留已有对话时，用 `pi --session <会话文件或 ID>` 恢复。不要只在原异常窗格里重新启动 Pi。扩展不会修改或删除会话历史。

## 开发

测试环境需要 Node.js 22.19+、Pi 和 `script`（util-linux）。

```bash
npm test
```

测试涵盖包管理、自动加载、会话身份、事件顺序、并发及终端传输。

## 许可证

GPL-3.0-only。事件适配器基于 Kuddev/pebrel v2.1.1，详见 `NOTICE` 和 `LICENSE`。
