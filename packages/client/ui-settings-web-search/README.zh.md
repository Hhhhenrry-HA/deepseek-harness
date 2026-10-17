---
description: "插件页中的 Exa 网页搜索设置：API Key、接口地址与默认结果数量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

[English](README.md) | 中文

## 概述

打开**插件**，选择 **EXA 网页搜索**，即可设置密钥、接口地址与默认结果数量。点击**保存**后立即生效，无需重启。密钥经凭据存储写入，不进入设置文件或设置响应。页面只在 Host 服务 `web-search-exa` 期间存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

**API Key** 初始为空，只显示是否已配置；留空表示保留已存密钥。读取中、读取失败与确实未配置分别显示，失败时可点**重试**。只读凭据不可编辑。**接口地址**和**默认结果数量**显示生效值，覆盖后可点**恢复默认**；清空字段并保存也会重置。离开页面会丢弃未保存的草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 入口暴露浏览器模块。`WebSearchCardController` 经 `ctx.configForms` 绑定 `web-search-exa`，用 `SettingsFormModel` 暂存非密钥设置。密钥经 `remote.credentials.set` 写入 `apiKeyEnv` 指定的引用（默认为 `EXA_API_KEY`），再以 `describe` 确认元数据。scope 变化与 `credentials/reference-updated` 会刷新元数据；过期回复和释放后的回复不能覆盖当前状态。页面通过 `ctx.configForms.whileServed` 注册。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与"命名空间被服务期间"的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——本页渲染的设置表单模型与字段。
- [credentials](../../credentials/README.zh.md)——密钥写入所经的凭据引用 seam。
- [web-search-exa](../../web/web-search-exa/README.zh.md)——注册该命名空间的提供方。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **检索模式与高亮数量**仍由组合配置控制；页面只编辑密钥、接口地址与默认结果数量。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
