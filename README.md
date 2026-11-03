# 游戏园 · gamesyuan.com

打开就能玩的网页小游戏站。这个仓库是网站首页（游戏列表）；每个游戏是一个单独的仓库，GitHub Pages 会自动把它们挂到同一个域名下：

| 游戏 | 地址 | 仓库 |
|---|---|---|
| 中国象棋 | https://gamesyuan.com/xiangqi/ | [yuanEnS/xiangqi](https://github.com/yuanEnS/xiangqi) |

## 加一个新游戏

1. 新建仓库（比如 `wuziqi`），开启 GitHub Pages，它会自动出现在 `https://gamesyuan.com/wuziqi/`。
2. 在 `index.html` 的「全部游戏」里加一张卡片，在 `sitemap.xml` 里加一个 `<url>`。

## 文件

- `index.html`：首页
- `CNAME`：自定义域名 gamesyuan.com
- `sitemap.xml` / `robots.txt`：给搜索引擎
- `og.png`：分享到社交平台时显示的预览图
