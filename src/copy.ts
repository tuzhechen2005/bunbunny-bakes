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
    /** CUTOFF_PASSED on customer cancel (API_SPEC.md POST /api/o/{token}/cancel). */
    CUTOFF_PASSED_CANCEL: "已过取消时间，请微信联系店主",
    /** VALIDATION for an admin status change the state machine does not allow (D46). */
    STATUS_NOT_ALLOWED: "不能改成这个状态",
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
  },
} as const;
