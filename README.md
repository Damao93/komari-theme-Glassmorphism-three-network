# Komari Glassmorphism 三网延迟版

![Komari Glassmorphism 三网延迟版预览](docs/preview.png)

本项目转载并二次修改自 [sanrokamlan-prog/komari-theme-Glassmorphism](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism)。

本仓库仅在原项目基础上增加中国联通、中国电信、中国移动三家运营商的延迟与丢包数据展示，其余主要功能、界面设计和代码均来源于原项目。

感谢原项目作者 **sanrokamlan-prog** 及所有贡献者的开发、维护与开源分享。

如需查看原版功能、安装方式及最新版本，请访问原项目：

https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism

本项目继续遵循原项目的 MIT License。

## 3x-ui 用户流量

主题管理的“3x-ui 用户流量”配置区可在指定节点的详情页概览中显示用户流量排行。模块默认启用，节点名称、`remark` 或 `public_remark` 包含 `DMIT` 时显示；匹配文本和刷新间隔均可在主题管理中调整。

### 演示模式

默认开启演示模式。当“脱敏中转 API URL”为空且演示模式开启时，模块使用内置数据展示完整界面，并明确标记“演示数据”。关闭演示模式后，未配置 API 时不会伪造真实数据。

### 接入真实 API

请部署由服务端控制的脱敏中转 API，并在主题管理中只填写该 API 的 URL。主题会自动将当前 Komari 节点 UUID 附加为 `node` 查询参数，例如：

```text
GET /api/xui-traffic?node=11111111-1111-1111-1111-111111111111
```

中转服务根据 UUID 选择该节点对应的 3x-ui 地址和 Token，因此每个 Komari 节点只显示自己的 3x-ui 用户。浏览器请求不携带 3x-ui 凭据，响应格式为：

```json
{
  "users": [
    {
      "name": "example-user",
      "enabled": true,
      "up": 0,
      "down": 0,
      "total": 0,
      "quota": 0
    }
  ]
}
```

`up`、`down`、`total` 和 `quota` 均为字节数；`quota` 为 `0` 时按不限流量显示。中转服务需自行处理 3x-ui 鉴权与跨域策略，并只返回上述脱敏数据。**不要把 3x-ui Bearer Token 放入主题配置、URL 或响应中**；本主题前端不接收、存储或转发 Bearer Token。

### NAS Docker 多节点中转服务

仓库的 `relay/` 提供了一个无第三方依赖的 Node.js 中转服务和 Docker Compose 示例。它按 Komari 节点 UUID 隔离数据源、并行服务不同节点、合并同一 3x-ui 面板内的同名用户，并对每个节点独立缓存 30 秒。

1. 进入 `relay/`，复制示例配置：

   ```bash
   cp xui-sources.example.json xui-sources.json
   ```

2. 从节点详情页 URL `/instance/<uuid>` 取得每个 Komari 节点 UUID，在 `xui-sources.json` 中为每个 UUID 配置对应的 3x-ui `/panel/api/inbounds/list` 地址和 API Token。此文件已被 `.gitignore` 忽略，不要提交或公开。
3. 将 `compose.yaml` 中的 `ALLOWED_ORIGIN` 改为 Komari 的公开站点地址，然后启动：

   ```bash
   docker compose up -d --build
   curl http://127.0.0.1:3010/healthz
   ```

4. 在 Komari 所使用的反向代理中，将同域路径 `/api/xui-traffic` 转发到 `http://127.0.0.1:3010`。Nginx 示例：

   ```nginx
   location = /api/xui-traffic {
       proxy_pass http://127.0.0.1:3010;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

5. 在主题设置中将“脱敏中转 API URL”填写为 `/api/xui-traffic`。主题会自动附加 UUID，不需要为每个节点配置不同 URL。

默认只允许 HTTPS 上游。只有在 NAS 与 3x-ui 之间已有可信私网连接时，才可在 Compose 中设置 `ALLOW_INSECURE_UPSTREAM: "true"` 使用 HTTP。中转服务不会向浏览器返回 Token、3x-ui 错误正文、客户端 UUID、订阅信息或面板配置。
