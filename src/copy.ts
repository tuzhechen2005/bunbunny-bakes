// All Chinese UI text lives here (CLAUDE.md, D27). Grouped by area.
// Strings with {placeholders} are filled by the caller.

export const copy = {
  shopName: "🐰的大面包",

  dates: {
    /** Index 0 = Sunday, matching Date#getDay(). */
    weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
    /** e.g. "10/29 周四 20:00 截止" */
    cutoffLabel: "{md} {weekday} {hm} 截止",
    /** e.g. "10/30 周五" */
    dayLabel: "{md} {weekday}",
  },

  customerStatus: {
    pending: "已收到，等待确认（请加店主微信 {ownerWechatId}）",
    confirmed: "已确认",
    readyPickup: "可以取货了",
    readyDelivery: "正在配送",
    completed: "已完成",
    cancelled: "订单已取消",
  },

  home: {
    orderingOpen: "预订开放中",
    orderingClosed: "暂未开放预订 🍞",
  },

  /** Customer pages: home (menu + cart) and checkout (PAGES.md). */
  customer: {
    home: {
      orderingClosedHint: "下一轮预订开放时间请关注群内通知～",
      loading: "加载中…",
      loadFailed: "菜单加载失败，请稍后再试",
      retry: "重新加载",
      emptyMenu: "暂时还没有可以预订的面包～",
      /** e.g. "$2.49 / 个" */
      unitPrice: "{price} / 个",
      /** e.g. "4 个 $8.99" */
      bundlePrice: "{size} 个 {price}",
      /** Joins unitPrice and bundlePrice (full-width space). */
      priceSeparator: "　",
      paused: "暂停供应",
      maxReached: "大量订购请加微信联系",
      decrease: "减少一个",
      increase: "增加一个",
      /** Screen-reader label for the qty, e.g. "已选 3 个" */
      qtyLabel: "已选 {qty} 个",
      barCount: "已选 {count} 件",
      barSubtotal: "小计 {amount}",
      goCheckout: "去结算",
      checkoutClosed: "暂未开放预订",
      footerContact: "联系店主：微信 {id}",
    },
    checkout: {
      pageTitle: "确认预订",
      backToMenu: "‹ 返回菜单",
      emptyCart: "购物车还是空的～",
      emptyCartLink: "回首页挑选面包",
      cartTitle: "购物车明细",
      /** e.g. "奶酪角 ×5" */
      lineName: "{name} ×{qty}",
      remove: "移除",
      datesTitle: "选择取货日期",
      leadDaysHint: "含布蕾的订单需提前两天预订",
      noDates: "暂时没有可以预订的日期，请关注群内通知～",
      datesLoading: "正在查询可以预订的日期…",
      datesFailed: "日期加载失败，请稍后再试",
      retry: "重试",
      stateCutoff: "已截止",
      stateFull: "已满",
      stateDeliveryFull: "配送已满，可选自提",
      fulfillmentTitle: "自提或配送",
      pickup: "自提",
      delivery: "配送",
      /** e.g. "运费 $5，满 $25 免运费" */
      deliveryFee: "运费 {fee}，满 {min} 免运费",
      /** e.g. "再买 $5.02 就免运费啦" */
      freeDeliveryGap: "再买 {gap} 就免运费啦",
      deliveryArrange: "具体配送时间和地点会在微信上和你确认",
      wechatLabel: "你的微信号",
      wechatHint: "店主会加你微信确认订单",
      wechatRequired: "请填写你的微信号",
      noteLabel: "备注（选填）",
      /** e.g. "12/300" */
      noteCounter: "{count}/{max}",
      totalsTitle: "金额",
      subtotal: "小计",
      deliveryFeeLabel: "运费",
      total: "总额",
      payLater: "无需在线付款，收到货后再付款。",
      submit: "确认提交预订",
      submitting: "提交中…",
      pickDate: "请先选择取货日期",
      /** FULL suggestion button, e.g. "改成 10/31 周六" */
      switchDate: "改成 {day}",
    },
    /** Order page /o/{token} (PAGES.md), also the "order submitted" page. */
    order: {
      newTitle: "预订提交成功！🎉",
      newHint: "请收藏或截图这个页面，随时可以回来查看订单状态",
      loading: "加载中…",
      loadFailed: "加载失败，请稍后刷新",
      retry: "重新加载",
      addOwnerWechat: "请加店主微信：{ownerWechatId}",
      copyWechat: "复制",
      copied: "已复制",
      orderNo: "订单号：{orderNo}",
      pickupDate: "取货：{pickupDateLabel}",
      pickup: "自提",
      delivery: "配送",
      itemsTitle: "订单明细",
      itemLine: "{name} × {qty}",
      subtotal: "小计",
      deliveryFee: "运费",
      total: "总额",
      note: "备注：{note}",
      payOnReceipt: "无需在线付款，收到货后再付款。",
      cancelOrder: "取消订单",
      cancelConfirmTitle: "确定要取消这个订单吗？",
      cancelConfirm: "确定取消",
      cancelBack: "再想想",
      cancelling: "取消中…",
      cancelled: "已取消",
      cancelClosed: "已过取消时间，如需修改请微信联系店主",
      cancelFailed: "取消失败，请稍后再试",
      backHome: "返回首页",
    },
  },

  /** Default `message` per API error code (API_SPEC.md §1, PAGES.md checkout errors). */
  errors: {
    VALIDATION: "填写的内容有误，请检查后再提交",
    ORDERING_DISABLED: "暂未开放预订 🍞",
    DATE_CLOSED: "这一天不接受预订，请选择其他日期",
    CUTOFF_PASSED: "这一天已经截止啦，请选择其他日期",
    PRODUCT_UNAVAILABLE: "有商品暂时不能预订，请从购物车移除后再提交",
    QTY_LIMIT: "有商品超过了每单的数量上限，请减少数量",
    FULL: "这一天的预订名额已经满啦，可以选择下一个有空位的日期～",
    /** FULL when there is no suggested date (PAGES.md checkout errors). */
    FULL_NO_SUGGESTION: "暂时没有可以容纳这个订单的日期，可以减少数量或加微信联系店主",
    DELIVERY_FULL: "这一天的配送名额满了，可以改成自提～",
    RATE_LIMITED: "提交太频繁了，请稍后再试，或加微信联系店主",
    NOT_CANCELLABLE: "这个订单现在不能取消了，请加微信联系店主",
    OVER_LIMIT: "这样会超过上限",
    STALE: "这笔订单刚刚在别处改过，请刷新后再操作",
    UNAUTHORIZED: "请先登录",
    NOT_FOUND: "找不到这个订单，请检查链接是否完整，或加微信联系店主",
    /** Unknown / unexpected errors. */
    fallback: "提交失败，请稍后再试",
  },

  admin: {
    /** Admin login, password reset (PAGES.md /admin/login). */
    auth: {
      loginTitle: "后台登录",
      username: "用户名",
      password: "密码",
      login: "登录",
      loggingIn: "登录中…",
      forgotPassword: "忘记密码？",
      resetSent: "重置链接已发送到你的邮箱",
      invalidCredentials: "用户名或密码错误",
      resetTitle: "设置新密码",
      newPassword: "新密码（至少 10 位）",
      confirmPassword: "再输入一次新密码",
      saveNewPassword: "保存新密码",
      saving: "保存中…",
      passwordTooShort: "密码至少 10 位",
      passwordMismatch: "两次输入的密码不一样",
      resetInvalid: "重置链接无效或已过期，请重新申请",
      resetDone: "密码已更新，请用新密码登录",
      backToLogin: "返回登录",
      currentPasswordWrong: "当前密码不正确",
      requestFailed: "操作失败，请稍后再试",
    },
    /** Admin shell: top bar, menu, quick links, shared page pieces. */
    shell: {
      dashboardTitle: "后台",
      openMenu: "打开菜单",
      closeMenu: "关闭菜单",
      mainNav: "后台导航",
      orders: "订单",
      calendar: "日历",
      newOrder: "代客下单",
      products: "商品",
      settings: "设置",
      logs: "日志",
      logout: "退出登录",
      loggingOut: "退出中…",
      logoutFailed: "退出失败，请稍后再试",
      back: "‹ 返回",
      quickLinks: "快捷入口",
      requestFailed: "操作失败，请稍后再试",
    },
  },
} as const;
