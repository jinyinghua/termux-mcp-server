const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec, spawn } = require("child_process");
const os = require("os");

/**
 * 配置项
 */
const PORT = process.env.PORT || 3000;
const MODE = process.argv.includes("--stdio") ? "stdio" : "sse";

// 创建 MCP Server 实例
const server = new Server(
  {
    name: "mac-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * 注册工具列表
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log("收到 ListTools 请求");
  return {
    tools: [
      {
        name: "read_termux_file",
        description: "读取文件内容 (支持绝对路径或相对于主目录的路径)",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径 (例如: ~/Desktop/test.txt)" },
          },
          required: ["path"],
        },
      },
      {
        name: "edit_file",
        description: "写入内容到文件或新建文件",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径" },
            content: { type: "string", description: "文件内容" },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "execute_shell_command",
        description: "在 Termux 上执行 shell 命令",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string", description: "shell 命令" },
          },
          required: ["command"],
        },
      },
    ],
  };
});

/**
 * 路径处理工具：支持 ~ 符号
 */
function resolvePath(filePath) {
  if (filePath.startsWith("~")) {
    // 在 Termux 环境中，直接使用环境变量 HOME
    const homeDir = process.env.HOME || os.homedir();
    return path.join(homeDir, filePath.slice(1));
  }
  return path.resolve(filePath);
}

/**
 * 处理工具调用
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  console.log(`执行工具: ${name}`, args);

  try {
    switch (name) {
      case "read_file": {
        const filePath = resolvePath(args.path);
        if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
        const content = fs.readFileSync(filePath, "utf-8");
        return { content: [{ type: "text", text: content }] };
      }

      case "write_to_file": {
        const filePath = resolvePath(args.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content, "utf-8");
        return { content: [{ type: "text", text: `成功写入到 ${filePath}` }] };
      }

      case "execute_command": {
        // 在 Termux 环境中执行命令
        return new Promise((resolve) => {
          // 使用 Termux 环境中的 shell 执行命令
          exec(args.command, {
            env: process.env,
            cwd: process.cwd()
          }, (error, stdout, stderr) => {
            if (error) {
              resolve({
                isError: true,
                content: [{ type: "text", text: `错误: ${stderr || error.message}` }],
              });
            } else {
              resolve({
                content: [{ type: "text", text: stdout || "执行成功，无输出。" }],
              });
            }
          });
        });
      }

      default:
        throw new Error(`未知的工具: ${name}`);
    }
  } catch (error) {
    console.error(`工具执行失败: ${error.message}`);
    return {
      isError: true,
      content: [{ type: "text", text: `调用失败: ${error.message}` }],
    };
  }
});

/**
 * 启动逻辑
 */
let mdnsProcess = null;

if (MODE === "stdio") {
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    console.error("MCP Server 正在以 Stdio 模式运行");
  });
} else {
  const app = express();
  app.use(cors());

  let transport;

  // SSE 连接端点
  app.get("/sse", async (req, res) => {
    console.log(`[${new Date().toISOString()}] SSE 连接请求: ${req.ip}`);

    transport = new SSEServerTransport("/messages", res);

    try {
      await server.connect(transport);
      console.log(`[${new Date().toISOString()}] SSE 已连接`);

      req.on('close', () => {
        console.log(`[${new Date().toISOString()}] SSE 已关闭: ${req.ip}`);
      });
    } catch (error) {
      console.error("SSE 连接失败:", error);
      res.end();
    }
  });

  // 消息接收端点
  app.post("/messages", async (req, res) => {
    console.log(`[${new Date().toISOString()}] 收到消息`);
    if (transport) {
      try {
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error("处理消息失败:", error);
        res.status(500).send(error.message);
      }
    } else {
      res.status(400).send("No active SSE transport");
    }
  });

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    const hostname = os.hostname();
    // 在 Termux 环境中不使用 .local 域名
    const serverAddress = `http://0.0.0.0:${PORT}`;
    const localAddress = `http://localhost:${PORT}`;

    console.log(`MCP Server (SSE) 运行在 ${serverAddress}`);
    console.log(`本地访问地址: ${localAddress}`);

    // 在 Termux 中不使用 macOS 特定的 dns-sd，改为使用第三方库实现 mDNS
    try {
      const { Advertisement } = require('bonjour-service');
      // 创建 mDNS 广播
      mdnsProcess = new Advertisement(
        {
          name: 'termux-mcp-server',
          port: PORT,
          type: 'http',
          txt: { path: '/sse' }
        },
        {
          // 在某些网络环境下可能无法绑定到 IPv6，所以只使用 IPv4
          multicast: true,
          interface: '0.0.0.0'
        }
      );
      mdnsProcess.start();
      console.log("mDNS 广播已启动 (使用 bonjour-service)");
    } catch (err) {
      console.error("mDNS 服务启动失败 (这可能是因为 bonjour-service 未正确安装):", err);
    }
  });

  // 优雅退出处理
  const cleanup = () => {
    console.log("\n正在关闭服务...");
    if (mdnsProcess) {
      try {
        mdnsProcess.stop(() => {
          console.log("mDNS 广播已停止");
        });
      } catch (err) {
        console.error("停止 mDNS 时出错:", err);
      }
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

process.on("uncaughtException", (error) => {
  console.error("未捕获错误:", error);
});
