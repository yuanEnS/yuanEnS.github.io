# 园中小记

文章放在 `posts/`，一篇一个 `.md` 文件，文件名就是网址，比如 `first-note.md` 对应 `/life/first-note/`。

```
---
title: 文章标题
date: 2026-11-06
tags: 随笔 旅行
summary: 列表页显示的一句话
---

正文，空一行分段。
```

可用写法：`## 标题`、`### 小标题`、`> 引用`、`- 列表`、`1. 列表`、`---` 分隔线、`**重点**`、`*着重号*`、`[文字](链接)`、`![图片说明](/life/images/a.jpg)`。

还没写完的文章，在信息区加一行 `draft: true`，就不会发布。

写好后在网站根目录运行 `python3 life/_src/build.py`，再提交推送。删除 `.md` 后运行一次，对应页面也会删除。

字体只保留用到的字。源字体 `fonts/LXGWWenKai-Medium.ttf` 不进 Git，换电脑后需要重新放一份（LXGW WenKai，SIL OFL 许可）。
