---
description: "Edit additional work requirements and inspect delivery activity."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-deliver-response

English | [中文](README.zh.md)

## Summary

Edit additional work requirements without writing them until you save. Reset removes your override to inherit the Host configuration. The tool card reports whether a delivery succeeded.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Enable the [Response delivery bundle](../deliver-response-bundle/README.md) and open its details. Edit **Additional work requirements** and choose **Save**. **Discard changes** restores the last saved value without writing anything. **Reset to default** stages removal of the override; choose **Save** to apply the reset. If saving fails, the form keeps the draft and shows the refusal beside Save.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The form takes its effective and inherited values from the existing [configuration service](../../client/ui-settings/README.md). A save carries the revision from when editing began. Disabling the bundle removes its editor and tool card, not the reply shown by [Chat](../../client/ui-chat/README.md).

</details>

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [delivery runtime](../deliver-response/README.md), which adds the saved requirements to the `read_work_requirements` tool description.

#### KV Cache effect

The delivery runtime owns the request and cache effects of requirement edits; rendering and copying replies add no model-request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Use **Copy reply** to copy the delivered Markdown. Generic transcript actions still operate on the ordinary assistant message.

<a id="dev-note"></a>
### Dev Note

None.
