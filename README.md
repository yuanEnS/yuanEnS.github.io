# 游戏园 · yuanens.com

主页有两个入口：生活园（`/life/`）和游戏园（`/games/`）。这个仓库是主页、游戏列表和生活园。游戏的源码都在 [yuanEnS/xiangqi](https://github.com/yuanEnS/xiangqi) 仓库里：

| 游戏 | 地址 | 怎么发布 |
|---|---|---|
| 中国象棋 | https://yuanens.com/xiangqi/ | xiangqi 仓库推送后自动发布（GitHub Pages 把项目仓库挂在 `/xiangqi/`） |
| 五子棋 | https://yuanens.com/wuziqi/ | 本仓库的 `wuziqi/` 目录，由 xiangqi 仓库打包生成，**不要手改** |

更新五子棋：在 xiangqi 仓库运行 `node web/build.js gomoku ../yuanEnS.github.io/wuziqi`，再在本仓库提交推送。

## 加一个新游戏

1. 在 xiangqi 仓库里写好游戏，打包到本仓库的一个新目录（或者单独建一个仓库开启 Pages，会自动出现在 `https://yuanens.com/仓库名/`）。
2. 在 `games/index.html` 的「全部游戏」里加一张卡片，在 `sitemap.xml` 里加一个 `<url>`。

## 文件

- `index.html`：主页，生活园和游戏园两个入口
- `games/`：游戏园，游戏列表
- `wuziqi/`：五子棋网页（自动生成）
- `life/`：生活园入口。下面有世界园 `world/`（地图和气泡，`map.js`；国界和中国省界在 `geo.js`，画法在 `geo-draw.js`，由 xiangqi 仓库的 `tools/geo/` 生成）和私人园 `personal/`（自己或某位作者的文章和园地，`?author=昵称`）。园地是心愿单、旅行地图、纪念日，页面在 `life/garden/?id=N`，旅行地图用 `garden-map.js`。文章在 Cloudflare D1 里，正式账号都能在 `/life/write/` 写，每人每天发布一篇
- `research/`：研究园搬到了单独的私有仓库（research-private，部署在 research.yuanens.com，有登录），这里只留一个「不再公开」的说明页。
- `reading/`：阅读园。中英文经典名著分章在线读：英文来自 Standard Ebooks（CC0），中文来自维基文库（CC BY-SA，`python3 reading/tools/wikisource.py` 取并转简体）。书目在 `reading/books.json`，运行 `python3 reading/tools/build.py` 下载、转换并生成书目页（书目页模板是 `reading/tools/index.template.html`）。英文书页上点单词会弹出中文释义：脚本是 `reading/lookup.js`，词典在 `reading/dict/`（来自 ECDICT，MIT 许可）；加了英文书后运行 `python3 reading/tools/build_dict.py ecdict.csv reading/dict reading/books/<英文书>...` 重新生成（ecdict.csv 从 https://github.com/skywind3000/ECDICT 下载，不放进仓库）。
- `resume/`：作者简历（不从站内链接，直接用网址访问）
- `CNAME`：自定义域名 yuanens.com
- `sitemap.xml` / `robots.txt`：给搜索引擎
- `og.png`：分享到社交平台时显示的预览图
