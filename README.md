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

请部署由服务端控制的脱敏中转 API，并在主题管理中只填写该 API 的 URL。浏览器会按配置的刷新间隔发起不携带凭据的 `GET` 请求，响应格式为：

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
