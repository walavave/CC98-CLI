# CC98-CLI

CC98 的命令行客户端，有适合日常浏览的 TUI，以及面向脚本使用的 CLI 。

- 直接运行 `cc98`：进入终端界面。
- 带参数运行 `cc98 <command>`：执行 CLI，默认输出 JSON。
- 当前主要面向读取场景，TUI 会尽量按需加载和缓存，减少请求。

## 概要

这是一个个人兴趣项目，改版自Lucent-Snow的[CC98-CLI](https://github.com/Lucent-Snow/CC98-CLI)，风格和TUI布局模式参考[Yazi](https://github.com/sxyazi/yazi)。

基于 CC98 的公开接口实现，与 CC98 官方无关。请合理使用本工具，避免违反 CC98 的用户协议。

### 特色

- **支持WebVPN、RVPN**：RVPN使用`atrust`验证；魔法VPN不开启TUN模式下也可以使用
- **支持鼠标点击/滚动**：支持鼠标左右拉动分割线
- **支持文件下载**：鼠标点击链接下载文件，支持`.pdf` `.docs`等
- **图片预览（快捷键预览大图）**：支持`Kitty（KPG）`和`iterm2`渲染，在基于libghostty的终端上完成验证
- **图形化登录**：无需使用命令行登录、切换账号
- **Yazi风格**：伪装Yazi文件管理器；q键退出，终端不留痕
- **自定义**：主题颜色、部分快捷键

## 预览

<p align="center">
  <img src="docs/images/tui.png" alt="CC98-CLI TUI 截图" width="900">
  <img src="docs/images/tui2.png" alt="CC98-CLI TUI 截图2" width="900">
</p>

## 安装

需要 Node.js 20+。

```bash
npm install -g @walavave/cc98-cli
```

安装后命令是：

```bash
cc98
```

## 登录

```bash
cc98 login
```

多账号：

```bash
cc98 account list
cc98 account use <name>
cc98 --account <name> me
```

## TUI

```bash
cc98
```

常用按键：

```text
j/k 或 ↑/↓        上下移动
l 或 →            进入下一层
h 或 ←            返回上一层
Enter             确认执行
r                 刷新
?                 显示帮助
n 或 Space        加载更多
q                 退出
```

左栏导航包含：十大、收藏、最新、版面、关注、消息、我的、设置。

### 配置

配置文件路径为 `~/.config/cc98-cli/config.toml`，未设置时使用默认值。

```toml
[tui]
hide_top_chrome = false
preview_images = true
```

图片预览目前支持 Kitty graphics protocol 和 iTerm2 inline image。若终端不支持对应协议，会保留文本图片占位。

快捷键映射文件路径为 `~/.config/cc98-cli/keymap.toml`。格式参考 `keymap.toml`，组合键使用尖括号表示，例如：

```toml
[tui]
prepend_keymap = [
  { on = "<A-Down>", run = "topic.next-reply", desc = "下一条回复" },
  { on = "<A-Up>", run = "topic.previous-reply", desc = "上一条回复" },
]
```

默认已内置 `<A-Down>` / `<A-Up>` 用于在主题阅读模式下跳转相邻回复。

## CLI

CLI 默认输出 JSON，适合配合 `jq` 或脚本使用。

```bash
cc98 me
cc98 topic <topic-id>
cc98 board <board-id>
cc98 search <keyword>
cc98 message recent
cc98 update
```

查看完整命令：

```bash
cc98 --help
cc98 topic --help
cc98 user --help
cc98 update --help
```

## 本地数据

登录信息和缓存保存在：

```text
~/.cc98-cli/
```

## 开发

```bash
npm install
npm run check
npm run build
node dist/main.js
```

## 致谢

- [CC98-CLI](https://github.com/Lucent-Snow/CC98-CLI)：基于该项目fork，因技术路线分离而独立

## License

MIT
