# pebrel-pi-wsl

让 Pebrel 识别 WSL 中的 Pi 会话，同步任务运行状态，并显示任务完成通知。

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
- **任务完成**：上报结束原因，由 Pebrel 处理完成通知。
- **会话退出**：结束对应的会话状态。

通知行为遵循 Pebrel 的通知设置。

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

## 工作方式

扩展订阅 Pi 生命周期事件，通过 WSL 终端的认证 OSC 通道将会话和任务信息传给 Pebrel。
任务完成以 `agent_settled` 为边界，覆盖自动重试和后续执行。

实现使用 TypeScript 和 Node.js 内置模块。

## 开发

测试环境需要 Node.js 22.19+、Pi 和 `script`（util-linux）。

```bash
npm test
```

测试涵盖包管理、自动加载、会话身份、事件顺序、并发及终端传输。

## 许可证

GPL-3.0-only。事件适配器基于 Kuddev/pebrel v2.1.1，详见 `NOTICE` 和 `LICENSE`。
