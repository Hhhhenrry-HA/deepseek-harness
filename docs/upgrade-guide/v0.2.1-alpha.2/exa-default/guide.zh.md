---
kind: upgrade-guide
description: "fork 以内置 Exa 搜索替换 DeepSeek 搜索提供方和独立 Exa 插件。"
---

# 内置 Exa 网页搜索

[English](guide.md) | 中文

## 变更

fork 中基于基础包的配置使用 Exa 联网搜索。加载配置时会自动退役旧独立包 `@hhhhenrry-ha/dsh-exa-search`：只移除其已选包条目，不删除已安装文件。现有 `web-search-exa` 设置与 `EXA_API_KEY` 凭据沿用原有标识。DeepSeek 聊天密钥不能启用 Exa 搜索。

## 迁移

1. 直接安装 fork 更新，不要先卸载现有应用，无需另装插件。
2. 打开**插件 > EXA 网页搜索**，保存你的 Exa API Key。已有 Exa 密钥会直接沿用，安装包不包含私人密钥。
3. 发起一次联网搜索确认结果。自定义补丁若指向 `web-search-deepseek`，需改为 `web-search-exa`；Exa 的默认结果数量字段是 `numResults`，不是 DeepSeek 的搜索次数预算 `maxUses`。
