/**
 * 赞助渠道配置
 *
 * 这里只放“数据”，界面由 renderer/app.js 的 openSponsorModal() 统一渲染。
 * 后续新增渠道时，复制一个对象、修改字段即可，不需要改 UI。
 *
 * type:
 *   'qr'   二维码渠道，显示图片，点击可全屏放大
 *   'link' 外部链接渠道，显示为按钮/链接
 *
 * image:
 *   相对于 renderer/index.html 的路径。二维码建议使用正方形图片。
 *   图片加载失败时，该渠道会自动隐藏，不会出现破图。
 *
 * order:
 *   数字越小越靠前；未填写时按配置顺序。
 */
export const SPONSOR_CONFIG = {
  title: '支持作者',
  eyebrow: 'THANK YOU FOR YOUR SUPPORT',
  intro: '如果这个项目帮到了你，欢迎请我喝杯咖啡。',
  message: '你的支持是我持续更新的最大动力。',

  // 二维码 / 链接渠道
  channels: [
    {
      id: 'wechat',
      type: 'qr',
      name: '微信赞赏',
      description: '使用微信扫码，自愿赞赏',
      image: '../assets/sponsor/wechat.jpg',
      alt: '微信赞赏码',
      order: 10,
    },
    {
      id: 'alipay',
      type: 'qr',
      name: '支付宝',
      description: '使用支付宝扫码，自愿赞赏',
      image: '../assets/sponsor/alipay.jpg',
      alt: '支付宝收款码',
      order: 20,
    },

    // 示例：后续补充爱发电、GitHub Sponsors、PayPal 时取消注释并修改链接
    // {
    //   id: 'afdian',
    //   type: 'link',
    //   name: '爱发电',
    //   description: '按月或一次性支持',
    //   url: 'https://afdian.com/a/your-name',
    //   order: 30,
    // },
    // {
    //   id: 'github',
    //   type: 'link',
    //   name: 'GitHub Sponsors',
    //   description: '通过 GitHub 赞助',
    //   url: 'https://github.com/sponsors/your-name',
    //   order: 40,
    // },
  ],

  // 可选的外部渠道；也可以直接写进 channels 里。留空时不会显示该区域。
  links: [],

  // 感谢名单：可以是字符串，也可以是 { name, avatar, note }。
  // 为空时页面显示“期待成为第一位支持者”。
  thanks: [],

  disclaimer: '赞赏/赞助属于自愿无偿行为，不绑定任何特权，也不影响任何功能的正常使用。',
  thanksEmptyText: '期待成为第一位支持者',

  // “关于作者”暂时留空，后续在这里补充即可。
  aboutAuthor: {
    title: '关于作者',
    body: '这里暂时空置，后续会补充作者介绍、联系方式与项目说明。',
  },
};
