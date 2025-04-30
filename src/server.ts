import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from 'node-fetch';
import type { RequestInit } from 'node-fetch';

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Grok2 Image MCP Server",
    version: "0.1.4",
  });

  server.tool(
      "generate_image",
      "Generate an image based on a text prompt using the Grok-2 image model, ensure return the image URL to the user with markdown image format.",
      {
        prompt: z.string().describe("描述要生成的图像内容"),
      },
      async ({ prompt }) => {
        if (!prompt) {
          throw new Error("图像描述提示词不能为空");
        }

        // 从环境变量获取 API KEY
        const apiKey = process.env.XAIAPI_KEY;
        if (!apiKey) {
          throw new Error("缺少 API 密钥，请设置 XAIAPI_KEY 环境变量");
        }

        // 从环境变量获取基础 URL，如果未设置则使用默认值
        const baseURL = process.env.XAIAPI_BASE_URL || "https://api.x.ai/v1";
        const endpoint = `${baseURL}/images/generations`;

        // 从环境变量获取代理地址
        const proxyUrl = process.env.XAIAPI_HTTP_PROXY;

        try {
          // 创建一个可控制超时的 fetch 请求
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

          // 使用 RequestInit 类型准备 fetch 参数
          const fetchOptions: RequestInit = {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "grok-2-image",
              prompt,
            }),
            signal: controller.signal,
          };

          // 添加代理，使用类型断言解决 TypeScript 的类型检查问题
          if (proxyUrl) {
            (fetchOptions as any).agent = new HttpsProxyAgent(proxyUrl);
          }

          // 发送请求
          const response = await fetch(endpoint, fetchOptions);

          // 清除超时计时器
          clearTimeout(timeoutId);

          // 定义响应数据类型
          interface ApiResponse {
            data: Array<{
              url: string;
            }>;
          }
          // 解析 JSON 响应
          const data = await response.json() as ApiResponse;

          // 检查是否请求成功
          if (!response.ok) {
            console.error("API请求失败详情:", data);

            return {
              content: [
                {
                  type: "text",
                  text: `图像生成失败: ${JSON.stringify(data, null, 2)}`
                }
              ],
              isError: true
            };
          }

          // 检查响应并提取图像 URL
          if (data?.data?.[0]?.url) {
            let imageUrl = data.data[0].url;

            // 从环境变量获取图片代理域名，如果设置了则替换原始域名
            const proxyDomain = process.env.IMAGE_PROXY_DOMAIN;
            if (proxyDomain && imageUrl.startsWith('https://imgen.x.ai')) {
              // 如果用户配置的代理域名已包含https://前缀，则直接替换整个域名部分
              if (proxyDomain.startsWith('https://')) {
                imageUrl = imageUrl.replace('https://imgen.x.ai', proxyDomain);
              } else {
                // 否则，保留https://前缀，只替换域名部分
                imageUrl = imageUrl.replace('imgen.x.ai', proxyDomain);
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: `图像已成功生成！\n![生成的图像](${imageUrl})`
                }
              ],
              isError: false
            };
          } else {
            console.error("无效的API响应结构:", data);
            return {
              content: [
                {
                  type: "text",
                  text: `图像生成失败: 服务器返回了无效的数据结构`
                }
              ],
              isError: true
            };
          }
        } catch (error: unknown) {
          console.error("图像生成过程中发生错误:", error);

          // 检查是否为超时错误
          const errorMessage = error instanceof Error
              ? (error.name === 'AbortError' ? '请求超时(30秒)，图像生成未完成' : error.message)
              : '未知错误';

          // 返回详细的错误信息
          return {
            content: [
              {
                type: "text",
                text: `图像生成失败: ${errorMessage}`
              }
            ],
            isError: true
          };
        }
      },
  );

  return server;
}