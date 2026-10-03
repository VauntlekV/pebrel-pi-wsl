# pebrel-pi-wsl

让 Pebrel 识别 WSL 中的 Pi 会话，同步任务运行状态，并显示等待输入和任务完成通知。

## 安装

在 Pebrel 中启用 AI hook 功能，然后在 Pebrel 的 WSL 终端中安装：

```bash
pi install git:github.com/VauntlekV/pebrel-pi-wsl@v0.1.0
```

启动 Pi，扩展会自动加载：

```bash
pi
```

如果 Pi 已在运行，任务结束后执行 `/reload`。

已验证环境：Pebrel 2.1.1、Pi 1.0.0、Debian WSL2。

## 使用

扩展自动同步以下事件：

- **会话开始**：向 Pebrel 提供 Pi 的会话身份。
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
pi remove git:github.com/VauntlekV/pebrel-pi-wsl@v0.1.0
```

调整扩展后，重启 Pi 或执行 `/reload`。

若使用上面的固定 `v0.1.0` Git 安装，它不会自动获取本地源码修复。要使用当前工作区版本，在仓库根目录执行：

```bash
pi remove git:github.com/VauntlekV/pebrel-pi-wsl@v0.1.0
pi install ./pebrel-pi-wsl
```

若原安装源不同，请移除对应的旧来源，避免同时加载两个桥接实例。安装后在已运行的 Pi 中执行 `/reload`，或重启 Pi。

## 工作方式

扩展订阅 Pi 生命周期事件，通过 WSL 终端的认证 OSC 通道将会话和任务信息传给 Pebrel。
任务完成以 `agent_settled` 为边界，覆盖自动重试和后续执行。
等待输入订阅 Pi 原生 `ui_prompt_start` / `ui_prompt_end`，通过现有 `attention` 事件通知 Pebrel；等待期间不会因其他并行工具完成而提前清除状态，不将提问误报为任务完成。

实现使用 TypeScript 和 Node.js 内置模块。

## 开发

测试环境需要 Node.js 22.19+、Pi 和 `script`（util-linux）。

```bash
npm test
```

测试涵盖包管理、自动加载、会话身份、事件顺序、并发及终端传输。

## 许可证

GPL-3.0-only。事件适配器基于 Kuddev/pebrel v2.1.1，详见 `NOTICE` 和 `LICENSE`。
