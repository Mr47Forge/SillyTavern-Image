export const SERVER_PLUGIN_INSTALLATION = Object.freeze({
  open: '安装指引', close: '关闭', title: '独立绘图后台安装',
  steps: [
    { text:'等待现有绘图任务完成，保留原小白X和用户数据。' },
    { text:'将本仓库 server-plugin 文件夹内的全部内容复制到 SillyTavern/plugins/sillytavern-image-server；覆盖前备份同名目录。' },
    { text:'在酒馆配置中启用服务端插件。', code:'enableServerPlugins: true' },
    { text:'重新启动酒馆并刷新页面。独立后台与原小白X后台分别使用自己的地址。' },
  ],
});
