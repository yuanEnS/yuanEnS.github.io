// 文章下面的评论和回复，只有文字。接口在 api.gamesyuan.com/api/life/comments。
// mountComments(section, postId)：section 是空的 <section>，评论区画在里面。
const COMMENT_CANNOT = {
  login: '登录后可以评论。',
  guest: '游客账号不能评论，请用邮箱或 Google 登录。',
  new: '新注册的账号要过一天才能评论。',
  banned: '你的账号已被禁止评论。',
  off: '作者关闭了这篇文章的评论。',
};

function commentTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ms + 8 * 3600000); // 按北京时间
  const md = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return d.getUTCFullYear() === new Date(Date.now() + 8 * 3600000).getUTCFullYear() ? md : `${d.getUTCFullYear()}年${md}`;
}

function make(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
}

function mountComments(section, postId) {
  let data = null;
  let openReply = null; // 正在回复的评论 id

  let first = true;

  async function load() {
    try {
      data = await api(`/life/comments?post=${encodeURIComponent(postId)}`);
      draw();
      // 从评论消息点进来时，滚到那一条
      const target = first && location.hash.startsWith('#comment-') && document.getElementById(location.hash.slice(1));
      if (target) setTimeout(() => target.scrollIntoView({ block: 'center' }), 0);
      first = false;
    } catch (err) {
      section.replaceChildren(make('h2', { className: 'comments-title' }, '评论'), make('p', { className: 'hint' }, errorText(err)));
    }
    section.hidden = false;
  }

  function act(path, body, button, done) {
    if (button) button.disabled = true;
    return api(path, body).then(result => {
      if (done) done(result);
      return load();
    }).catch(err => {
      if (button) button.disabled = false;
      alert(errorText(err));
    });
  }

  // 写评论的框。parent 为空是顶层评论
  function form(parent, replyName) {
    const box = make('form', { className: 'comment-form' });
    const text = make('textarea', {
      className: 'field', rows: parent ? 2 : 3, maxLength: data.max, required: true,
      placeholder: parent ? `回复 ${replyName}` : '写下你的评论',
    });
    text.setAttribute('aria-label', parent ? `回复 ${replyName}` : '评论');
    const count = make('span', { className: 'count' }, `0 / ${data.max}`);
    text.addEventListener('input', () => {
      count.textContent = `${[...text.value].length} / ${data.max}`;
    });
    const send = make('button', { type: 'submit', className: 'primary' }, parent ? '回复' : '发表');
    const row = make('div', { className: 'comment-send' }, count);
    if (parent) {
      const cancel = make('button', { type: 'button', className: 'link-button' }, '取消');
      cancel.addEventListener('click', () => {
        openReply = null;
        draw();
      });
      row.append(cancel);
    }
    row.append(send);
    box.append(text, row);
    box.addEventListener('submit', e => {
      e.preventDefault();
      if (!text.value.trim()) return;
      act('/life/comments/add', { post: Number(postId), body: text.value, parent: parent || undefined }, send, result => {
        openReply = null;
        if (result.pending) alert('发出去了。这条评论要审核后才公开，现在只有你自己看得到。');
      });
    });
    return box;
  }

  function tools(comment) {
    const bar = make('div', { className: 'comment-tools' });
    const button = (label, onClick) => {
      const b = make('button', { type: 'button', className: 'link-button' }, label);
      b.addEventListener('click', () => onClick(b));
      bar.append(b);
    };
    if (!data.cannot && !comment.pending) {
      button('回复', () => {
        openReply = comment.id;
        draw();
        const field = section.querySelector(`[data-reply="${comment.id}"] textarea`);
        if (field) field.focus();
      });
    }
    if (comment.pending && data.canModerate) button('通过', b => act('/life/comments/approve', { id: comment.id }, b));
    if (comment.canDelete) {
      button('删除', b => {
        if (confirm(comment.mine ? '删除这条评论？' : `删除 ${comment.author} 的这条评论？`)) act('/life/comments/delete', { id: comment.id }, b);
      });
    }
    if (getToken() && !comment.mine && !comment.pending && !data.canModerate) {
      if (comment.reported) bar.append(make('span', { className: 'muted' }, '已举报'));
      else {
        button('举报', b => {
          if (confirm('举报这条评论？广告、骂人或违法的内容，几个人举报后会先藏起来，等园主处理。')) act('/life/comments/report', { id: comment.id }, b);
        });
      }
    }
    return bar;
  }

  function item(comment) {
    const node = make('article', { className: `comment${comment.pending ? ' pending' : ''}` });
    node.id = `comment-${comment.id}`;
    if (comment.deleted) {
      node.append(make('p', { className: 'comment-gone' }, '这条评论已删除'));
      return node;
    }
    const head = make('header', {},
      make('a', { href: authorUrl(comment.author), className: 'comment-author' }, comment.author),
      comment.postAuthor ? make('span', { className: 'tag' }, '作者') : null,
      comment.replyTo ? make('span', { className: 'muted' }, `回复 @${comment.replyTo}`) : null,
      make('time', { dateTime: new Date(comment.time).toISOString() }, commentTime(comment.time)),
      comment.pending ? make('span', { className: 'tag wait' }, comment.mine ? '等审核，只有你看得到' : '等审核') : null,
      comment.reports ? make('span', { className: 'tag wait' }, `被举报 ${comment.reports} 次`) : null,
    );
    node.append(head, make('p', { className: 'comment-body' }, comment.body), tools(comment));
    return node;
  }

  function draw() {
    const tops = data.comments.filter(c => !c.parent);
    const shown = data.comments.filter(c => !c.deleted).length;
    const title = make('h2', { className: 'comments-title', id: 'comments-title' }, '评论', shown ? make('small', {}, ` ${shown}`) : null);
    const parts = [title];

    if (data.canModerate) {
      const toggle = make('button', { type: 'button', className: 'link-button' }, data.off ? '打开评论' : '关闭评论');
      toggle.addEventListener('click', () => act('/life/comments/switch', { post: Number(postId), off: !data.off }, toggle));
      parts.push(make('p', { className: 'comment-admin' }, data.off ? '评论已关闭，别人不能再评论。' : '你可以审核、删除这篇文章下的评论。', ' ', toggle));
    }

    if (!data.cannot) {
      parts.push(form(null));
      parts.push(make('p', { className: 'hint' }, '只能发文字，不能留链接和联系方式。第一次评论要审核后才公开。'));
    } else {
      const note = make('p', { className: 'hint' }, COMMENT_CANNOT[data.cannot] || '');
      if (data.cannot === 'login' || data.cannot === 'guest') {
        note.append(' ', make('a', { href: `/account/?back=${encodeURIComponent(location.pathname + location.search)}` }, '去登录'));
      }
      parts.push(note);
    }

    const list = make('div', { className: 'comment-list' });
    for (const top of tops) {
      const thread = make('div', { className: 'thread' }, item(top));
      const replies = data.comments.filter(c => c.parent === top.id);
      const replyBox = make('div', { className: 'replies' }, ...replies.map(item));
      const target = replies.find(r => r.id === openReply) || (top.id === openReply ? top : null);
      if (target) {
        const box = form(top.id === target.id ? top.id : target.id, target.author);
        box.dataset.reply = target.id;
        replyBox.append(box);
      }
      if (replyBox.childElementCount) thread.append(replyBox);
      list.append(thread);
    }
    if (!tops.length) list.append(make('p', { className: 'hint' }, data.cannot === 'off' ? '' : '还没有评论。'));
    parts.push(list);
    section.replaceChildren(...parts);
  }

  section.setAttribute('aria-labelledby', 'comments-title');
  load();
}

// 有新的评论消息时，在导航里显示「评论消息 N」。只在登录后才问服务器
function showCommentBadge(nav) {
  if (!getToken() || !nav) return;
  api('/life/comments/inbox').then(({ unread }) => {
    const link = make('a', { href: '/life/comments/', className: 'inbox-link' }, '评论消息');
    if (unread) link.append(make('b', { className: 'badge' }, String(unread)));
    nav.prepend(link);
  }).catch(() => {});
}
