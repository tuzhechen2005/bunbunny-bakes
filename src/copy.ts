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
} as const;
