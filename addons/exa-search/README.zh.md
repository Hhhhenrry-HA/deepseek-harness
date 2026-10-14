---
description: "安装、配置、构建和移除桌面运行版的可选 EXA 搜索插件。"
kind: "package-reference"
---

# EXA 网页搜索

[English](README.md) | 中文

## 概要

此插件用官方 EXA 传输实现和凭据设置页替换 DeepSeek 网页搜索。它面向 [package.json](package.json) 锁定的已安装桌面 SDK，独立于当前检出中的新版 SDK workspace。API Key 归 DSH 凭据服务所有；普通配置只包含凭据引用和接口地址。聊天模型与 HTTP 网页抓取不变。

## 目录

- [使用此插件](#use-this-addon)
- [开发](#development)
- [所有权与移除](#ownership-and-removal)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-addon"></a>
## 使用此插件

使用满足清单中 peer 依赖的桌面运行版。构建此源码包，将其绝对目录作为 `file:` 依赖加入目标 profile，再把包名追加到该 profile 的 `dsh.profile.bundles`，不要替换已有条目。插件需显式启用；它不替换已安装的应用归档，也不改变仓库的基础组合包。

刷新现有 GUI，打开 **插件 → EXA 网页搜索**。填写 EXA API Key 并保存。输入留空会保留已有密钥。每次搜索都会重新解析密钥，因此保存或轮换密钥无须重启提供方。不使用可信的自定义服务时，接口地址保持官方默认值。

设置页只读取凭据元数据，不读取已保存的密钥。元数据读取失败会显示错误和重试操作，不会误报为未配置。缺少凭据时，搜索会在发出任何 EXA 请求之前停止。保存失败会在表单中明确显示。

<a id="development"></a>
## 开发

在源码检出的此目录内执行以下命令。嵌套 pnpm workspace 将已发布 SDK 的版本锁定与根 workspace 的 overrides 隔离；它不是另一个应用启动器。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm test
```

构建生成清单声明的 Host 入口和浏览器模块工厂。离线测试用模拟网络执行真实 EXA 请求与响应实现，检查密钥轮换、缺密钥拒绝、取消和提供方卸载。实机界面验证使用现有的已认证 DSH GUI；不得提交其 profile、凭据、浏览器状态、截图或验证收据。

<a id="ownership-and-removal"></a>
## 所有权与移除

[Host 适配器](src/index.ts)负责凭据解析；[控制器](src/client/controller.ts)负责表单状态和元数据刷新；[语言表](src/client/locales.ts)负责可见文案。[组合包补丁](cordis.patch.yml)选择 EXA，并停用 DeepSeek 提供方及其专用设置页。被停用的内置条目仍会显示在高级插件清单中。

先从 profile 中取消选择此组合包，再移除其依赖或本地安装目录。搜索随后遵循基础组合包的配置。移除插件不会删除用户凭据；不再使用的 EXA 凭据需通过现有凭据管理服务显式删除。此源码目录是唯一编辑来源；本地部署目录只包含生成的包文件，不保留另一套可编辑源码。

<a id="model-experience"></a>
## 模型体验

### 模型看到的内容

现有网页搜索工具通过 EXA 官方映射返回来源。缺少凭据时返回需要配置的错误，不回退到 DeepSeek。工具名称和输入 schema 不变。

### Token 影响

插件不添加提示词指令。只有提供方返回的搜索结果或配置错误进入工具输出。

### KV 缓存影响

常驻提示内容不变。正常的工具结果增长仍属于会话历史。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

兼容范围限定为清单声明的 SDK 版本。升级运行时需要先检查这些契约，再调整版本锁定；插件不会绕过 peer 版本检查。离线测试不能证明供应商可用性或 API Key 有效性，真实搜索需要用户自己的密钥。

<a id="dev-note"></a>
## 开发备注

设置集成沿用 DeepSeek Harness 的现有表单及凭据接口，并保留 MIT 授权署名。HTTP 传输和结果映射归官方 EXA 提供方所有；此插件不维护第二套实现。
