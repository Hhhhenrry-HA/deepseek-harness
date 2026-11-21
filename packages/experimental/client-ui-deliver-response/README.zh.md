---
description: "编辑额外工作要求，并在对话中阅读以 Markdown 呈现的正式回复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-deliver-response

[English](README.md) | 中文

## 概述

编辑额外工作要求，只有保存才会写入。恢复默认会移除自定义设置，继承 Host 配置。正式回复以 Markdown 呈现，不随工作详情折叠，并提供单独的复制操作。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

启用[正式回复组合包](../deliver-response-bundle/README.zh.md)，打开其详情。编辑**额外工作要求**，然后选择**保存**。**放弃修改**会恢复最近保存的值，不写入配置。**恢复默认**会暂存移除自定义设置的操作，选择**保存**后才生效。保存失败时，表单会保留草稿，并在保存按钮旁显示失败原因。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

表单通过现有[配置服务](../../client/ui-settings/README.zh.md)读取生效值与继承值。保存请求携带开始编辑时的修订版本。对话从带有标记的工具结果元数据中读取正式回复；工具调用参数不会直接显示为正式回复。停用组合包会移除编辑器和正式回复的专用显示。

</details>

<a id="model-experience"></a>
## 模型体验

通过[回复运行时](../deliver-response/README.zh.md)间接影响模型：运行时将已保存的要求写入 `read_work_requirements` 的工具说明。

#### KV Cache 效果

编辑要求对请求和缓存的影响由回复运行时负责；显示和复制回复不会增加模型请求的 token。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 使用**复制答复**复制正式回复的 Markdown。通用对话操作仍针对普通的助手消息。

<a id="dev-note"></a>
### 开发备注

无。
