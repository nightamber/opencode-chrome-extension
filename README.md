# opencode Chrome 插件

这是给 opencode 使用的 Chrome 控制插件。当前仓库包含三部分：

- Chrome MV3 扩展
- Chrome Native Messaging 本机宿主
- 暴露浏览器工具的 opencode 插件

本项目独立于 opencode 主仓库，只依赖公开的 `@opencode-ai/plugin` 包。

## 构建

```sh
bun install
bun run build
```

## 安装 Native Host

```sh
bun run install-host
```

如果只想查看将要写入的 manifest 路径和内容，可以先运行 dry-run：

```sh
bun run install-host:dry-run
```

安装脚本目前只支持 macOS，会写入：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.opencode.chrome_extension.json
```

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启 Developer mode。
3. 点击 Load unpacked。
4. 选择：

```text
/Users/mrbear/code/opencode-chrome-extension/packages/extension/dist/extension
```

## 在 opencode 中使用

把构建后的插件加入 opencode 配置。配置文件可以选下面其中一个：

- 当前 opencode 项目内使用：`/Users/mrbear/code/opencode/.opencode/opencode.jsonc`。
- 其他项目内使用：项目根目录的 `opencode.json`、`opencode.jsonc`，或 `.opencode/opencode.json`。
- 全局所有项目使用：`~/.config/opencode/opencode.json`。

如果只是给 `/Users/mrbear/code/opencode` 这个项目启用，修改：

```text
/Users/mrbear/code/opencode/.opencode/opencode.jsonc
```

在该文件里加入或合并下面的 `plugin` 配置：

```json
{
  "plugin": [
    "/Users/mrbear/code/opencode-chrome-extension/packages/opencode-plugin/dist/index.js"
  ]
}
```

如果配置文件里已经有 `plugin` 数组，只需要把这个路径追加进去，不要覆盖原有插件。

插件会从下面的 runtime 文件读取当前 Native Host 端口和 token：

```text
~/.opencode-chrome-extension/runtime.json
```

这个文件由 Native Messaging host 在 Chrome 启动扩展后写入。

推荐使用顺序：

1. 先运行 `bun run build`。
2. 再运行 `bun run install-host`。
3. 在 Chrome 中加载扩展目录。
4. 在 opencode 配置中加入插件路径。
5. 使用 `chrome_status` 检查连接状态。

## 工具列表

总结或读取页面正文时，优先使用 `chrome_page_content`；它会等待当前 Chrome 页面渲染稳定后读取浏览器里真实渲染出的文本，并默认附带页面图片摘要，避免退回到 webfetch。

- `chrome_status`
- `chrome_tabs_list`
- `chrome_tab_select`
- `chrome_tab_new`
- `chrome_tab_goto`
- `chrome_tab_screenshot`
- `chrome_wait_for_load`
- `chrome_dom_snapshot`
- `chrome_page_content`
- `chrome_page_assets`
- `chrome_click`
- `chrome_type`
- `chrome_keypress`
- `chrome_scroll`
- `chrome_evaluate`
- `chrome_console_logs`

## 排查问题

如果 `chrome_status` 提示 runtime 文件不存在，先确认 Chrome 已启动，并且扩展已经加载、启用。

如果 Chrome 提示找不到 native host，运行 `bun run install-host`，然后在 `chrome://extensions` 中重新加载扩展。
