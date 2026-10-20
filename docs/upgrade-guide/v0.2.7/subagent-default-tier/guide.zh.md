---
kind: upgrade-guide
description: "子智能体和 workflow 显式选择默认档位时，参数值由 medium 改为 default。"
---

# 重命名子智能体默认档位

[English](guide.md) | 中文

## 变更

子智能体工具和 workflow 的 `agent()` 接受 `model_tier: 'default' | 'high'`。显式参数值 `medium` 替换为 `default`，设置页将此档位称为**默认**。省略或 null 仍使用用户配置的模型和思考强度。高级仍跟随主智能体当前的模型和思考强度。

保存的 `mediumModel` 设置键和已记录的 Session 策略不变，无需迁移设置或会话数据。

## 迁移

1. 在保存的 workflow 脚本和直接工具调用中，将 `model_tier: 'medium'` 替换为 `model_tier: 'default'`。使用 `SubagentStartRequest` 的 TypeScript 调用方将 `modelTier: 'medium'` 替换为 `modelTier: 'default'`。
2. 保持设置和 `cordis.yml` 中的 `mediumModel`、所选模型及其思考强度不变。
3. 分别使用 `default` 和 `high` 委派一次。打开各自子会话，在底部查看只读的模型和思考强度：默认使用所选模型，高级使用主智能体模型。
