# Termux MCP Server

这是一个基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的 Termux 系统管理服务器。它允许 AI Agent (如 Claude) 直接与你的 Android 设备上的 Termux 交互，执行文件操作、终端命令等任务。

## 功能特性

- **文件系统操作**: 支持读取 (`read_file`) 和 写入 (`write_to_file`) 文件，支持 `~` 路径解析。
- **系统命令执行**: 可以通过 `execute_command` 运行任何 Termux 终端命令。
- **双模式运行**:
  - **Stdio**: 适用于传统的 MCP 集成。
  - **SSE (Server-Sent Events)**: 适用于 Web 端的实时通信，并支持跨域 (CORS)。
- **服务自动发现**: 集成了 Bonjour (mDNS)，在局域网内自动广播服务。

## 安装与启动

### 环境要求

- Node.js (建议 v16+)
- Termux on Android

### 安装依赖

```bash
npm install
```

### 启动服务

#### 1. SSE 模式 (默认)
```bash
node index.js
```

#### 2. Stdio 模式 (提供 HTTP 接口)
```bash
node index.js --stdio
```
*默认端口为 3000，可通过环境变量 `PORT` 修改。*

## 提供的工具 (Tools)

- `ead_termux_file`: 读取指定路径的文件内容。
- `edit_file`: 写入内容到指定文件（自动创建不存在的目录）。
- `execute_command`: 在 Termux 上执行 Shell 命令。

## 开源协议

MIT
