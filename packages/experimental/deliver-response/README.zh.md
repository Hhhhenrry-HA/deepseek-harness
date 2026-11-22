---
description: "通过原生工具以 Markdown 投递最终回复，支持编辑工作要求，并在本地完成交付前的审阅步骤。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-deliver-response

[English](README.md) | 中文

## 摘要

使用专用工具以 Markdown 投递智能体的最终回复。每轮首次请求模型提供方之前，智能体会收到清单和两次已完成的审阅交互。你可以编辑工作要求，而不改变其他工具及其权限规则。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在使用原生工具调用的组合中显式挂载此实验插件。若要在 Web 聊天中把投递的 Markdown 显示为回复，也要挂载配套渲染插件。

### 最小配置

在 Cordis 中挂载运行时：

```yaml
- id: deliver-response
  name: '@deepseek-ai/dsh-experimental-deliver-response'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `workRequirements` | 通用任务和回复要求 | 替换 `read_work_requirements` 工具描述中的要求文本。编辑后无需重新加载插件，后续组装请求时即生效。 |

投递成功后，当前批次的工具调用执行完毕，本轮结束。纯文本回答仍可正常结束本轮；这类文字属于会话记录，不是单独投递的回复。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>展开实现细节</summary>

[运行时](src/index.ts)在步骤接纳时添加标有插件来源的用户角色消息。[审阅步骤](src/prelude.ts)根据已提交的清单和工具结果事件判断进度，并提供对应的助手流，不向模型提供方发出请求。循环会记录该流，再通过正常的权限和结果处理流程执行工具调用。取消后，未完成的审阅状态不会进入新一轮。

成功的原生投递结果带有 `{ kind: 'deliver-response', body }` 展示元数据。渲染器读取已提交的结果，不读取仍待处理的调用参数。模型看到投递确认，正文不会在工具结果中重复。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### 模型看到的内容

三个原生投递工具均可用时，插件会加入以下提示。

##### 静默推理强度

```markdown
SPECIAL INSTRUCTION: think silently if needed. EFFORT LEVEL: 0.00.
```

##### 回复渠道

```markdown
Your reply reaches the user through deliver_response. Text written outside deliver_response stays in the transcript but is not the delivered reply.
```

#### Token 影响

此段系统提示占用固定数量的 token。

#### KV 缓存影响

请求不变时，此段内容保持不变。挂载或卸载插件可能改变系统提示和工具声明前缀。

### 工具声明

#### 模型看到的内容

插件向现有原生工具声明添加 `read_work_requirements`、`request_approval` 和 `deliver_response`。配置的要求仅出现在第一个工具的描述中。此插件不替模型选择工具，也不改变提供方的工具选择模式。

#### Token 影响

工具声明增加固定开销和配置的要求文本。读取结果不会重复要求文本。

#### KV 缓存影响

编辑要求会替换声明文本。若提供方把工具声明缓存为前缀，编辑可能使这部分缓存无法复用。

### 每轮审阅步骤

#### 模型看到的内容

模型提供方收到标有插件来源的用户角色清单，随后收到两次依次完成的助手和工具结果交互。确切措辞见[协议源码](src/protocol.ts)。第二条结果中的推理强度指令是提示文本，不是模型参数。

#### Token 影响

每轮符合条件的交互增加固定数量的上下文 token。两个本地步骤都不会发出模型生成请求。

#### KV 缓存影响

清单和交互追加到已记录的消息历史中，不替换较早的消息，也不插入额外的模型提供方请求。

## 已知限制与延后事项

- **仅限原生工具调用** — 插件须显式启用，不绑定特定模型提供方；运行时不会根据管理员定义的路由名推断 Google Vertex 或 Gemini 协议。程序化工具调用不会运行审阅步骤，也不能嵌套调用这三个工具。
- **不授予工具权限** — 审阅步骤的批准只针对回复投递。若正常策略拒绝任一审阅工具，模型提供方会收到失败结果，插件跳过余下的合成步骤。真实工具的审批规则继续生效。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>展开维护上下文</summary>

无。

</details>
