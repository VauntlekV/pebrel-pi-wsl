# pebrel-pi-wsl

标准 Pi extension package：在 Pebrel 的 WSL 终端中，把 Pi 会话与运行事件送给 Pebrel。
纯 TypeScript / Node.js 内置模块；不需要 Python、外置 helper、安装脚本、后台服务或模型调用。
不是 Pebrel 官方发布的集成。

## 安装

推荐安装固定版本：

```bash
pi install git:github.com/VauntlekV/pebrel-pi-wsl@v0.1.0
pi
```

也可以安装仓库默认分支：

```bash
pi install git:github.com/VauntlekV/pebrel-pi-wsl
```

不需要 Python、npm install 或额外执行初始化命令。Pi 会把 package 注册到自己的 settings，
并在后续启动时自动加载。用 `pi list` 查看，或用 `pi config` 启用/禁用。
固定 Git 标签不会随默认分支更新；升级时选择新的版本标签。

本包通过 Git 分发，尚未发布到 npm，不要使用一个尚不存在的 npm 安装源。
开发者也可以安装本地目录：`pi install /实际路径/pebrel-pi-wsl`；本地来源不会被复制，请保留该目录。

已有 Pi 会话需任务结束后 `/reload`；全新启动不需要 `/reload`。

## 运行条件

- 在 Linux WSL 中运行 Pi，并且这个终端由 Pebrel 打开。
- Pebrel AI hook 功能已启用，终端提供有效 pane ID 和远端 hook token。
- 兼容目标是 Pebrel 2.1.1、Pi 1.0.0、Debian WSL2；自动测试与 Windows GUI 验收的边界见下文。
- 不在其他终端中全局发送通知；缺少上述任一作用域条件时不发送。

不修改 Windows 文件、shell 配置、Pi 认证文件，也不向模型注册工具或增加系统提示词。
扩展自身不安装、复制或下载任何辅助程序。

## 原理

```text
Pi 生命周期事件 → extension → /dev/tty 上的认证 OSC → Pebrel 的现有 hook 接收器
```

`session_start` 上报原生会话身份，`agent_start` 上报运行，`tool_result` 上报工具完成；
等待 `agent_settled` 才上报本轮结束，并保留真实 stop_reason。`session_shutdown` 上报退出。
不是观察屏幕、轮询文件或根据输出停顿猜测完成。

会话文件只读取不超过 16 KiB 的开头以验证第一行身份；只有与原生 session ID 一致才报告文件路径。
不发送提示词、回答正文、工具内容或 provider 错误正文。消息仍包含会话 ID、路径、工作目录、顺序和结束原因，
因此不要把它当作不含任何元数据的匿名通知。

每条终端发送最多尝试 150 ms，单个 Pi 进程内串行发送，不启动子进程。
完整 OSC 尽量用一次非阻塞 write 写入；发生部分写入时立即尝试取消，不跨等待恢复部分消息。
错误、没有控制终端或终端拥塞时放弃发送，不让通知错误改变 Pi 任务结果。
这不是可确认/重传的消息总线；发送成功不能单独证明 Windows toast 已显示。
不与其他独立程序建立跨进程共享锁，因此不承诺同一 PTY 上任意其他写入者之间的原子性。

## 安装边界

本包不扫描其他扩展，不识别或兼容其他 bridge，也不执行迁移或卸载其他软件。
多个本包实例只允许一个上报；正常 shutdown/reload 会释放并重新取得实例所有权。
请只启用一套针对 Pi 的 Pebrel 通知集成，避免重复上报；其他无关 Pi 扩展可正常共存。

## 禁用 / 卸载

用 `pi config` 禁用本包扩展，或者移除安装来源：

```bash
pi remove git:github.com/VauntlekV/pebrel-pi-wsl@v0.1.0
```

请移除自己实际安装的来源；安装默认分支或本地目录时，使用对应的来源。
然后重启 Pi 或 `/reload`。本包没有安装到其他位置的 helper 或遗留服务，通常不需要额外清理。
Pi 的会话文件仍由 Pi 自己管理，不会被删除。

当 Pebrel 官方支持 WSL Pi 时，请移除此兼容包，避免两套上报。

## 验证与用户验收

自动测试覆盖真实 Pi 1.0.0 的 package 管理与加载器，并用真实 Pi CLI 的 RPC 启动/退出验证自动加载，
不发送模型请求。运行、重试、并发和完成事件通过真实加载后的扩展 handler 与模拟事件验证，
消息写入隔离的真实 PTY，不使用真实 Pebrel token。

2026-10-02，本机迁移到此 package 后，用户实际使用测试并反馈“测试没问题”。
这属于本机使用验收，不代表其他版本或发行版已验证；具体逐项覆盖未单独记录。
其他用户仍应按下面的清单检查 Windows 通知、侧栏与正常关窗。

安装后在 Pebrel 的 WSL 终端中：

1. 启动 Pi，确认无扩展加载错误。
2. 执行简单任务，确认对应 pane 的运行/完成状态正确。
3. 将 Pebrel 切至后台，再完成任务，确认通知符合 Pebrel 的通知策略。
4. Pi 空闲时正常关闭窗口，确认没有“AI 会话未能识别”的等待与弹窗。
5. 检查其他终端没有收到错误上报，不要通过强杀工作中的任务验收关闭。

## 开发测试

运行需要 Node 22.19+ 和已安装的 Pi。真实 PTY 测试使用 Linux 的 `script`（util-linux），仅为测试工具。

```bash
npm test
```

测试使用隔离 HOME/agent/settings 和固定虚拟 token；覆盖真实 `pi install/list/remove`、自动发现、
真实 Pi 扩展加载器、隔离 PTY、生命周期、重试、并发、reload、重复实例、其他扩展共存、元数据与错误边界。
不访问模型、不读取用户凭据、不操作 Windows GUI。

生成 npm 标准发布文件：

```bash
npm pack --ignore-scripts
```

## 许可证

GPL-3.0-only。事件适配器基于 Kuddev/pebrel v2.1.1；详见 `NOTICE` 和 `LICENSE`。
