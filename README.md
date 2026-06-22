# opencode Chrome Control

这是一个给 [opencode](https://opencode.ai/) 使用的 Chrome 控制插件。它可以让 opencode 通过本机 Chrome 扩展和 Native Messaging host 读取、截图、点击、输入和操作你当前的 Chrome 标签页。

本仓库包含三部分：

- Chrome MV3 扩展
- Chrome Native Messaging 本机宿主
- 暴露 Chrome 工具的 opencode 插件

## 环境要求

- macOS
- Google Chrome
- [Bun](https://bun.sh/)
- 支持插件配置的 opencode

目前 Native Messaging host 的安装脚本只支持 macOS。

## 构建

在仓库根目录执行：

```sh
bun install
bun run build
```

构建完成后会生成：

- `packages/extension/dist/extension`
- `packages/native-host/dist/native-host.mjs`
- `packages/opencode-plugin/dist/index.js`

## 安装 Native Messaging Host

执行：

```sh
bun run install-host
```

如果想先查看将要写入的 manifest 路径和内容，可以运行：

```sh
bun run install-host:dry-run
```

在 macOS 上，Chrome Native Messaging manifest 会写入：

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.opencode.chrome_extension.json
```

这个 manifest 会指向当前仓库里构建出来的 native host 启动脚本。

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启 **Developer mode**。
3. 点击 **Load unpacked**。
4. 选择构建后的扩展目录：

```text
<repo>/packages/extension/dist/extension
```

其中 `<repo>` 是你克隆本仓库后的本地目录。

如果当前终端就在仓库根目录，可以用下面的命令打印完整路径：

```sh
printf '%s\n' "$PWD/packages/extension/dist/extension"
```

## 配置 opencode

把构建后的 opencode 插件文件加入 opencode 配置。

常见配置文件位置：

- 项目内配置：`opencode.json`、`opencode.jsonc` 或 `.opencode/opencode.json`
- 全局配置：`~/.config/opencode/opencode.json`

加入或合并下面的 `plugin` 配置：

```json
{
  "plugin": [
    "<repo>/packages/opencode-plugin/dist/index.js"
  ]
}
```

这里需要使用绝对路径。当前终端如果在仓库根目录，可以用下面的命令打印完整路径：

```sh
printf '%s\n' "$PWD/packages/opencode-plugin/dist/index.js"
```

如果配置文件里已经有 `plugin` 数组，只需要把这个路径追加进去，不要覆盖原来的插件。

## 验证安装

推荐按下面顺序操作：

1. 执行 `bun run build`。
2. 执行 `bun run install-host`。
3. 在 `chrome://extensions` 中重新加载这个 unpacked extension。
4. 重启或重新加载 opencode，让它读取新的插件配置。
5. 在 opencode 中运行 `chrome_status`。

连接正常时，`chrome_status` 会返回 native host 和 Chrome 扩展的连接状态。

Native host 会把运行时连接信息写到：

```text
~/.opencode-chrome-extension/runtime.json
```

opencode 插件会读取这个文件里的本地端口和 token，然后连接 native host。

## 工具列表

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

如果要总结或读取页面正文，优先使用 `chrome_page_content`。它会等待当前 Chrome 页面渲染稳定后，读取浏览器里真实渲染出的文本，适合读取 SPA 文档页和动态页面。

## 排查问题

如果 `chrome_status` 提示 runtime 文件不存在：

- 确认 Chrome 正在运行。
- 确认扩展已经在 `chrome://extensions` 中加载并启用。
- 如果刚重新构建过，重新加载扩展。

如果 Chrome 提示找不到 native host：

- 重新运行 `bun run install-host`。
- 在 `chrome://extensions` 中重新加载扩展。
- 确认 Native Messaging manifest 已经写入上面说明的位置。

如果 opencode 无法加载插件：

- 确认 `bun run build` 已经成功执行。
- 确认配置里使用的是 `packages/opencode-plugin/dist/index.js` 的绝对路径。
- 修改配置后，重启或重新加载 opencode。

## 开发

运行测试：

```sh
bun test
```

运行 TypeScript 检查：

```sh
bun run typecheck
```

修改扩展、native host 或 opencode 插件代码后，重新执行：

```sh
bun run build
bun run install-host
```

然后在 `chrome://extensions` 中重新加载扩展。

## 安全说明

这个项目会让 opencode 通过本地插件控制你的 Chrome。只应该在你信任当前 opencode 会话和本地仓库代码的环境中启用。

Native Messaging host 只监听 `127.0.0.1`，并把运行时 token 写入 `~/.opencode-chrome-extension/runtime.json`。opencode 插件会用这个 token 调用本机 host。
