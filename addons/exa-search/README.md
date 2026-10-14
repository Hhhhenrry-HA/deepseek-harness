---
description: "Install, configure, build, and remove the opt-in EXA search addon for the desktop runtime."
kind: "package-reference"
---

# EXA Web Search

English | [中文](README.zh.md)

## Summary

This addon replaces DeepSeek web search with the official EXA transport and a credential-backed settings page. It targets the installed desktop SDK pinned in [package.json](package.json), independently of the newer SDK workspace in this checkout. API keys belong to DSH's credential service; ordinary configuration contains only a credential reference and endpoint. Chat models and HTTP page fetching are unchanged.

## Table of Contents

- [Use this addon](#use-this-addon)
- [Development](#development)
- [Ownership and removal](#ownership-and-removal)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-addon"></a>
## Use this addon

Use a desktop runtime satisfying the peer dependencies in the manifest. Build this source package, add its absolute directory as a `file:` dependency of the target profile, and append its package name to that profile's `dsh.profile.bundles` without replacing existing entries. The addon is opt-in; it neither replaces the installed application archive nor changes the repository's base bundle.

Refresh the existing GUI and open **Plugins → EXA Web Search**. Enter an EXA API key and save. An empty input preserves the existing key. The key is resolved again for each search, so saving or rotating it does not require restarting the provider. Leave the endpoint at the official default unless using a trusted custom service.

The settings page reads credential metadata, never the stored secret. A failed metadata read displays an error and retry action instead of reporting an absent key. Missing credentials stop search before any EXA request. A failed save remains visible in the form.

<a id="development"></a>
## Development

Run these commands from this directory in the source checkout. The nested pnpm workspace isolates the released SDK pins from the root workspace's overrides; it is not another application launcher.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run build
pnpm test
```

The build emits the Host entry and browser module factory declared in the manifest. Offline tests use the real EXA request/response implementation with a mocked network and check credential rotation, missing-key rejection, cancellation, and provider disposal. Live UI verification uses the existing authenticated DSH GUI; never commit its profile, credentials, browser state, screenshots, or verification receipts.

<a id="ownership-and-removal"></a>
## Ownership and removal

[The Host adapter](src/index.ts) owns credential resolution; [the controller](src/client/controller.ts) owns form state and metadata refresh; [the locales](src/client/locales.ts) own visible text. [The bundle patch](cordis.patch.yml) selects EXA and disables the DeepSeek provider and its dedicated settings page. Disabled bundled entries remain visible in advanced plugin inventory.

Deselect this bundle from the profile before removing its dependency or local installation directory. Search then follows the base bundle's configuration. Removing the addon does not delete user credentials; explicitly remove an unused EXA credential through the existing credential-management service. This source directory is authoritative; a local deployment directory contains generated package files, not a second editable source tree.

<a id="model-experience"></a>
## Model Experience

### What the model sees

The existing web-search tool returns sources through EXA's official mapping. Missing credentials produce a setup-required error; there is no fallback to DeepSeek. Tool names and input schemas are unchanged.

### Token effect

The addon adds no prompt instructions. Only the provider's returned search results or setup error enter tool output.

### KV-cache effect

No standing prompt content changes. Normal tool-result growth remains part of conversation history.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

Compatibility is restricted to the SDK versions declared in the manifest. A runtime upgrade requires checking those contracts before changing the pins; this addon does not bypass peer-version checks. Offline tests do not establish vendor availability or API-key validity, and a real search requires the user's own key.

<a id="dev-note"></a>
## Dev Note

The settings integration follows DeepSeek Harness's existing form and credential interfaces and retains its MIT attribution. The official EXA provider owns HTTP transport and result mapping; this addon does not maintain a second implementation.
