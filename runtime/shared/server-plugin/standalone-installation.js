export const SERVER_PLUGIN_INSTALLATION = Object.freeze({
  open: '安装指引', close: '关闭', title: '独立绘图后台安装',
  steps: [
    { text:'等待现有绘图任务完成，备份现有后台目录和用户数据。' },
    { text:'点击上方下载后台安装包，解压后将 sillytavern-image-server 文件夹放入酒馆 plugins 目录。' },
    { text:'在酒馆配置中启用服务端插件。', code:'enableServerPlugins: true' },
    { text:'重新启动原酒馆服务，再刷新页面检查后台连接。' },
  ],
});
