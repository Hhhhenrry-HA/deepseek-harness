---
kind: upgrade-guide
description: "子智能体模型白名单改为单个中级模型，高级跟随主智能体。"
---

# 选择一个中级子智能体模型

[English](guide.md) | 中文

## 变更

启用子智能体模型设置后，工具公开 `model_tier: medium | high`，不再允许自由填写提供方、模型和思考强度。省略或 null 使用中级。中级采用用户单选的模型和保存的思考强度；高级跟随主智能体当前的模型和思考强度，中级子智能体再次委派时也一样。Spawn、fork 和 workflow 使用同一策略。中级模型失败时不会切到高级。

`subagent-model-selection-settings` 命名空间用 `mediumModel` 和 `reasoningEffort` 替换 `allowedModels`。原来只保存一个模型时，将它作为中级读取；保存多个模型时，必须明确重选。已有 Session 策略保持固定；设置对新会话生效。不再公开 `list_subagent_models`。

## 迁移

1. 打开插件 → 子智能体，启用分级模型，选择一个中级模型，可选思考强度，然后保存。如果之前选了多个模型，请重新选择一个。新建会话。
2. 如果直接配置 `cordis.yml`，将 `subagent-model-selection-settings` 中的 `allowedModels` 替换为 `mediumModel: { provider: <provider>, model: <model> }`；`reasoningEffort: null` 使用模型默认值，也可以填写该模型公布的强度。
3. 启用分级设置时，将 workflow 脚本中的子级 `provider` 和 `model` 覆盖替换为 `model_tier: 'medium'` 或 `'high'`。移除 `list_subagent_models` 调用。
4. 确认设置页恰好选中一个模型。在新会话中不指定等级地委派，检查子智能体是否使用所选中级模型；指定 `high` 委派时，应使用主智能体模型。
