# 不用 GitHub 的临时公网联机方法

这个方法适合你现在想快速让手机微信扫码玩，不需要 GitHub，不需要部署平台。

原理是：

```text
你的电脑运行游戏
Cloudflare 给你一个临时 HTTPS 网址
手机微信打开这个网址
大家扫码进房间
```

注意：电脑和黑色窗口必须一直开着。关掉窗口后，临时网址就失效。下次启动会生成新的网址。

## 第一步：下载 cloudflared

打开 Cloudflare 官方下载页：

```text
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
```

下载 Windows 版 `cloudflared.exe`。

下载后，把 `cloudflared.exe` 放进这个文件夹：

```text
C:\game
```

也就是和 `server.js`、`启动游戏.cmd` 放在一起。

## 第二步：双击启动

双击：

```text
启动游戏_临时公网.cmd
```

它会打开两个黑色窗口：

1. 一个是本地游戏服务器。
2. 一个是 Cloudflare 临时公网链接。

第二个窗口里会出现类似：

```text
https://xxxx.trycloudflare.com
```

复制这个网址。

## 第三步：微信打开

把这个网址发到微信，或者手机微信里打开。

进入后：

1. 输入昵称。
2. 创建房间。
3. 页面会显示房间二维码。
4. 其他人微信扫一扫即可加入。

## 重要提醒

- 必须打开 `https://xxxx.trycloudflare.com`，不要打开 `localhost:3000`。
- 创建房间前要确保浏览器地址栏是 `trycloudflare.com`，这样二维码才是微信能扫的公网二维码。
- 两个黑色窗口都不要关。
- 这个链接是临时的，适合测试和临时一起玩。
- 如果要长期固定网址，后面再考虑正式部署或买云服务器。
