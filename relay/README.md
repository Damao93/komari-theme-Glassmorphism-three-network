# 3x-ui Traffic Relay

该服务供 Komari Glassmorphism 主题使用。它根据 Komari 节点 UUID 选择对应的 3x-ui 面板，在服务端添加 Bearer Token，并仅返回用户名、启用状态、上传、下载、已用和配额。

## 1. 配置节点映射

复制示例文件：

```bash
cp xui-sources.example.json xui-sources.json
```

打开每个 Komari 节点详情页，从 `/instance/<uuid>` 取得 UUID。按以下格式配置：

```json
{
  "Komari 节点 UUID": {
    "url": "https://3x-ui.example.com/panel/api/inbounds/list",
    "token": "3x-ui API Token"
  }
}
```

如果 3x-ui 配置了自定义面板根路径，请将它包含在 `url` 中。Token 在 3x-ui 的“设置 → 安全 → API Token”创建。`xui-sources.json` 已被仓库忽略，不要上传、提交或分享该文件。

## 2. 配置并启动容器

将 `compose.yaml` 中的 `ALLOWED_ORIGIN` 改成 Komari 的公开来源，只包含协议和域名，不带末尾斜杠，例如：

```yaml
ALLOWED_ORIGIN: https://komari.example.com
```

启动并检查健康状态：

```bash
docker compose up -d --build
curl http://127.0.0.1:3010/healthz
```

正常响应为：

```json
{ "ok": true }
```

## 3. 配置同域反向代理

将 Komari 域名的 `/api/xui-traffic` 转发到 NAS 主机的 `127.0.0.1:3010`。Nginx 示例：

```nginx
location = /api/xui-traffic {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

如果反向代理本身也运行在 Docker 容器中，不能使用该容器自己的 `127.0.0.1`；请让两个容器加入同一个 Docker 网络，并将上游地址改为 `http://xui-traffic-relay:3000`。

## 4. 配置 Komari 主题

在主题设置中填写：

```text
脱敏中转 API URL：/api/xui-traffic
```

主题会自动请求：

```text
/api/xui-traffic?node=<当前 Komari 节点 UUID>
```

可在 NAS 上测试某个节点：

```bash
curl "http://127.0.0.1:3010/api/xui-traffic?node=节点UUID"
```

## 安全说明

- 默认只接受 HTTPS 3x-ui 上游。
- API Token 只从 Docker Secret 文件读取，不会返回给浏览器。
- 3x-ui 原始错误正文、客户端 UUID、订阅信息和面板配置不会透传。
- 服务按节点独立缓存 30 秒，避免访客请求直接放大到 3x-ui。
- 浏览器能看到脱敏后的用户名和流量数据；如用户名也属于敏感信息，应在服务中进一步改为别名或哈希。
