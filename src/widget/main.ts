import { createApp } from "vue";

import { isTauri } from "../platform/config";
import { startAutoUpdateCheck } from "../platform/updater";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/widget.css";
import WidgetApp from "./WidgetApp.vue";

if (!isTauri) document.body.classList.add("is-preview");

createApp(WidgetApp).mount("#app");

// 启动 10 秒后静默检查一次更新，之后每 24 小时一次；失败只写控制台
startAutoUpdateCheck();
