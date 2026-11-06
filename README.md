# 游戏园 · gamesyuan.com

打开就能玩的网页小游戏站。这个仓库是网站首页（游戏列表）。游戏的源码都在 [yuanEnS/xiangqi](https://github.com/yuanEnS/xiangqi) 仓库里：

| 游戏 | 地址 | 怎么发布 |
|---|---|---|
| 中国象棋 | https://gamesyuan.com/xiangqi/ | xiangqi 仓库推送后自动发布（GitHub Pages 把项目仓库挂在 `/xiangqi/`） |
| 五子棋 | https://gamesyuan.com/wuziqi/ | 本仓库的 `wuziqi/` 目录，由 xiangqi 仓库打包生成，**不要手改** |

更新五子棋：在 xiangqi 仓库运行 `node web/build.js gomoku ../yuanEnS.github.io/wuziqi`，再在本仓库提交推送。

## 加一个新游戏

1. 在 xiangqi 仓库里写好游戏，打包到本仓库的一个新目录（或者单独建一个仓库开启 Pages，会自动出现在 `https://gamesyuan.com/仓库名/`）。
2. 在 `index.html` 的「全部游戏」里加一张卡片，在 `sitemap.xml` 里加一个 `<url>`。

## 文件

- `index.html`：首页
- `wuziqi/`：五子棋网页（自动生成）
- `life/`：博客「园中小记」。文章在 Cloudflare D1 里，在 `/life/write/` 用作者账号登录后写，不用改这个仓库
- `resume/`：作者简历
- `CNAME`：自定义域名 gamesyuan.com
- `sitemap.xml` / `robots.txt`：给搜索引擎
- `og.png`：分享到社交平台时显示的预览图
