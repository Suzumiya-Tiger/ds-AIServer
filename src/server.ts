import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors';
import { PassThrough } from 'stream';
// 使用从 node-fetch 导入的类型
import type { RequestInfo, RequestInit, Response } from 'node-fetch';
const fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { default: fetchFn } = await import('node-fetch');
  // 需要强制转换类型以匹配 node-fetch 的签名
  return fetchFn(url as URL | RequestInfo, init);
};
import { createClient } from 'redis'; // 可选
import dotenv from 'dotenv';

dotenv.config(); // 加载 .env 文件

const app = new Koa();
const router = new Router();

const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
const deepSeekUrl = 'https://api.deepseek.com/chat/completions'; // 确认 DeepSeek API URL

// --- 可选: Redis 连接 ---
let redisClient: ReturnType<typeof createClient> | null = null;
async function connectRedis() {
  if (!process.env.REDIS_URL) {
    console.log("REDIS_URL not found in .env, skipping Redis connection.");
    return;
  }
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  try {
    await redisClient.connect();
    console.log('Connected to Redis');
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
    redisClient = null;
  }
}
// connectRedis(); // 按需启用
// ------------------------

router.post('/chat', async (ctx) => {
  if (!deepSeekApiKey) {
    ctx.status = 500;
    ctx.body = { error: 'DeepSeek API key not configured' };
    return;
  }

  const { prompt } = ctx.request.body as { prompt?: string };

  if (!prompt) {
    ctx.status = 400;
    ctx.body = { error: 'Prompt is required' };
    return;
  }

  // --- 设置 SSE 响应头 ---
  ctx.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // 创建一个 PassThrough 流将数据写入响应
  const stream = new PassThrough();
  // 设置流响应选项
  stream.on('data', (chunk) => {
    // 确保每个数据块立即刷新到客户端
    ctx.res.write(chunk);
  });
  ctx.respond = false; // 告诉 Koa 我们将手动处理响应
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', 'text/event-stream');
  ctx.res.setHeader('Cache-Control', 'no-cache');
  ctx.res.setHeader('Connection', 'keep-alive');

  console.log(`Received prompt: ${prompt}`);
  console.log('Streaming response...');

  try {
    const response = await fetch(deepSeekUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepSeekApiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`DeepSeek API error: ${response.status} ${response.statusText}`, errorBody);
      if (!stream.writableEnded) {
        stream.write(`event: error\ndata: ${JSON.stringify({ message: `API Error: ${response.statusText}` })}\n\n`);
        stream.end(); // 出错直接结束流
      }
      return;
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Assign response.body to a new variable after the null check
    const responseBody = response.body;

    // --- 使用 Promise 包装流处理 ---
    await new Promise<void>((resolve, reject) => {
      responseBody.on('data', (chunk) => {
        try {
          const text = chunk.toString('utf-8');
          // --- 添加详细日志 ---
          console.log('Raw chunk from DeepSeek:', text);
          // --- End log ---
          const lines = text.split('\n\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonData = line.substring(6).trim();
              if (jsonData === '[DONE]') {
                console.log('Received [DONE] marker from DeepSeek.');
                continue;
              }

              try {
                const parsedData = JSON.parse(jsonData);
                const contentChunk = parsedData.choices?.[0]?.delta?.content;
                if (contentChunk) {
                  const messageToSend = `data: ${JSON.stringify({ chunk: contentChunk })}\n\n`;
                  // --- 添加详细日志 ---
                  console.log('Writing chunk to frontend:', messageToSend);
                  // --- End log ---
                  if (!stream.writableEnded) { // 检查流是否还可写
                    stream.write(messageToSend);

                  } else {
                    console.warn('Stream already ended, cannot write chunk:', contentChunk);
                  }
                }
              } catch (parseError) {
                console.error('Failed to parse JSON chunk:', jsonData, parseError);
              }
            }
          }
        } catch (chunkProcessingError) {
          console.error('Error processing data chunk:', chunkProcessingError);
          // 根据情况决定是否 reject
          // reject(chunkProcessingError);
        }
      });

      responseBody.on('end', () => {
        console.log('DeepSeek stream finished.');
        // DeepSeek 流结束，发送完成信号给前端
        const doneMessage = `data: ${JSON.stringify({ done: true })}\n\n`;
        console.log('Writing done signal to frontend:', doneMessage);
        if (!stream.writableEnded) {
          stream.write(doneMessage);
        }
        resolve(); // Promise 成功解决
      });

      responseBody.on('error', (err) => {
        console.error('DeepSeek stream error:', err);
        // 向前端发送错误事件
        const errorMessage = `event: error\ndata: ${JSON.stringify({ message: 'Error in response stream from DeepSeek' })}\n\n`;
        console.log('Writing error signal to frontend:', errorMessage);
        if (!stream.writableEnded) {
          stream.write(errorMessage);
        }
        reject(err); // Promise 因错误拒绝
      });
    });
    // --- Promise 结束 ---

  } catch (error) {
    console.error('Error during fetch setup or stream promise:', error);
    // 如果 Promise 外部出错 (例如 fetch 本身失败，或 Promise reject)
    if (!stream.writableEnded) {
      stream.write(`event: error\ndata: ${JSON.stringify({ message: 'Internal server error during streaming setup or processing' })}\n\n`);
    }
  } finally {
    // 这个 finally 现在会在 new Promise 执行完毕 (resolve 或 reject) 后才执行
    if (!stream.writableEnded) { // 再次检查，避免重复结束
      stream.end(); // 安全地结束流
    }
    console.log('Response stream to frontend closed.');
  }
});

app
  .use(cors()) // 允许跨域请求 (开发时需要)
  .use(async (ctx, next) => { // Koa Body Parser 中间件 (简易版)
    if (ctx.is('application/json') && ctx.request.method === 'POST') {
      await new Promise<void>((resolve, reject) => {
        let data = '';
        ctx.req.on('data', chunk => data += chunk);
        ctx.req.on('end', () => {
          try {
            (ctx.request as any).body = JSON.parse(data); // 挂载到 ctx.request.body
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        ctx.req.on('error', reject);
      });
    }
    await next();
  })
  .use(router.routes())
  .use(router.allowedMethods());

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Koa server listening on port ${PORT}`);
});

// 设置服务器不缓冲响应
server.on('connection', (socket) => {
  // 禁用 Nagle 算法，允许小数据包立即发送
  socket.setNoDelay(true);
});