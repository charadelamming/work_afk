import { createApp } from "vue";

import { isTauri } from "../platform/config";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/widget.css";
import WidgetApp from "./WidgetApp.vue";

if (!isTauri) document.body.classList.add("is-preview");

createApp(WidgetApp).mount("#app");
