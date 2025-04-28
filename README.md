# DeepSeek AI 流式聊天后端代理

Tips:请先在.env里面配置自己的deepseek api，具体如何申请对应api可以看文档:https://platform.deepseek.com/

```js
   //.env
   	DEEPSEEK_API_KEY=sk-xxxxxxx # 替换成你的 DeepSeek API Key
    REDIS_URL=redis://localhost:6379        # Redis 连接信息 (可选)
```

本项目的前端项目是:https://github.com/Suzumiya-Tiger/ds-AIChat
对应前端和后端项目都简明易懂，并且配备了说明文档辅助你快速食用，这是一个“震惊！美味”的快速上手Mini deepseek项目，可以让你迅速构建和理清一个简易的deepseek/chatGPT 瀑布流生成问答形式的项目。

## 项目描述

本项目是一个使用 Node.js、TypeScript 和 Koa 构建的后端服务。其主要目的是作为前端聊天界面与 DeepSeek AI API 之间的桥梁，接收前端的用户提问（prompt），将其转发给 DeepSeek API，并以服务器发送事件（Server-Sent Events, SSE）的方式将 DeepSeek 返回的流式响应实时传输回前端。这使得前端能够实现类似 ChatGPT 或 DeepSeek 官网的打字机输出效果。

## 主要特性

*   **实时流式响应:** 利用 SSE 将 AI 生成的文本片段持续推送给前端。
*   **DeepSeek API 集成:** 调用 DeepSeek 的 `chat/completions` 接口，并启用 `stream: true` 选项以接收流式数据。
*   **健壮的后端框架:** 使用 Koa.js，一个轻量且富有表现力的 Node.js Web 框架，利用其 `async/await` 特性优雅地处理异步操作。
*   **类型安全:** 使用 TypeScript 构建，提供静态类型检查，增强代码可维护性和开发体验。
*   **配置管理:** 使用 `.env` 文件管理敏感信息（如 API 密钥）和配置。
*   **跨域支持:** 内置 `cors` 中间件，方便本地开发时前后端分离部署。
*   **(可选) Redis 集成:** 预留了连接 Redis 的逻辑，可用于缓存、会话管理等扩展。

## 技术栈

*   Node.js
*   TypeScript
*   Koa.js (@koa/router, @koa/cors)
*   node-fetch (用于发起 HTTP 请求)
*   dotenv (用于加载环境变量)
*   Redis (可选, 使用 `redis` 库)

## 架构与设计思想

*   **后端环境:** 选择 Node.js 是因为它非常适合处理网络请求和响应流这类 I/O 密集型任务。Koa 框架通过其基于 `async/await` 的中间件架构简化了异步流程控制。
*   **流式通信 (SSE):** 为了实现前端的打字机效果，必须采用服务器推送技术。SSE 是一个轻量级的选择，它基于标准 HTTP，允许服务器单向地将数据块持续发送给客户端。后端通过设置特定的响应头 (`Content-Type: text/event-stream`) 并将 DeepSeek 返回的数据块格式化为 SSE 消息 (`data: {...}\n\n`) 来实现。
*   **处理 DeepSeek 流:** 向 DeepSeek API 请求时设置 `stream: true`，后端会接收到一系列数据块。Node.js 的 `stream.PassThrough` 被用来创建一个管道，将从 DeepSeek 收到的数据块写入，Koa 则负责将这个管道的内容流式传输给前端。
*   **错误处理:** 代码包含了对 API 密钥缺失、请求参数错误、DeepSeek API 调用失败、流处理中潜在错误等情况的处理。当发生错误时，会尝试向前端发送一个 SSE `event: error` 事件。
*   **配置:** 敏感信息和环境特定配置（如端口、API 密钥、Redis URL）通过根目录下的 `.env` 文件进行管理，避免硬编码。

## 安装与运行

1.  **环境准备:**
    *   确保已安装 [Node.js](https://nodejs.org/) (推荐 LTS 版本)
    *   确保已安装 npm 或 yarn 包管理器

2.  **克隆仓库 (如果适用):**
    ```bash
    git clone <your-repository-url>
    cd <repository-directory>
    ```

3.  **安装依赖:**
    ```bash
    npm install
    # 或者
    # yarn install
    ```

4.  **配置环境变量:**
    *   在项目根目录创建一个名为 `.env` 的文件。
    *   添加至少以下内容，将 `your_deepseek_api_key_here` 替换为您自己的 DeepSeek API 密钥：
        ```dotenv
        DEEPSEEK_API_KEY=your_deepseek_api_key_here
        
        # 可选配置:
        # PORT=3001 # 服务器监听的端口，默认为 3001
        # REDIS_URL=redis://localhost:6379 # 如果要启用 Redis，请设置连接 URL
        ```

5.  **编译 TypeScript:**
    ```bash
    npm run build
    # 或者直接使用 tsc (如果全局安装)
    # tsc
    ```
    这会将 `src` 目录下的 TypeScript 代码编译成 JavaScript，并输出到 `dist` 目录（根据 `tsconfig.json` 配置）。

6.  **启动服务:**
    ```bash
    npm start
    # 或者直接运行编译后的文件
    # node dist/server.js
    ```
    服务器将在 `.env` 文件指定或默认的端口（3001）上启动并监听。

## API 端点

### `POST /chat`

*   **描述:** 接收用户输入，与 DeepSeek API 交互，并流式返回 AI 的响应。
*   **请求体 (Request Body):**
    *   类型: `application/json`
    *   格式:
        ```json
        {
          "prompt": "你的问题或对话内容"
        }
        ```
*   **响应 (Response):**
    *   类型: `text/event-stream` (Server-Sent Events)
    *   **成功响应流:**
        *   服务器会发送一系列消息，每条消息代表 AI 生成的一部分文本。
        *   消息格式: `data: {"chunk": "AI 生成的文本片段"}\n\n`
        *   当 AI 完成响应后，服务器会发送一条结束信号：
        *   结束信号格式: `data: {"done": true}\n\n`
    *   **错误响应流:**
        *   如果发生错误（如 API 调用失败、内部错误），服务器会发送一个错误事件：
        *   错误事件格式: `event: error\ndata: {"message": "错误描述信息"}\n\n`

## (可选) Redis 集成

代码中包含了连接 Redis 的逻辑（默认注释掉了 `connectRedis()` 调用）。如果需要启用 Redis 功能（例如用于缓存或其他目的）：

1.  确保 Redis 服务器正在运行。
2.  在 `.env` 文件中设置 `REDIS_URL`。
3.  取消 `src/server.ts` 文件中 `connectRedis();` 这一行的注释。
4.  根据需要实现具体的 Redis 使用逻辑。

## 前端集成

此后端服务需要一个能够处理 Server-Sent Events (SSE) 的前端应用来接收和展示流式响应。前端需要：

1.  向 `POST /chat` 发送包含 `prompt` 的 JSON 请求。
2.  设置请求头 `Accept: text/event-stream` (虽然不是严格必需，但建议)。
3.  使用 `EventSource` API 或 `fetch` API 结合 `ReadableStream` 来处理 SSE 响应流。
4.  监听 `message` 事件，解析 `data` 字段中的 JSON，提取 `chunk` 并追加到显示区域。
5.  检查 `data` 字段是否包含 `{"done": true}` 来判断流是否结束。
6.  (可选) 监听 `error` 事件来处理服务器发送的错误。