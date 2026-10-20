---
description: "上下文压缩（context compaction）设置：用于选择独立的摘要模型与思考强度、保存偏好，以及处理模型目录或设置失败。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-compaction

[English](README.md) | 中文

## 概述

在**插件 > 上下文压缩**中选择总结会话历史所用的模型与思考强度。保存的偏好用于下一次摘要，包括已有会话，且不改变其会话模型。你可以通过默认选项保留部署路由，也可以选择一个固定模型。重新加载模型目录或选择替代项时，不可用的已保存选择仍然可见。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

web-app 组合包挂载该页面；Host 提供 `compaction-model-selection-settings` 时，页面才会出现。插件没有专属配置；[压缩后端](../../compaction/compaction-basic/README.zh.md#summary-model-selection)负责路由和失败行为。

### 模型与思考强度

**总结模型**提供**默认（跟随会话模型）**和按提供方分组的精确提供方／模型选项。默认选项先保留部署配置的摘要路由，再跟随会话模型。固定选择只为摘要覆盖该路由。**思考强度**提供所选模型公布的值和**模型默认**；切换模型会将强度重置为其默认值。该默认值属于所选模型，而不是会话的思考强度。

### 保存或丢弃编辑

选择模型或强度只会暂存编辑；只有**保存**才会写入。一次以 revision 防止冲突的变更保存暂存字段，页面在按钮旁报告成功或失败原因。保存被拒绝或冲突时保留草稿，不覆盖较新的 Host 设置。离开后重新打开页面，即可丢弃草稿并读取已接受的设置。离开页面总会丢弃未保存编辑；只读部署显示提示并阻止编辑。

保存的偏好在下一次自动、`/compact` 或显式区域摘要开始时生效，已有会话也适用。已经进行中的摘要保留已捕获的选择。压力阈值、保留历史、剪枝和摘要指令仍由后端控制。

### 模型目录反馈

页面显示加载中、空目录、部分提供方失败和加载失败状态。部分结果保留成功提供方的可见性；请求失败时提供**重试**。目录中缺失的已保存路由与草稿路由仍以不可用状态显示，不可用的已保存强度也保持显示，不会被静默重置。目录刷新不会丢弃选择。保留不可用选项并不会使其可用：后端会让摘要失败，而不是静默选择其他路由或强度。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

浏览器控制器通过共享的 `SettingsFormModel` 暂存 Host 命名空间，并独立加载模型目录。适配器变更和设置文档提交会重新加载目录；连接重置会丢弃连接内草稿并重新加载元数据。请求 generation 阻止较晚返回的旧目录响应替换较新状态，dispose（资源释放）停止配置观察。

卡片渲染 slot 注册所提供的快照与回调。它将 `SettingsForm` 与无 Cordis 的 [ui-primitives 库](../ui-primitives/README.zh.md#component-catalog)中的 `ModelRouteFields`、`modelRouteCandidates` 和 `modelRouteKey` 组合使用，Subagent 设置也使用这些组件与辅助函数。它不从其他功能插件导入运行时值。Host 入口只让浏览器模块可用；后端拥有实时偏好服务。

| 源码 | 职责 |
|---|---|
| [浏览器入口](src/client/index.ts) | 本地化、命名空间可用性、slot 与重新加载注册 |
| [控制器](src/client/controller.ts) | 暂存设置与模型目录状态 |
| [卡片](src/client/CompactionCard.tsx) | 模型控件、目录反馈与保存结果 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面说明后端行为和共享设置界面。

- [压缩后端](../../compaction/compaction-basic/README.zh.md#summary-model-selection)——摘要路由优先级、生效时机与失败。
- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——承载本页的插件页面。
- [ui-settings](../ui-settings/README.zh.md)——带 revision 的设置表单与命名空间可用性。
- [ui-primitives](../ui-primitives/README.zh.md#component-catalog)——共享暂存表单与模型路由控件。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端设置界面，不注册面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

模型发现与执行采用各自的检查。

- **目录发现由信号驱动**——提供方公布信息的变化在适配器变更、设置文档提交、重新连接或显式重试后才会出现；本页不轮询提供方。
- **列出或保存选项不等于执行验证**——后端准备摘要请求时才检查适配器可用性与思考强度支持。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
